import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { notifyDailySummary } from '@/lib/whatsapp'
import { getDailyBudgetStatus } from '@/lib/anthropic'
import { sendGroupMessage } from '@/lib/whatsapp'
import { dubaiDayStartUTC } from '@/lib/safety'
import { fetchBinanceTicker } from '@/lib/price-fetcher'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceSupabase()
  // Use Dubai day boundary (UTC+4), not UTC midnight.
  const dayStartISO = dubaiDayStartUTC().toISOString()

  // Trades closed since Dubai midnight
  const { data: todayTrades } = await db.from('trades')
    .select('pnl, status')
    .gte('closed_at', dayStartISO)
    .eq('status', 'closed')

  const { data: demoTrades } = await db.from('demo_trades')
    .select('pnl, exit_reason')
    .gte('exit_time', dayStartISO)
    .not('exit_time', 'is', null)

  const allTrades = [
    ...(todayTrades ?? []).map(t => ({ pnl: +(t.pnl ?? 0) })),
    ...(demoTrades ?? []).map(t => ({ pnl: +(t.pnl ?? 0) })),
  ]

  const wins = allTrades.filter(t => t.pnl > 0).length
  const losses = allTrades.filter(t => t.pnl <= 0).length
  const dailyPnl = allTrades.reduce((s, t) => s + t.pnl, 0)
  const winRate = allTrades.length > 0 ? (wins / allTrades.length) * 100 : 0

  const { data: portfolio } = await db.from('portfolio')
    .select('capital')
    .eq('is_demo', false)
    .single()

  // Signals generated today (Dubai)
  const { count: signalsToday } = await db.from('signals')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', dayStartISO)

  // War room meetings today (Dubai)
  const { count: meetingsToday } = await db.from('war_room_messages')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'decision')
    .gte('created_at', dayStartISO)

  // Open positions — compute unrealized P&L for honest reporting
  const { data: openDemoTrades } = await db.from('demo_trades')
    .select('instrument, direction, entry_price, quantity, entry_time')
    .is('exit_time', null)

  let unrealizedPnl = 0
  const openLines: string[] = []
  for (const t of openDemoTrades ?? []) {
    const ticker = await fetchBinanceTicker(t.instrument as string).catch(() => null)
    if (!ticker) continue
    const entry = Number(t.entry_price)
    const qty = Number(t.quantity)
    const pnl = String(t.direction) === 'long'
      ? (ticker.price - entry) * qty
      : (entry - ticker.price) * qty
    unrealizedPnl += pnl
    openLines.push(`${t.instrument}: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(0)}`)
  }

  // Session-level cumulative context
  const { data: activeSession } = await db.from('demo_sessions')
    .select('initial_capital, total_pnl, total_pnl_pct, win_count, loss_count, total_trades')
    .eq('status', 'running')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  await notifyDailySummary({
    total_trades: allTrades.length,
    wins,
    losses,
    daily_pnl: dailyPnl,
    capital: portfolio?.capital ?? 5000,
    win_rate: winRate,
  })

  // Follow-up with cumulative context so morning-vs-evening stays consistent
  const budget = await getDailyBudgetStatus()
  const cumLine = activeSession
    ? `Session ${activeSession.win_count}W/${activeSession.loss_count}L of ${activeSession.total_trades} | ${activeSession.total_pnl >= 0 ? '+' : ''}$${Number(activeSession.total_pnl).toFixed(0)} (${Number(activeSession.total_pnl_pct).toFixed(1)}%)`
    : ''
  const openLine = openLines.length
    ? `Open unrealized: ${unrealizedPnl >= 0 ? '+' : ''}$${unrealizedPnl.toFixed(0)} (${openLines.join(', ')})`
    : 'No open positions'
  const statsMsg = `📊 APEX Daily Report (Dubai day)
Today realized: ${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(0)} (${wins}W/${losses}L)
${openLine}
${cumLine}
Signals: ${signalsToday ?? 0} | Debates: ${meetingsToday ?? 0}
AI spend: $${budget.spent.toFixed(2)} / $${budget.budget.toFixed(2)}
— APEX AI`

  await sendGroupMessage(statsMsg).catch(() => {})

  return NextResponse.json({
    success: true,
    trades: allTrades.length, wins, losses,
    daily_pnl: +dailyPnl.toFixed(2),
    unrealized_pnl: +unrealizedPnl.toFixed(2),
    cumulative_pnl: Number(activeSession?.total_pnl ?? 0),
    timestamp: new Date().toISOString(),
  })
}
