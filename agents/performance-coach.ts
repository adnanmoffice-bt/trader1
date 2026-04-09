import { callAgent } from '@/lib/anthropic'
import { createServiceSupabase } from '@/lib/supabase'
import { getPerformanceContext, formatPerformanceForPrompt } from '@/lib/trade-analytics'
import { sendGroupMessage } from '@/lib/whatsapp'

const COACH_SYSTEM = `You are an elite trading performance coach reviewing an AI trading system's performance over the past week.

Analyze the data provided and return ONLY valid JSON:
{
  "overall_grade": "A" | "B" | "C" | "D" | "F",
  "top_mistakes": ["mistake 1", "mistake 2", "mistake 3"],
  "top_strengths": ["strength 1", "strength 2", "strength 3"],
  "specific_recommendations": ["rec 1", "rec 2", "rec 3"],
  "risk_adjustment": "increase" | "maintain" | "decrease",
  "risk_reason": "one sentence why",
  "instruments_to_avoid": ["symbol if any"],
  "instruments_to_focus": ["symbol if any"],
  "optimal_trading_hours": [8, 9, 10, 14, 15],
  "summary": "2-3 sentence executive summary"
}

RULES:
- Be data-driven, cite specific numbers
- If exit efficiency < 50%, this is a critical issue (cutting winners)
- If MAE is consistently > 70% of SL, entries are poorly timed
- Loss streaks > 3 should trigger risk reduction
- Look for time-of-day patterns and instrument-specific patterns
- Kelly fraction > 15% means high edge, < 5% means weak edge
- Be harsh but actionable`

export async function runPerformanceCoach(): Promise<string> {
  const db = createServiceSupabase()

  await db.from('agent_logs').insert({
    agent: 'performance-coach',
    level: 'info',
    message: 'Weekly performance review started',
  })

  const ctx = await getPerformanceContext()
  const perfText = formatPerformanceForPrompt(ctx)

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const weekStart = sevenDaysAgo.toISOString().split('T')[0]

  const { data: weekSnapshots } = await db.from('performance_snapshots').select('*')
    .gte('date', weekStart).order('date', { ascending: true })

  const { data: weekAnalytics } = await db.from('trade_analytics').select('*')
    .gte('computed_at', `${weekStart}T00:00:00`).order('computed_at', { ascending: true })

  const weekSummary = (weekSnapshots ?? []).map(s =>
    `${s.date}: ${s.trade_count} trades, PnL:${(+s.daily_pnl).toFixed(0)}, WR:${(+s.win_rate).toFixed(0)}%, ExitEff:${s.avg_exit_efficiency_pct ?? 'N/A'}%`
  ).join('\n')

  const tradeDetails = (weekAnalytics ?? []).slice(0, 30).map(a =>
    `${a.instrument} ${a.direction}: R:${(+a.r_value).toFixed(2)} MFE:${(+a.mfe_pct).toFixed(1)}% MAE:${(+a.mae_pct).toFixed(1)}% ExitEff:${(+a.exit_efficiency_pct).toFixed(0)}% Hold:${a.holding_duration_mins}min Hour:${a.entry_hour}UTC`
  ).join('\n')

  const result = await callAgent<{
    overall_grade: string
    top_mistakes: string[]
    top_strengths: string[]
    specific_recommendations: string[]
    risk_adjustment: string
    risk_reason: string
    instruments_to_avoid: string[]
    instruments_to_focus: string[]
    optimal_trading_hours: number[]
    summary: string
  }>({
    system: COACH_SYSTEM,
    user: `${perfText}\n\n=== DAILY BREAKDOWN (last 7 days) ===\n${weekSummary || 'No daily data yet'}\n\n=== INDIVIDUAL TRADE ANALYTICS ===\n${tradeDetails || 'No trade analytics yet'}`,
    maxTokens: 800,
    expectJson: true,
  })

  await db.from('agent_knowledge').insert({
    agent_id: 'performance-coach',
    type: 'insight',
    content: result.summary,
    metadata: {
      grade: result.overall_grade,
      mistakes: result.top_mistakes,
      strengths: result.top_strengths,
      recommendations: result.specific_recommendations,
      risk_adjustment: result.risk_adjustment,
      risk_reason: result.risk_reason,
      avoid_instruments: result.instruments_to_avoid,
      focus_instruments: result.instruments_to_focus,
      optimal_hours: result.optimal_trading_hours,
      week_start: weekStart,
      total_trades: ctx.total_trades,
      win_rate: ctx.win_rate,
    },
    active: true,
  })

  const report = `📊 WEEKLY PERFORMANCE REVIEW
Grade: ${result.overall_grade}
${result.summary}

Mistakes: ${result.top_mistakes.join(' | ')}
Strengths: ${result.top_strengths.join(' | ')}
Risk: ${result.risk_adjustment.toUpperCase()} — ${result.risk_reason}
${result.instruments_to_avoid.length ? `Avoid: ${result.instruments_to_avoid.join(', ')}` : ''}
${result.instruments_to_focus.length ? `Focus: ${result.instruments_to_focus.join(', ')}` : ''}
— APEX Performance Coach`

  await sendGroupMessage(report).catch(() => {})

  await db.from('agent_logs').insert({
    agent: 'performance-coach',
    level: 'ok',
    message: `Weekly review: Grade ${result.overall_grade} | Risk: ${result.risk_adjustment} | ${result.summary.slice(0, 100)}`,
  })

  return report
}
