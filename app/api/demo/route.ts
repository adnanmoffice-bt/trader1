import { NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'

export async function GET() {
  const db = createServiceSupabase()

  const { data: session } = await db
    .from('demo_sessions')
    .select('*')
    .eq('status', 'running')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!session) {
    return NextResponse.json({ data: null, trades: [], success: true })
  }

  const { data: trades } = await db
    .from('demo_trades')
    .select('*')
    .eq('session_id', session.id)
    .order('entry_time', { ascending: false })

  // Get current prices for open trades
  const { data: prices } = await db
    .from('market_data')
    .select('symbol, price')

  const priceMap = Object.fromEntries(
    (prices ?? []).map(p => [p.symbol, Number(p.price)])
  )

  // Enrich open trades with live P&L
  const enrichedTrades = (trades ?? []).map(t => {
    if (t.exit_time) return t
    const cur = priceMap[t.instrument] ?? Number(t.entry_price)
    const entry = Number(t.entry_price)
    const qty = Number(t.quantity)
    const dir = t.direction
    const livePnl = dir === 'long' ? (cur - entry) * qty : (entry - cur) * qty
    return {
      ...t,
      current_price: cur,
      live_pnl: livePnl,
      live_pnl_aed: livePnl * 3.6725,
      live_pnl_pct: (livePnl / (entry * qty)) * 100,
    }
  })

  return NextResponse.json({
    data: session,
    trades: enrichedTrades,
    success: true,
  })
}
