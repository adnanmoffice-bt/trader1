import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { fetchBinanceTicker } from '@/lib/price-fetcher'
import { computeIndicators, technicalScore } from '@/lib/indicators'
import type { OHLCV } from '@/types'

export const runtime = 'nodejs'
export const maxDuration = 120

const DEMO_INSTRUMENTS = ['BTC/USD', 'ETH/USD'] as const
const USD_AED = 3.6725
const MAX_RISK_PCT = 0.05
const MIN_RR = 1.5

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceSupabase()

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
    endDate.setDate(endDate.getDate() + 5)

    const { data: newSession } = await db.from('demo_sessions').insert({
      start_date:      today.toISOString().split('T')[0],
      end_date:        endDate.toISOString().split('T')[0],
      initial_capital: 200000,
      status:          'running',
    }).select().single()

    session = newSession
  }

  if (!session) {
    return NextResponse.json({ error: 'Failed to create demo session' }, { status: 500 })
  }

  const actions: string[] = []

  for (const sym of DEMO_INSTRUMENTS) {
    const { data: openTrade } = await db
      .from('demo_trades')
      .select('*')
      .eq('session_id', session.id)
      .eq('instrument', sym)
      .is('exit_time', null)
      .single()

    const ticker = await fetchBinanceTicker(sym)
    if (!ticker) continue
    const price = ticker.price

    if (openTrade) {
      const entry = Number(openTrade.entry_price)
      const sl = Number(openTrade.stop_loss)
      const tp = Number(openTrade.take_profit)
      const qty = Number(openTrade.quantity)
      const dir = openTrade.direction

      const hitSL = (dir === 'long' && price <= sl) || (dir === 'short' && price >= sl)
      const hitTP = (dir === 'long' && price >= tp) || (dir === 'short' && price <= tp)

      if (hitSL || hitTP) {
        const exitPrice = hitSL ? sl : tp
        const pnl = dir === 'long' ? (exitPrice - entry) * qty : (entry - exitPrice) * qty
        const pnlPct = (pnl / (entry * qty)) * 100
        const reason = hitSL ? 'stop_loss' : 'take_profit'

        await db.from('demo_trades').update({
          exit_price: exitPrice,
          exit_time:  new Date().toISOString(),
          exit_reason: reason,
          pnl,
          pnl_pct: pnlPct,
          pnl_aed: pnl * USD_AED,
        }).eq('id', openTrade.id)

        actions.push(`${sym}: ${reason} at $${exitPrice.toFixed(2)} P&L: ${(pnl * USD_AED).toFixed(0)} AED`)
      }
      continue
    }

    const { data: candles } = await db
      .from('price_history')
      .select('*')
      .eq('symbol', sym)
      .eq('interval', '1h')
      .order('timestamp', { ascending: false })
      .limit(200)

    if (!candles || candles.length < 50) continue

    const ohlcv: OHLCV[] = candles.reverse().map(c => ({
      timestamp: new Date(c.timestamp).getTime(),
      open: Number(c.open), high: Number(c.high), low: Number(c.low),
      close: Number(c.close), volume: Number(c.volume),
    }))

    const ind = computeIndicators(ohlcv)
    const { score, bias } = technicalScore(ind)

    if (score < 65 || bias === 'neutral') continue

    const atr = ind.atr
    const slDist = atr * 1.5
    const tpDist = slDist * MIN_RR
    const entry = price
    const sl = bias === 'long' ? entry - slDist : entry + slDist
    const tp = bias === 'long' ? entry + tpDist : entry - tpDist

    const capital = Number(session.initial_capital)
    const riskAmt = capital * MAX_RISK_PCT
    const qty = riskAmt / (slDist * USD_AED)

    await db.from('demo_trades').insert({
      session_id:   session.id,
      instrument:   sym,
      direction:    bias,
      entry_price:  entry,
      stop_loss:    sl,
      take_profit:  tp,
      quantity:     qty,
      confidence:   score,
      signal_reason: `Tech score ${score} bias ${bias} RSI ${ind.rsi.toFixed(0)}`,
      entry_time:   new Date().toISOString(),
    })

    actions.push(`${sym}: OPEN ${bias.toUpperCase()} @ $${entry.toFixed(2)} SL:$${sl.toFixed(2)} TP:$${tp.toFixed(2)}`)
  }

  const { data: allTrades } = await db
    .from('demo_trades')
    .select('pnl, pnl_aed')
    .eq('session_id', session.id)
    .not('exit_time', 'is', null)

  if (allTrades?.length) {
    const wins = allTrades.filter(t => Number(t.pnl) > 0).length
    const losses = allTrades.filter(t => Number(t.pnl) <= 0).length
    const totalPnl = allTrades.reduce((s, t) => s + Number(t.pnl_aed || 0), 0)

    await db.from('demo_sessions').update({
      win_count:    wins,
      loss_count:   losses,
      total_trades: allTrades.length,
      total_pnl:    totalPnl,
      total_pnl_pct: (totalPnl / Number(session.initial_capital)) * 100,
      final_capital: Number(session.initial_capital) + totalPnl,
    }).eq('id', session.id)
  }

  return NextResponse.json({
    success: true,
    session_id: session.id,
    actions,
    timestamp: new Date().toISOString(),
  })
}
