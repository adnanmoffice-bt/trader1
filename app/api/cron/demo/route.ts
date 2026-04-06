import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { fetchBinanceTicker } from '@/lib/price-fetcher'
import { computeIndicators, technicalScore, detectBBSqueeze, detectEMACross } from '@/lib/indicators'
import type { OHLCV } from '@/types'

export const runtime = 'nodejs'
export const maxDuration = 60

const DEMO_INSTRUMENTS = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'BNB/USD', 'XAU/USD'] as const
const USD_AED = 3.6725
const RISK_PER_TRADE = 0.03  // 3% risk per trade
const MIN_RR = 2.0            // minimum 2:1 reward:risk
const MIN_SCORE = 55          // lower threshold = more trades
const SESSION_CAPITAL = 10000 // 10,000 AED
const MAX_OPEN_PER_SESSION = 4

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceSupabase()
  const t0 = Date.now()

  // Get or create running session
  let { data: session } = await db
    .from('demo_sessions')
    .select('*')
    .eq('status', 'running')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!session) {
    const today = new Date()
    const endDate = new Date(today)
    endDate.setDate(endDate.getDate() + 7)

    const { data: newSession } = await db.from('demo_sessions').insert({
      start_date:      today.toISOString().split('T')[0],
      end_date:        endDate.toISOString().split('T')[0],
      initial_capital: SESSION_CAPITAL,
      status:          'running',
    }).select().single()
    session = newSession
  }

  if (!session) {
    return NextResponse.json({ error: 'Failed to create demo session' }, { status: 500 })
  }

  // Check session expiry
  if (new Date(session.end_date) < new Date()) {
    await db.from('demo_sessions').update({ status: 'completed' }).eq('id', session.id)
    return NextResponse.json({ success: true, message: 'Session expired, will create new one next run' })
  }

  const actions: string[] = []

  // Count current open trades
  const { data: allOpenTrades } = await db
    .from('demo_trades')
    .select('id, instrument')
    .eq('session_id', session.id)
    .is('exit_time', null)

  const openCount = allOpenTrades?.length ?? 0
  const openInstruments = new Set(allOpenTrades?.map(t => t.instrument) ?? [])

  // Process each instrument
  for (const sym of DEMO_INSTRUMENTS) {
    const ticker = await fetchBinanceTicker(sym)
    if (!ticker) continue
    const price = ticker.price

    // Check if we have an open trade for this instrument
    if (openInstruments.has(sym)) {
      const { data: openTrade } = await db
        .from('demo_trades')
        .select('*')
        .eq('session_id', session.id)
        .eq('instrument', sym)
        .is('exit_time', null)
        .single()

      if (openTrade) {
        const result = checkTradeExit(openTrade, price)
        if (result) {
          await db.from('demo_trades').update({
            exit_price:  result.exitPrice,
            exit_time:   new Date().toISOString(),
            exit_reason: result.reason,
            pnl:         result.pnl,
            pnl_pct:     result.pnlPct,
            pnl_aed:     result.pnlAed,
          }).eq('id', openTrade.id)
          actions.push(`${sym}: ${result.reason} @ $${result.exitPrice.toFixed(2)} P&L: ${result.pnlAed.toFixed(0)} AED`)
        }
      }
      continue
    }

    // Don't open new trades if max reached
    if (openCount >= MAX_OPEN_PER_SESSION) continue

    // Get candles for analysis
    const { data: candles } = await db
      .from('price_history')
      .select('*')
      .eq('symbol', sym)
      .eq('interval', '1h')
      .order('timestamp', { ascending: false })
      .limit(200)

    if (!candles || candles.length < 30) continue

    const ohlcv: OHLCV[] = candles.reverse().map(c => ({
      timestamp: new Date(c.timestamp).getTime(),
      open: Number(c.open), high: Number(c.high), low: Number(c.low),
      close: Number(c.close), volume: Number(c.volume),
    }))

    const ind = computeIndicators(ohlcv)
    const { score, bias } = technicalScore(ind)

    // Use backtested strategies: BB Squeeze (Sharpe 1.89) + EMA Cross (Sharpe 1.75)
    const bbSig = detectBBSqueeze(ohlcv)
    const emaSig = detectEMACross(ohlcv)
    const hasSignal = bbSig.triggered || emaSig.triggered
    const signalDir = bbSig.triggered ? bbSig.direction : emaSig.triggered ? emaSig.direction : bias
    const stratName = bbSig.triggered ? 'BB_SQUEEZE' : emaSig.triggered ? 'EMA_CROSS' : 'TECH_SCORE'

    // Require either a backtested strategy signal OR strong tech score
    if (!hasSignal && (score < MIN_SCORE || bias === 'neutral')) continue

    const effectiveDir = signalDir ?? bias
    if (effectiveDir === 'neutral' || !effectiveDir) continue

    // Check AI signal alignment
    const { data: recentSignal } = await db
      .from('signals')
      .select('direction, confidence')
      .eq('instrument', sym)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const aiAligned = recentSignal && recentSignal.direction === effectiveDir
    const effectiveScore = hasSignal ? (aiAligned ? 90 : 75) : (aiAligned ? Math.min(score + 10, 100) : score)

    // ATR-based levels from backtest: 2.5x SL, 4-5x TP
    const atrVal = ind.atr
    const slMult = stratName === 'BB_SQUEEZE' ? 2.5 : 2.5
    const tpMult = stratName === 'BB_SQUEEZE' ? 4.0 : 5.0
    const slDist = atrVal * slMult
    const tpDist = atrVal * tpMult

    const entry = price
    const sl = effectiveDir === 'long' ? entry - slDist : entry + slDist
    const tp = effectiveDir === 'long' ? entry + tpDist : entry - tpDist

    // Calculate current capital
    const { data: closedTrades } = await db
      .from('demo_trades')
      .select('pnl_aed')
      .eq('session_id', session.id)
      .not('exit_time', 'is', null)

    const realizedPnl = closedTrades?.reduce((s, t) => s + Number(t.pnl_aed || 0), 0) ?? 0
    const currentCapital = Number(session.initial_capital) + realizedPnl

    // Risk sizing: 3% of current capital
    const riskAmt = currentCapital * RISK_PER_TRADE
    const riskPerUnit = slDist  // USD risk per unit
    const qty = riskAmt / (riskPerUnit * USD_AED)

    if (qty <= 0) continue

    await db.from('demo_trades').insert({
      session_id:    session.id,
      instrument:    sym,
      direction:     effectiveDir,
      entry_price:   entry,
      stop_loss:     sl,
      take_profit:   tp,
      quantity:      qty,
      confidence:    effectiveScore,
      signal_reason: `${stratName} ${effectiveDir} ${aiAligned ? '+AI' : ''} RSI:${ind.rsi.toFixed(0)} ATR:${atrVal.toFixed(2)} BB:${(ind.bb.percentB * 100).toFixed(0)}%`,
      entry_time:    new Date().toISOString(),
    })

    actions.push(`${sym}: ${stratName} OPEN ${effectiveDir.toUpperCase()} @ $${entry.toFixed(2)} SL:$${sl.toFixed(2)} TP:$${tp.toFixed(2)} conf:${effectiveScore}`)
  }

  // Update session stats
  await updateSessionStats(db, session.id, Number(session.initial_capital))

  return NextResponse.json({
    success: true,
    session_id: session.id,
    actions,
    open_trades: openCount,
    duration_ms: Date.now() - t0,
    timestamp: new Date().toISOString(),
  })
}

function checkTradeExit(
  trade: Record<string, unknown>,
  currentPrice: number
): { exitPrice: number; reason: string; pnl: number; pnlPct: number; pnlAed: number } | null {
  const entry = Number(trade.entry_price)
  const sl    = Number(trade.stop_loss)
  const tp    = Number(trade.take_profit)
  const qty   = Number(trade.quantity)
  const dir   = String(trade.direction)

  const hitSL = (dir === 'long' && currentPrice <= sl) || (dir === 'short' && currentPrice >= sl)
  const hitTP = (dir === 'long' && currentPrice >= tp) || (dir === 'short' && currentPrice <= tp)

  if (!hitSL && !hitTP) return null

  const exitPrice = hitSL ? sl : tp
  const pnl = dir === 'long' ? (exitPrice - entry) * qty : (entry - exitPrice) * qty
  const pnlPct = (pnl / (entry * qty)) * 100
  const pnlAed = pnl * USD_AED

  return { exitPrice, reason: hitSL ? 'stop_loss' : 'take_profit', pnl, pnlPct, pnlAed }
}

async function updateSessionStats(
  db: ReturnType<typeof createServiceSupabase>,
  sessionId: string,
  initialCapital: number
) {
  const { data: allTrades } = await db
    .from('demo_trades')
    .select('pnl, pnl_aed')
    .eq('session_id', sessionId)
    .not('exit_time', 'is', null)

  const { count: totalCount } = await db
    .from('demo_trades')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId)

  if (!allTrades?.length) return

  const wins = allTrades.filter(t => Number(t.pnl) > 0).length
  const losses = allTrades.filter(t => Number(t.pnl) <= 0).length
  const totalPnl = allTrades.reduce((s, t) => s + Number(t.pnl_aed || 0), 0)

  // Calculate max drawdown
  let peak = initialCapital
  let maxDD = 0
  let running = initialCapital
  for (const t of allTrades) {
    running += Number(t.pnl_aed || 0)
    if (running > peak) peak = running
    const dd = (peak - running) / peak
    if (dd > maxDD) maxDD = dd
  }

  await db.from('demo_sessions').update({
    win_count:     wins,
    loss_count:    losses,
    total_trades:  totalCount ?? allTrades.length,
    total_pnl:     totalPnl,
    total_pnl_pct: (totalPnl / initialCapital) * 100,
    final_capital: initialCapital + totalPnl,
    max_drawdown:  maxDD,
  }).eq('id', sessionId)
}
