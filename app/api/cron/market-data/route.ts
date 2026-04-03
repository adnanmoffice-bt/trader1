import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { fetchAllMarketData, fetchBinanceKlines, fetchFearGreed } from '@/lib/price-fetcher'

export const runtime = 'nodejs'
export const maxDuration = 60

function verifyCron(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

export async function GET(req: NextRequest) {
  const authErr = verifyCron(req)
  if (authErr) return authErr

  const db = createServiceSupabase()
  const errors: string[] = []

  // 1. Fetch latest prices
  const prices = await fetchAllMarketData()

  // 2. Upsert into market_data table
  if (prices.length) {
    const { error } = await db.from('market_data').upsert(
      prices.map(p => ({ ...p, id: undefined })),
      { onConflict: 'symbol' }
    )
    if (error) errors.push(`market_data upsert: ${error.message}`)
  }

  // 3. Store candles in price_history for charting & signals
  const candleSymbols = ['BTC/USD', 'ETH/USD', 'BRENT'] as const
  for (const sym of candleSymbols) {
    const candles = await fetchBinanceKlines(sym, '1h', 5)
    if (!candles.length) continue

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
    if (error) errors.push(`price_history ${sym}: ${error.message}`)
  }

  // 4. Update open positions with current prices
  const { data: openPositions } = await db
    .from('positions')
    .select('id, instrument')
    .eq('status', 'open')

  if (openPositions?.length) {
    const priceMap = Object.fromEntries(prices.map(p => [p.symbol, p.price]))
    const updates  = openPositions
      .filter(p => priceMap[p.instrument])
      .map(p => ({ id: p.id, current_price: priceMap[p.instrument] }))

    if (updates.length) {
      await Promise.all(
        updates.map(u =>
          db.from('positions').update({ current_price: u.current_price }).eq('id', u.id)
        )
      )
    }
  }

  // 5. Check stop-losses and take-profits
  await checkPositionLevels(db, prices)

  // 6. Fetch Fear & Greed (once per run, TTL handled by fetch cache)
  const fng = await fetchFearGreed(1)
  const fngValue = fng[0]?.value ?? null

  return NextResponse.json({
    success: true,
    fetched: prices.length,
    fear_greed: fngValue,
    errors: errors.length ? errors : undefined,
    timestamp: new Date().toISOString(),
  })
}

async function checkPositionLevels(
  db: ReturnType<typeof createServiceSupabase>,
  prices: Array<{ symbol: string; price: number }>
) {
  const priceMap = Object.fromEntries(prices.map(p => [p.symbol, p.price]))
  const { data: positions } = await db
    .from('positions')
    .select('*')

  if (!positions) return

  for (const pos of positions) {
    const cur = priceMap[pos.instrument]
    if (!cur) continue

    const hitSL = pos.stop_loss && (
      (pos.direction === 'long'  && cur <= pos.stop_loss) ||
      (pos.direction === 'short' && cur >= pos.stop_loss)
    )
    const hitTP = pos.take_profit && (
      (pos.direction === 'long'  && cur >= pos.take_profit) ||
      (pos.direction === 'short' && cur <= pos.take_profit)
    )

    if (hitSL || hitTP) {
      const reason = hitSL ? 'stop_loss' : 'take_profit'
      const pnl = pos.direction === 'long'
        ? (cur - pos.avg_entry_price) * pos.quantity
        : (pos.avg_entry_price - cur) * pos.quantity
      const pnlPct = (pnl / (pos.avg_entry_price * pos.quantity)) * 100

      // Close position
      await db.from('positions').delete().eq('id', pos.id)

      // Update trade record
      await db.from('trades')
        .update({
          status:    hitSL ? 'stopped' : 'closed',
          exit_price: cur,
          pnl,
          pnl_pct:   pnlPct,
          pnl_aed:   pnl * 3.6725,
          closed_at: new Date().toISOString(),
        })
        .eq('instrument', pos.instrument)
        .eq('status', 'open')

      // Update portfolio
      await db.rpc('update_portfolio_on_close', {
        p_user_id: pos.user_id,
        p_pnl:     pnl,
        p_is_demo: pos.is_demo,
        p_won:     pnl > 0,
      })

      console.log(`[positions] ${pos.instrument} ${reason} hit at ${cur}`)
    }
  }
}
