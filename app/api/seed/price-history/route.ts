import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { fetchBinanceKlines } from '@/lib/price-fetcher'

export const runtime = 'nodejs'
export const maxDuration = 300

const SEED_SYMBOLS = ['BTC/USD', 'ETH/USD'] as const

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceSupabase()
  const results: Record<string, number> = {}
  const errors: string[] = []

  for (const sym of SEED_SYMBOLS) {
    const candles = await fetchBinanceKlines(sym, '1h', 200)
    if (!candles.length) {
      errors.push(`${sym}: no candles returned`)
      continue
    }

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

    if (error) {
      errors.push(`${sym}: ${error.message}`)
    } else {
      results[sym] = candles.length
    }
  }

  return NextResponse.json({
    success: true,
    seeded: results,
    errors: errors.length ? errors : undefined,
    timestamp: new Date().toISOString(),
  })
}
