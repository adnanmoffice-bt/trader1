import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { fetchAllMarketData, fetchBinanceKlines, fetchFearGreed } from '@/lib/price-fetcher'
import { runOrchestrator } from '@/agents'
import { runPolymarketScanner } from '@/agents'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceSupabase()
  const results: Record<string, string> = {}

  // 1. Market Data
  try {
    const prices = await fetchAllMarketData()
    if (prices.length) {
      await db.from('market_data').upsert(
        prices.map(({ id: _id, ...rest }) => rest),
        { onConflict: 'symbol' }
      )
    }
    const candleSymbols = ['BTC/USD', 'ETH/USD'] as const
    for (const sym of candleSymbols) {
      const candles = await fetchBinanceKlines(sym, '1h', 5)
      if (candles.length) {
        await db.from('price_history').upsert(
          candles.map(c => ({
            symbol: sym, open: c.open, high: c.high, low: c.low,
            close: c.close, volume: c.volume, interval: '1h',
            timestamp: new Date(c.timestamp).toISOString(),
          })),
          { onConflict: 'symbol,interval,timestamp' }
        )
      }
    }
    const fng = await fetchFearGreed(1)
    results.market = `${prices.length} prices, F&G: ${fng[0]?.value ?? '?'}`
  } catch (e) { results.market = `error: ${String(e).slice(0, 60)}` }

  // 2. AI Signals
  try {
    await runOrchestrator()
    results.signals = 'ok'
  } catch (e) { results.signals = `error: ${String(e).slice(0, 60)}` }

  // 3. Demo trading - check positions
  try {
    const { data: session } = await db.from('demo_sessions').select('*')
      .eq('status', 'running').order('created_at', { ascending: false }).limit(1).single()

    if (session) {
      const { data: openTrades } = await db.from('demo_trades').select('*')
        .eq('session_id', session.id).is('exit_time', null)

      let closed = 0
      for (const trade of openTrades ?? []) {
        const { data: md } = await db.from('market_data').select('price')
          .eq('symbol', trade.instrument).single()
        if (!md) continue
        const price = Number(md.price)
        const sl = Number(trade.stop_loss)
        const tp = Number(trade.take_profit)
        const entry = Number(trade.entry_price)
        const qty = Number(trade.quantity)
        const dir = trade.direction

        const hitSL = (dir === 'long' && price <= sl) || (dir === 'short' && price >= sl)
        const hitTP = (dir === 'long' && price >= tp) || (dir === 'short' && price <= tp)

        if (hitSL || hitTP) {
          const exitP = hitSL ? sl : tp
          const pnl = dir === 'long' ? (exitP - entry) * qty : (entry - exitP) * qty
          await db.from('demo_trades').update({
            exit_price: exitP, exit_time: new Date().toISOString(),
            exit_reason: hitSL ? 'stop_loss' : 'take_profit',
            pnl, pnl_pct: (pnl / (entry * qty)) * 100, pnl_aed: pnl * 3.6725,
          }).eq('id', trade.id)
          closed++
        }
      }
      results.demo = `checked ${openTrades?.length ?? 0} positions, closed ${closed}`
    } else {
      results.demo = 'no active session'
    }
  } catch (e) { results.demo = `error: ${String(e).slice(0, 60)}` }

  // 4. Polymarket
  try {
    const pm = await runPolymarketScanner()
    results.polymarket = `scanned ${pm.scanned}, bets ${pm.bets}`
  } catch (e) { results.polymarket = `error: ${String(e).slice(0, 60)}` }

  return NextResponse.json({ success: true, results, timestamp: new Date().toISOString() })
}
