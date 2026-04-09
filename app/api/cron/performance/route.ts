import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { computeDailySnapshot } from '@/lib/trade-analytics'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceSupabase()
  const today = new Date().toISOString().split('T')[0]

  const snapshot = await computeDailySnapshot(today)

  await db.from('performance_snapshots').upsert(snapshot, { onConflict: 'date' })

  await db.from('agent_logs').insert({
    agent: 'performance-engine',
    level: 'ok',
    message: `Daily snapshot: ${snapshot.trade_count} trades, PnL: ${snapshot.daily_pnl.toFixed(0)}, Equity: ${snapshot.equity.toFixed(0)}, WR: ${snapshot.win_rate.toFixed(0)}%, PF: ${snapshot.profit_factor?.toFixed(2) ?? 'N/A'}, Streak: ${snapshot.win_streak}W/${snapshot.loss_streak}L`,
    metadata: {
      exit_efficiency: snapshot.avg_exit_efficiency_pct,
      kelly: snapshot.kelly_fraction,
      drawdown: snapshot.current_drawdown_pct,
    },
  })

  // Weekly performance coach trigger (Sunday)
  const dayOfWeek = new Date().getUTCDay()
  let coachReport: string | null = null

  if (dayOfWeek === 0) {
    try {
      const { runPerformanceCoach } = await import('@/agents/performance-coach')
      coachReport = await runPerformanceCoach()
    } catch (err) {
      console.error('[performance-cron] Coach failed:', err)
    }
  }

  return NextResponse.json({
    success: true,
    snapshot: {
      date: snapshot.date,
      equity: snapshot.equity,
      daily_pnl: snapshot.daily_pnl,
      trade_count: snapshot.trade_count,
      win_rate: snapshot.win_rate,
    },
    coach_triggered: dayOfWeek === 0,
    coach_report: coachReport?.slice(0, 200),
  })
}
