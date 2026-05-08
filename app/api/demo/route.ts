import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const db = createServiceSupabase()
  const all = req.nextUrl.searchParams.get('all') === 'true'
  // Research escape hatch: ?include_archived=true returns rows from before
  // the 2026-04-17 SOL/BNB/BB_SQUEEZE cutoff. Default = hide them so the
  // dashboard reflects only the current rule set.
  const includeArchived = req.nextUrl.searchParams.get('include_archived') === 'true'

  const { data: session } = await db
    .from('demo_sessions')
    .select('*')
    .eq('status', 'running')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  let tradesQuery = db.from('demo_trades').select('*').order('entry_time', { ascending: false })
  if (!all && session) {
    tradesQuery = tradesQuery.eq('session_id', session.id)
  }
  if (!includeArchived) {
    tradesQuery = tradesQuery.is('archived_at', null)
  }

  const { data: trades } = await tradesQuery

  const { data: prices } = await db
    .from('market_data')
    .select('symbol, price')

  const priceMap = Object.fromEntries(
    (prices ?? []).map(p => [p.symbol, Number(p.price)])
  )

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
      live_pnl_pct: (livePnl / (entry * qty)) * 100,
    }
  })

  // Also return all session data for full analytics
  const { data: allSessions } = await db
    .from('demo_sessions')
    .select('*')
    .order('created_at', { ascending: false })

  // Diagnostic counter so the UI can show "X archived from legacy config"
  const { count: archivedCount } = await db
    .from('demo_trades')
    .select('*', { count: 'exact', head: true })
    .not('archived_at', 'is', null)

  return NextResponse.json({
    data: session,
    trades: enrichedTrades,
    sessions: allSessions ?? [],
    archived_count: archivedCount ?? 0,
    success: true,
  })
}
