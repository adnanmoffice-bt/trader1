import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { fetchBinanceKlines } from '@/lib/price-fetcher'

export async function GET(req: NextRequest) {
  const params   = req.nextUrl.searchParams
  const symbol   = params.get('symbol')
  const interval = (params.get('interval') ?? '1h') as '1m'|'5m'|'1h'|'4h'|'1d'
  const limit    = parseInt(params.get('limit') ?? '200')

  if (symbol && params.get('candles') === 'true') {
    // Return OHLCV candles for chart
    const candles = await fetchBinanceKlines(symbol, interval, limit)
    return NextResponse.json({ data: candles, success: true })
  }

  // Return latest prices for all instruments
  const db = createServiceSupabase()
  const { data, error } = await db
    .from('market_data')
    .select('*')
    .order('fetched_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data, success: true })
}
