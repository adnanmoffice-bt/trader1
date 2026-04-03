import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import * as binance from '@/lib/binance-trader'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceSupabase()
  const results: string[] = []

  // 1. Cancel all open Binance orders
  if (binance.isConfigured()) {
    for (const instrument of ['BTC/USD', 'ETH/USD', 'SOL/USD']) {
      try {
        await binance.cancelAllOrders(instrument)
        results.push(`Cancelled orders for ${instrument}`)
      } catch { /* ok */ }
    }
  }

  // 2. Sell all open positions at market
  const { data: positions } = await db.from('positions').select('*').eq('is_demo', false)
  if (positions?.length && binance.isConfigured()) {
    for (const pos of positions) {
      try {
        const qty = Number(pos.quantity)
        if (qty > 0) {
          await binance.executeSell(pos.instrument, qty)
          results.push(`Sold ${pos.instrument} qty:${qty}`)
        }
      } catch (err) {
        results.push(`Failed to sell ${pos.instrument}: ${String(err)}`)
      }
    }
  }

  // 3. Delete all positions from DB
  await db.from('positions').delete().eq('is_demo', false)

  // 4. Cancel all active signals
  await db.from('signals').update({ status: 'cancelled' }).eq('status', 'active')

  // 5. Log the kill switch event
  await db.from('agent_logs').insert({
    agent: 'risk-manager',
    level: 'warn',
    message: `KILL SWITCH ACTIVATED — all positions closed, all orders cancelled, all signals cancelled`,
  })

  return NextResponse.json({
    success: true,
    message: 'Kill switch activated — all positions closed',
    actions: results,
    timestamp: new Date().toISOString(),
  })
}
