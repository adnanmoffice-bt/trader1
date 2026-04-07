import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { notifyWeeklyReport } from '@/lib/whatsapp'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceSupabase()
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString()

  // All trades closed this week (real + demo)
  const { data: weekTrades } = await db.from('trades')
    .select('instrument, direction, pnl, status')
    .gte('closed_at', weekAgo)
    .eq('status', 'closed')

  const { data: weekDemo } = await db.from('demo_trades')
    .select('instrument, direction, pnl, exit_reason')
    .gte('exit_time', weekAgo)
    .not('exit_time', 'is', null)

  const allTrades = [
    ...(weekTrades ?? []).map(t => ({
      instrument: t.instrument, direction: t.direction,
      pnl: +(t.pnl ?? 0),
    })),
    ...(weekDemo ?? []).map(t => ({
      instrument: t.instrument, direction: t.direction,
      pnl: +(t.pnl ?? 0),
    })),
  ]

  const wins = allTrades.filter(t => t.pnl > 0).length
  const losses = allTrades.filter(t => t.pnl <= 0).length
  const weeklyPnl = allTrades.reduce((s, t) => s + t.pnl, 0)
  const winRate = allTrades.length > 0 ? (wins / allTrades.length) * 100 : 0

  const sorted = [...allTrades].sort((a, b) => b.pnl - a.pnl)
  const best = sorted[0]
  const worst = sorted[sorted.length - 1]

  // Sharpe approximation (annualized from daily returns)
  let sharpe: number | undefined
  if (allTrades.length >= 5) {
    const returns = allTrades.map(t => t.pnl)
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length
    const stdDev = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length)
    if (stdDev > 0) sharpe = (mean / stdDev) * Math.sqrt(252)
  }

  const { data: portfolio } = await db.from('portfolio')
    .select('capital')
    .eq('is_demo', false)
    .single()

  await notifyWeeklyReport({
    totalTrades: allTrades.length,
    wins,
    losses,
    weeklyPnl,
    capital: portfolio?.capital ?? 5000,
    winRate,
    bestTrade: best ? `${best.instrument} ${best.direction} +$${best.pnl.toFixed(0)}` : 'None',
    worstTrade: worst ? `${worst.instrument} ${worst.direction} $${worst.pnl.toFixed(0)}` : 'None',
    sharpe,
  })

  return NextResponse.json({
    success: true,
    trades: allTrades.length, wins, losses,
    weekly_pnl: +weeklyPnl.toFixed(2),
    timestamp: new Date().toISOString(),
  })
}
