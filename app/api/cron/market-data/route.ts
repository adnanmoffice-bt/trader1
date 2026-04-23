import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { fetchAllMarketData, fetchKlines, fetchFearGreed } from '@/lib/price-fetcher'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceSupabase()
  const errors: string[] = []
  const t0 = Date.now()

  // Heartbeat — lets us confirm the cron actually runs on Vercel.
  try {
    await db.from('agent_logs').insert({
      agent: 'market-data-cron',
      level: 'info',
      message: 'start',
    })
  } catch { /* non-critical */ }

  // 1. Fetch latest prices from Binance + Yahoo (parallel, fast)
  let prices: Awaited<ReturnType<typeof fetchAllMarketData>> = []
  try {
    prices = await fetchAllMarketData()
    if (prices.length) {
      // Dedupe by symbol — fetchAllMarketData can return same symbol twice
      // (e.g. XAU/USD from both Binance PAXG and Yahoo GC=F). A batch upsert
      // with ON CONFLICT on 'symbol' fails if the same symbol appears twice.
      // Postgres: "ON CONFLICT DO UPDATE command cannot affect row a second time"
      // This has silently broken the whole market_data table since 2026-04-06.
      // First occurrence wins (Binance is pushed first → crypto-source preferred).
      const seen = new Set<string>()
      const deduped = prices
        .map(({ id: _id, ...rest }) => rest)
        .filter(p => {
          if (seen.has(p.symbol)) return false
          seen.add(p.symbol)
          return true
        })

      const { error } = await db.from('market_data').upsert(deduped, { onConflict: 'symbol' })
      if (error) errors.push(`market_data upsert: ${error.message}`)
    } else {
      errors.push('prices: empty result from fetchAllMarketData')
    }
  } catch (e) {
    errors.push(`prices: ${String(e).slice(0, 120)}`)
  }

  // 2. Store last 5 hourly candles for all tradeable symbols.
  // Uses fetchKlines (universal): Binance for crypto/gold, Yahoo fallback
  // for BRENT, WTI, SPY, forex. Was crypto-only, which left oil dead.
  const candleSymbols = [
    'BTC/USD', 'ETH/USD', 'SOL/USD', 'BNB/USD',
    'DOGE/USD', 'AVAX/USD', 'LINK/USD',
    'XAU/USD',
    'BRENT', 'WTI', 'SPY', 'QQQ',
    'EUR/USD', 'USD/JPY',
  ] as const
  try {
    await Promise.allSettled(
      candleSymbols.map(async (sym) => {
        const candles = await fetchKlines(sym, '1h', 5)
        if (!candles.length) { errors.push(`candles ${sym}: no data`); return }
        const { error } = await db.from('price_history').upsert(
          candles.map(c => ({
            symbol: sym, open: c.open, high: c.high, low: c.low,
            close: c.close, volume: c.volume, interval: '1h',
            timestamp: new Date(c.timestamp).toISOString(),
          })),
          { onConflict: 'symbol,interval,timestamp' }
        )
        if (error) errors.push(`candles ${sym}: ${error.message}`)
      })
    )
  } catch (e) {
    errors.push(`candles: ${String(e).slice(0, 120)}`)
  }

  // 3. Update open positions with current prices
  if (prices.length) {
    try {
      const { data: openPositions } = await db
        .from('positions')
        .select('id, instrument')

      if (openPositions?.length) {
        const priceMap = Object.fromEntries(prices.map(p => [p.symbol, p.price]))
        await Promise.allSettled(
          openPositions
            .filter(p => priceMap[p.instrument])
            .map(p =>
              db.from('positions')
                .update({ current_price: priceMap[p.instrument] })
                .eq('id', p.id)
            )
        )
      }
    } catch {
      // non-critical
    }
  }

  // 4. Fear & Greed (cached, fast)
  let fngValue: number | null = null
  try {
    const fng = await fetchFearGreed(1)
    fngValue = fng[0]?.value ?? null
  } catch {
    // non-critical
  }

  // Close-out log entry — single row summarising the run.
  const summary = `done fetched=${prices.length} fng=${fngValue ?? '?'} errors=${errors.length} dur=${Date.now() - t0}ms`
  try {
    await db.from('agent_logs').insert({
      agent: 'market-data-cron',
      level: errors.length ? 'warn' : 'ok',
      message: errors.length ? `${summary} | ${errors.slice(0, 3).join(' ; ')}` : summary,
    })
  } catch { /* non-critical */ }

  return NextResponse.json({
    success: true,
    fetched: prices.length,
    fear_greed: fngValue,
    duration_ms: Date.now() - t0,
    errors: errors.length ? errors : undefined,
    timestamp: new Date().toISOString(),
  })
}
