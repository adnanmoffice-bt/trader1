import { NextResponse } from 'next/server'
import { getDailyBudgetStatus } from '@/lib/anthropic'
import { createServiceSupabase } from '@/lib/supabase'

// GET /api/budget
// Returns:
//   today      — {spent,budget,remaining,calls,exhausted} from getDailyBudgetStatus
//   last7d     — [{date, spent, calls}] sorted oldest → newest
//   allTime    — {spent, calls} from full agent_logs.budget-tracker history
//   byModel    — today's spend split by model
//   lastCallAt — ISO timestamp of most recent Anthropic call
export async function GET() {
  const today = await getDailyBudgetStatus()
  const db = createServiceSupabase()
  const todayKey = new Date().toISOString().slice(0, 10)
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)

  const { data: rows } = await db
    .from('agent_logs')
    .select('created_at, metadata')
    .eq('agent', 'budget-tracker')
    .gte('created_at', `${sevenDaysAgo}T00:00:00Z`)
    .order('created_at', { ascending: false })
    .limit(10000)

  const byDay = new Map<string, { spent: number; calls: number }>()
  const byModelToday = new Map<string, { spent: number; calls: number }>()
  let lastCallAt: string | null = null

  for (const r of rows ?? []) {
    const meta = r.metadata as Record<string, unknown> | null
    const cost = Number(meta?.cost_usd ?? 0)
    const day = String(r.created_at).slice(0, 10)
    const cur = byDay.get(day) ?? { spent: 0, calls: 0 }
    cur.spent += cost
    cur.calls += 1
    byDay.set(day, cur)

    if (day === todayKey) {
      const model = String(meta?.model ?? 'unknown')
      const m = byModelToday.get(model) ?? { spent: 0, calls: 0 }
      m.spent += cost
      m.calls += 1
      byModelToday.set(model, m)
    }

    if (!lastCallAt || r.created_at > lastCallAt) lastCallAt = r.created_at
  }

  const last7d: Array<{ date: string; spent: number; calls: number }> = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10)
    const v = byDay.get(d) ?? { spent: 0, calls: 0 }
    last7d.push({ date: d, spent: +v.spent.toFixed(4), calls: v.calls })
  }

  const { data: allRows } = await db
    .from('agent_logs')
    .select('metadata')
    .eq('agent', 'budget-tracker')
    .limit(50000)

  let allSpent = 0
  let allCalls = 0
  for (const r of allRows ?? []) {
    const cost = Number((r.metadata as Record<string, unknown> | null)?.cost_usd ?? 0)
    allSpent += cost
    allCalls += 1
  }

  return NextResponse.json({
    today,
    last7d,
    allTime: { spent: +allSpent.toFixed(4), calls: allCalls },
    byModel: Object.fromEntries(
      [...byModelToday.entries()].map(([k, v]) => [k, { spent: +v.spent.toFixed(4), calls: v.calls }]),
    ),
    lastCallAt,
  })
}
