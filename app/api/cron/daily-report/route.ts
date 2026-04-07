import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { notifyDailySummary } from '@/lib/whatsapp'
import { getDailyBudgetStatus } from '@/lib/anthropic'
import { sendGroupMessage } from '@/lib/whatsapp'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceSupabase()
  const today = new Date().toISOString().split('T')[0]

  // Trades closed today
  const { data: todayTrades } = await db.from('trades')
    .select('pnl_usd, pnl_aed, pnl_pct, status')
    .gte('closed_at', `${today}T00:00:00`)
    .eq('status', 'closed')

  // Also check demo_trades
  const { data: demoTrades } = await db.from('demo_trades')
    .select('pnl_usd, pnl_aed, pnl_pct, exit_reason')
    .gte('exit_time', `${today}T00:00:00`)
    .not('exit_time', 'is', null)

  const allTrades = [
    ...(todayTrades ?? []).map(t => ({ pnl: +(t.pnl_usd ?? t.pnl_aed ?? 0) })),
    ...(demoTrades ?? []).map(t => ({ pnl: +(t.pnl_usd ?? t.pnl_aed ?? 0) })),
  ]

  const wins = allTrades.filter(t => t.pnl > 0).length
  const losses = allTrades.filter(t => t.pnl <= 0).length
  const dailyPnl = allTrades.reduce((s, t) => s + t.pnl, 0)
  const winRate = allTrades.length > 0 ? (wins / allTrades.length) * 100 : 0

  const { data: portfolio } = await db.from('portfolio')
    .select('capital')
    .eq('is_demo', false)
    .single()

  // Signals generated today
  const { count: signalsToday } = await db.from('signals')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', `${today}T00:00:00`)

  // War room meetings today
  const { count: meetingsToday } = await db.from('war_room_messages')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'decision')
    .gte('created_at', `${today}T00:00:00`)

  await notifyDailySummary({
    total_trades: allTrades.length,
    wins,
    losses,
    daily_pnl: dailyPnl,
    capital: portfolio?.capital ?? 5000,
    win_rate: winRate,
  })

  // Follow-up with system stats
  const budget = getDailyBudgetStatus()
  const statsMsg = `📊 System stats today:
${signalsToday ?? 0} signals generated | ${meetingsToday ?? 0} War Room meetings
AI spend: $${budget.spent.toFixed(2)} / $${budget.budget.toFixed(2)} (${budget.calls} calls)
— APEX AI`

  await sendGroupMessage(statsMsg).catch(() => {})

  return NextResponse.json({
    success: true,
    trades: allTrades.length, wins, losses,
    daily_pnl: +dailyPnl.toFixed(2),
    timestamp: new Date().toISOString(),
  })
}
