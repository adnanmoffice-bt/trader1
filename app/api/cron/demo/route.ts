import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { fetchBinanceTicker } from '@/lib/price-fetcher'
import { computeIndicators, technicalScore, detectEMACross } from '@/lib/indicators'
import type { OHLCV } from '@/types'

export const runtime = 'nodejs'
export const maxDuration = 60

// Same profitable instruments as war-room (SOL, BNB blacklisted — 0% win rate)
const DEMO_INSTRUMENTS = ['BTC/USD', 'ETH/USD', 'XAU/USD'] as const
// All values in USD — no currency conversion needed
const RISK_PER_TRADE = 0.015  // 1.5% (was 3% — too aggressive)
const MIN_SCORE = 70           // was 55 — need higher conviction
const SESSION_CAPITAL = 5000
const MAX_OPEN_PER_SESSION = 2 // was 4 — reduce exposure
const MAX_POSITION_AGE_MS = 48 * 60 * 60 * 1000 // 48 hours

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceSupabase()
  const t0 = Date.now()

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

  if (new Date(session.end_date) < new Date()) {
    await db.from('demo_sessions').update({ status: 'completed' }).eq('id', session.id)
    return NextResponse.json({ success: true, message: 'Session expired, will create new one next run' })
  }

  const actions: string[] = []

  // ── PHASE 1: Close exits FIRST (with fallback pricing) ──
  const { data: openTrades } = await db
    .from('demo_trades')
    .select('*')
    .eq('session_id', session.id)
    .is('exit_time', null)

  for (const trade of openTrades ?? []) {
    const sym = trade.instrument as string
    let price: number | null = null

    // Try Binance ticker first
    const ticker = await fetchBinanceTicker(sym)
    if (ticker) {
      price = ticker.price
    } else {
      // Fallback: use market_data table
      const { data: md } = await db.from('market_data').select('price').eq('symbol', sym).single()
      if (md) price = Number(md.price)
    }

    if (!price) {
      // Last resort: use latest candle close from price_history
      const { data: lastCandle } = await db.from('price_history')
        .select('close').eq('symbol', sym).order('timestamp', { ascending: false }).limit(1).single()
      if (lastCandle) price = Number(lastCandle.close)
    }

    if (!price) {
      actions.push(`${sym}: no price available, skipping exit check`)
      continue
    }

    // Check SL/TP hit
    const result = checkTradeExit(trade, price)
    if (result) {
      await db.from('demo_trades').update({
        exit_price:  result.exitPrice,
        exit_time:   new Date().toISOString(),
        exit_reason: result.reason,
        pnl:         result.pnl,
        pnl_pct:     result.pnlPct,
        pnl_aed:     result.pnlAed,
      }).eq('id', trade.id)
      actions.push(`${sym}: ${result.reason} @ $${result.exitPrice.toFixed(2)} P&L: $${result.pnlAed.toFixed(0)}`)
      continue
    }

    // Check candle high/low for missed SL/TP between cron runs
    const { data: recentCandles } = await db.from('price_history')
      .select('high, low').eq('symbol', sym).eq('interval', '1h')
      .order('timestamp', { ascending: false }).limit(2)

    if (recentCandles?.length) {
      const candleHigh = Math.max(...recentCandles.map(c => Number(c.high)))
      const candleLow = Math.min(...recentCandles.map(c => Number(c.low)))
      const wickResult = checkTradeExitWick(trade, candleHigh, candleLow)
      if (wickResult) {
        await db.from('demo_trades').update({
          exit_price:  wickResult.exitPrice,
          exit_time:   new Date().toISOString(),
          exit_reason: wickResult.reason,
          pnl:         wickResult.pnl,
          pnl_pct:     wickResult.pnlPct,
          pnl_aed:     wickResult.pnlAed,
        }).eq('id', trade.id)
        actions.push(`${sym}: ${wickResult.reason} (wick) @ $${wickResult.exitPrice.toFixed(2)} P&L: $${wickResult.pnlAed.toFixed(0)}`)
        continue
      }
    }

    // Check max position age — close stale positions at market price
    const entryTime = new Date(trade.entry_time as string).getTime()
    if (Date.now() - entryTime > MAX_POSITION_AGE_MS) {
      const dir = String(trade.direction)
      const entry = Number(trade.entry_price)
      const qty = Number(trade.quantity)
      const pnl = dir === 'long' ? (price - entry) * qty : (entry - price) * qty
      const pnlPct = (pnl / (entry * qty)) * 100
      const pnlUsd = pnl

      await db.from('demo_trades').update({
        exit_price:  price,
        exit_time:   new Date().toISOString(),
        exit_reason: 'timeout',
        pnl, pnl_pct: pnlPct, pnl_aed: pnlUsd,
      }).eq('id', trade.id)
      actions.push(`${sym}: TIMEOUT (48h) @ $${price.toFixed(2)} P&L: $${pnlUsd.toFixed(0)}`)
    }
  }

  // ── PHASE 2: Open new positions ──
  const { data: stillOpen } = await db
    .from('demo_trades')
    .select('id, instrument')
    .eq('session_id', session.id)
    .is('exit_time', null)

  const currentOpenCount = stillOpen?.length ?? 0
  const currentOpenSymbols = new Set(stillOpen?.map(t => t.instrument) ?? [])

  for (const sym of DEMO_INSTRUMENTS) {
    if (currentOpenCount >= MAX_OPEN_PER_SESSION) break
    if (currentOpenSymbols.has(sym)) continue

    const ticker = await fetchBinanceTicker(sym)
    if (!ticker) continue
    const price = ticker.price

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

    // BB_SQUEEZE disabled — catastrophic 6% win rate. Only use EMA_CROSS.
    const emaSig = detectEMACross(ohlcv)
    const hasSignal = emaSig.triggered
    const signalDir = emaSig.triggered ? emaSig.direction : bias
    const stratName = emaSig.triggered ? 'EMA_CROSS' : 'TECH_SCORE'

    if (!hasSignal && (score < MIN_SCORE || bias === 'neutral')) continue

    const effectiveDir = signalDir ?? bias
    if (effectiveDir === 'neutral' || !effectiveDir) continue

    // LONG-ONLY MODE — shorts had 0W/37L in history. Skip all shorts.
    if (effectiveDir === 'short') continue

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

    const atrVal = ind.atr
    const slMult = 2.0  // Wider SL to survive noise (was 2.5 — but noise hits)
    const tpMult = 4.5  // R:R 2.25:1
    const slDist = atrVal * slMult
    const tpDist = atrVal * tpMult

    const entry = price
    const sl = effectiveDir === 'long' ? entry - slDist : entry + slDist
    const tp = effectiveDir === 'long' ? entry + tpDist : entry - tpDist

    const { data: closedTrades } = await db
      .from('demo_trades')
      .select('pnl_aed')
      .eq('session_id', session.id)
      .not('exit_time', 'is', null)

    const realizedPnl = closedTrades?.reduce((s, t) => s + Number(t.pnl_aed || 0), 0) ?? 0
    const currentCapital = Number(session.initial_capital) + realizedPnl

    const riskAmt = currentCapital * RISK_PER_TRADE
    const riskPerUnit = slDist
    const qty = riskAmt / riskPerUnit

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

  await updateSessionStats(db, session.id, Number(session.initial_capital))

  return NextResponse.json({
    success: true,
    session_id: session.id,
    actions,
    open_trades: currentOpenCount,
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

  return { exitPrice, reason: hitSL ? 'stop_loss' : 'take_profit', pnl, pnlPct, pnlAed: pnl }
}

function checkTradeExitWick(
  trade: Record<string, unknown>,
  candleHigh: number,
  candleLow: number
): { exitPrice: number; reason: string; pnl: number; pnlPct: number; pnlAed: number } | null {
  const entry = Number(trade.entry_price)
  const sl    = Number(trade.stop_loss)
  const tp    = Number(trade.take_profit)
  const qty   = Number(trade.quantity)
  const dir   = String(trade.direction)

  const hitSL = (dir === 'long' && candleLow <= sl) || (dir === 'short' && candleHigh >= sl)
  const hitTP = (dir === 'long' && candleHigh >= tp) || (dir === 'short' && candleLow <= tp)

  if (!hitSL && !hitTP) return null

  const exitPrice = hitSL ? sl : tp
  const pnl = dir === 'long' ? (exitPrice - entry) * qty : (entry - exitPrice) * qty
  const pnlPct = (pnl / (entry * qty)) * 100

  return { exitPrice, reason: hitSL ? 'stop_loss' : 'take_profit', pnl, pnlPct, pnlAed: pnl }
}

async function updateSessionStats(
  db: ReturnType<typeof createServiceSupabase>,
  sessionId: string,
  initialCapital: number
) {
  const { data: allTrades } = await db
    .from('demo_trades')
    .select('pnl')
    .eq('session_id', sessionId)
    .not('exit_time', 'is', null)

  const { count: totalCount } = await db
    .from('demo_trades')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId)

  if (!allTrades?.length) return

  const wins = allTrades.filter(t => Number(t.pnl) > 0).length
  const losses = allTrades.filter(t => Number(t.pnl) <= 0).length
  const totalPnl = allTrades.reduce((s, t) => s + Number(t.pnl || 0), 0)

  let peak = initialCapital
  let maxDD = 0
  let running = initialCapital
  for (const t of allTrades) {
    running += Number(t.pnl || 0)
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

  // Sync portfolio table (used by war-room for capital + daily loss checks)
  await db.from('portfolio').update({
    capital: initialCapital + totalPnl,
    available_capital: initialCapital + totalPnl,
    realized_pnl: totalPnl,
    win_count: wins,
    loss_count: losses,
  }).eq('is_demo', false).then(({ error }) => { if (error) console.error('[demo] portfolio sync error:', error.message) })
}
