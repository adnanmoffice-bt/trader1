import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { computeTradeAnalytics } from '@/lib/trade-analytics'
import type { OHLCV } from '@/types'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceSupabase()

  const { data: existingIds } = await db.from('trade_analytics').select('trade_id')
  const computed = new Set((existingIds ?? []).map(r => r.trade_id))

  const { data: closedTrades } = await db.from('demo_trades').select('*')
    .not('exit_time', 'is', null)
    .order('exit_time', { ascending: false })
    .limit(200)

  const unprocessed = (closedTrades ?? []).filter(t => !computed.has(t.id))

  if (!unprocessed.length) {
    return NextResponse.json({ success: true, processed: 0, message: 'All trades already analyzed' })
  }

  let processed = 0
  const errors: string[] = []

  for (const trade of unprocessed) {
    try {
      const entryTime = new Date(trade.entry_time).getTime()
      const exitTime = new Date(trade.exit_time).getTime()
      const bufferMs = 3600000

      const { data: candles } = await db.from('price_history').select('*')
        .eq('symbol', trade.instrument)
        .eq('interval', '1h')
        .gte('timestamp', new Date(entryTime - bufferMs).toISOString())
        .lte('timestamp', new Date(exitTime + bufferMs).toISOString())
        .order('timestamp', { ascending: true })

      const ohlcv: OHLCV[] = (candles ?? []).map(c => ({
        timestamp: new Date(c.timestamp).getTime(),
        open: +c.open, high: +c.high, low: +c.low, close: +c.close, volume: +c.volume,
      }))

      if (ohlcv.length < 2) continue

      const result = computeTradeAnalytics({
        id: trade.id,
        instrument: trade.instrument,
        direction: trade.direction,
        entry_price: +trade.entry_price,
        exit_price: +trade.exit_price,
        stop_loss: +trade.stop_loss,
        take_profit: +trade.take_profit,
        quantity: +trade.quantity,
        pnl: +(trade.pnl ?? 0),
        entry_time: trade.entry_time,
        exit_time: trade.exit_time,
      }, ohlcv)

      await db.from('trade_analytics').insert(result)
      processed++
    } catch (err) {
      errors.push(`${trade.id}: ${String(err)}`)
    }
  }

  return NextResponse.json({
    success: true,
    processed,
    total_unprocessed: unprocessed.length,
    errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
  })
}
