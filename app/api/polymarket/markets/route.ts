import { NextResponse } from 'next/server'
import { fetchTopEvents, fetchMarketPrices } from '@/lib/polymarket-trader'

export async function GET() {
  const events = await fetchTopEvents(10)
  const allMarkets = events.flatMap(e => e.markets).filter(m => m.active)
  const withPrices = await fetchMarketPrices(allMarkets.slice(0, 15))

  return NextResponse.json({
    data: withPrices.map(m => ({
      id:        m.id,
      question:  m.question,
      yes_price: m.yes_price,
      no_price:  m.no_price,
      volume:    m.volume,
      end_date:  m.end_date,
    })),
    success: true,
  })
}
