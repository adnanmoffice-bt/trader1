import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { fetchAllMarketData, fetchBinanceKlines, fetchFearGreed } from '@/lib/price-fetcher'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceSupabase()
  const results: Record<string, string> = {}

  // ── Market Data (fast, ~3-5s) ─────────────────────────────────────────────
  try {
    const prices = await fetchAllMarketData()
    if (prices.length) {
      await db.from('market_data').upsert(
        prices.map(({ id: _id, ...rest }) => rest),
        { onConflict: 'symbol' }
      )
    }

    const candleSymbols = ['BTC/USD', 'ETH/USD'] as const
    const candleResults = await Promise.allSettled(
      candleSymbols.map(async (sym) => {
        const candles = await fetchBinanceKlines(sym, '1h', 5)
        if (!candles.length) return 0
        await db.from('price_history').upsert(
          candles.map(c => ({
            symbol: sym, open: c.open, high: c.high, low: c.low,
            close: c.close, volume: c.volume, interval: '1h',
            timestamp: new Date(c.timestamp).toISOString(),
          })),
          { onConflict: 'symbol,interval,timestamp' }
        )
        return candles.length
      })
    )

    const fng = await fetchFearGreed(1)
    results.market = `${prices.length} prices, candles OK, F&G: ${fng[0]?.value ?? '?'}`
  } catch (e) {
    results.market = `error: ${String(e).slice(0, 80)}`
  }

  // Signals, demo, polymarket run on their own Vercel cron schedules.
  // No dispatch here — avoids double-execution and wasted AI tokens.
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_APP_URL || 'https://trader1-nu.vercel.app'
  const headers = { Authorization: `Bearer ${process.env.CRON_SECRET}` }

  after(async () => {
    try {
      await Promise.allSettled([
        fetch(`${baseUrl}/api/cron/demo`, { headers }).catch(() => {}),
      ])
    } catch {
      console.error('[run-all] dispatch error')
    }
  })

  results.dispatched = 'demo only (signals+polymarket on own cron)'

  return NextResponse.json({
    success: true,
    results,
    timestamp: new Date().toISOString(),
  })
}
