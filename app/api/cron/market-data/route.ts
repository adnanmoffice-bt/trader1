import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { fetchAllMarketData, fetchBinanceKlines, fetchFearGreed } from '@/lib/price-fetcher'

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

  // 1. Fetch latest prices from Binance (parallel, fast)
  let prices: Awaited<ReturnType<typeof fetchAllMarketData>> = []
  try {
    prices = await fetchAllMarketData()
    if (prices.length) {
      const { error } = await db.from('market_data').upsert(
        prices.map(({ id: _id, ...rest }) => rest),
        { onConflict: 'symbol' }
      )
      if (error) errors.push(`market_data upsert: ${error.message}`)
    }
  } catch (e) {
    errors.push(`prices: ${String(e).slice(0, 60)}`)
  }

  // 2. Store last 5 hourly candles (parallel)
  const candleSymbols = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'BNB/USD'] as const
  try {
    await Promise.allSettled(
      candleSymbols.map(async (sym) => {
        const candles = await fetchBinanceKlines(sym, '1h', 5)
        if (!candles.length) return
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
    errors.push(`candles: ${String(e).slice(0, 60)}`)
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

  return NextResponse.json({
    success: true,
    fetched: prices.length,
    fear_greed: fngValue,
    duration_ms: Date.now() - t0,
    errors: errors.length ? errors : undefined,
    timestamp: new Date().toISOString(),
  })
}
