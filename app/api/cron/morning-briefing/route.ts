import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { notifyMorningBriefing } from '@/lib/whatsapp'
import { getDailyBudgetStatus } from '@/lib/anthropic'
import { buildMacroContext, formatMacroContext } from '@/lib/macro-context'
import { sendGroupMessage } from '@/lib/whatsapp'
import type { Signal } from '@/types'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceSupabase()

  const { data: portfolio } = await db.from('portfolio')
    .select('capital, total_pnl')
    .eq('is_demo', false)
    .single()

  const { count: openPositions } = await db.from('positions')
    .select('*', { count: 'exact', head: true })

  const { data: activeSignals } = await db.from('signals')
    .select('*')
    .eq('status', 'active')
    .order('confidence', { ascending: false })
    .limit(3)

  const budget = await getDailyBudgetStatus()

  // Macro snapshot for the briefing
  let macroSummary = ''
  try {
    const macro = await buildMacroContext()
    const lines = []
    if (macro.vix) lines.push(`VIX: ${macro.vix.toFixed(1)}`)
    if (macro.fearGreed != null) lines.push(`Fear&Greed: ${macro.fearGreed}/100 (${macro.fearLabel})`)
    if (macro.dxy) lines.push(`DXY: ${macro.dxy.toFixed(2)}`)
    if (macro.riskLevel) lines.push(`Risk: ${macro.riskLevel}`)
    if (macro.upcomingEvents.length > 0) {
      const highImpact = macro.upcomingEvents.filter(e => e.impact === 'high')
      if (highImpact.length > 0) lines.push(`⚠️ ${highImpact.length} high-impact events today`)
    }
    macroSummary = lines.join(' | ')
  } catch { /* macro fetch failed, skip */ }

  await notifyMorningBriefing(
    {
      capital: portfolio?.capital ?? 5000,
      totalPnl: portfolio?.total_pnl ?? 0,
      openPositions: openPositions ?? 0,
    },
    (activeSignals ?? []) as Signal[],
  )

  // Send macro + budget as follow-up
  if (macroSummary || budget) {
    const extra = [
      macroSummary ? `\n🌍 ${macroSummary}` : '',
      `\n💰 AI Budget: $${budget.remaining.toFixed(2)} remaining`,
    ].join('')
    await sendGroupMessage(extra).catch(() => {})
  }

  return NextResponse.json({ success: true, timestamp: new Date().toISOString() })
}
