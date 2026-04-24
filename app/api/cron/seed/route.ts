import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { fetchAllMarketData, fetchBinanceKlines, fetchFearGreed } from '@/lib/price-fetcher'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceSupabase()
  const results: Record<string, string> = {}

  // 1. Fetch 200 hourly candles for each symbol (needed for indicators/signals)
  const symbols = [
    'BTC/USD', 'ETH/USD', 'SOL/USD', 'BNB/USD',
    'DOGE/USD', 'AVAX/USD', 'LINK/USD', 'XAU/USD',
    'ADA/USD', 'DOT/USD', 'MATIC/USD', 'NEAR/USD', 'APT/USD',
  ] as const
  for (const sym of symbols) {
    try {
      const candles = await fetchBinanceKlines(sym, '1h', 500)
      if (candles.length) {
        const rows = candles.map(c => ({
          symbol:    sym,
          open:      c.open,
          high:      c.high,
          low:       c.low,
          close:     c.close,
          volume:    c.volume,
          interval:  '1h',
          timestamp: new Date(c.timestamp).toISOString(),
        }))

        const { error } = await db.from('price_history').upsert(rows, {
          onConflict: 'symbol,interval,timestamp',
        })
        results[`candles_${sym}`] = error
          ? `error: ${error.message}`
          : `${candles.length} candles stored`
      }
    } catch (e) {
      results[`candles_${sym}`] = `error: ${String(e).slice(0, 80)}`
    }
  }

  // 2. Fetch 4h candles too
  for (const sym of ['BTC/USD', 'ETH/USD'] as const) {
    try {
      const candles = await fetchBinanceKlines(sym, '4h', 200)
      if (candles.length) {
        const rows = candles.map(c => ({
          symbol:    sym,
          open:      c.open,
          high:      c.high,
          low:       c.low,
          close:     c.close,
          volume:    c.volume,
          interval:  '4h',
          timestamp: new Date(c.timestamp).toISOString(),
        }))
        await db.from('price_history').upsert(rows, {
          onConflict: 'symbol,interval,timestamp',
        })
        results[`candles_4h_${sym}`] = `${candles.length} candles`
      }
    } catch (e) {
      results[`candles_4h_${sym}`] = `error: ${String(e).slice(0, 80)}`
    }
  }

  // 3. Current prices
  try {
    const prices = await fetchAllMarketData()
    if (prices.length) {
      await db.from('market_data').upsert(
        prices.map(({ id: _id, ...rest }) => rest),
        { onConflict: 'symbol' }
      )
    }
    results.prices = `${prices.length} symbols`
  } catch (e) {
    results.prices = `error: ${String(e).slice(0, 80)}`
  }

  // 4. Fear & Greed
  try {
    const fng = await fetchFearGreed(1)
    results.fear_greed = fng[0]?.value?.toString() ?? 'N/A'
  } catch {
    results.fear_greed = 'error'
  }

  // 5. Ensure demo session exists
  try {
    const { data: existing } = await db
      .from('demo_sessions')
      .select('id')
      .eq('status', 'running')
      .limit(1)
      .single()

    if (!existing) {
      const today = new Date()
      const endDate = new Date(today)
      endDate.setDate(endDate.getDate() + 5)

      await db.from('demo_sessions').insert({
        start_date:      today.toISOString().split('T')[0],
        end_date:        endDate.toISOString().split('T')[0],
        initial_capital: 5000,
        status:          'running',
      })
      results.demo = 'session created'
    } else {
      results.demo = `session exists: ${existing.id}`
    }
  } catch (e) {
    results.demo = `error: ${String(e).slice(0, 80)}`
  }

  // 6. Verify data counts
  const { count: candleCount } = await db.from('price_history').select('*', { count: 'exact', head: true })
  const { count: priceCount } = await db.from('market_data').select('*', { count: 'exact', head: true })
  results.totals = `${candleCount ?? 0} candles, ${priceCount ?? 0} prices in DB`

  return NextResponse.json({
    success: true,
    results,
    timestamp: new Date().toISOString(),
  })
}
