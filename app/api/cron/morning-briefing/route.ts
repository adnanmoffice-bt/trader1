import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { notifyMorningBriefing } from '@/lib/whatsapp'
import { getDailyBudgetStatus } from '@/lib/anthropic'
import { buildMacroContext } from '@/lib/macro-context'
import { sendGroupMessage } from '@/lib/whatsapp'
import { dubaiDayStartUTC } from '@/lib/safety'
import { fetchBinanceTicker } from '@/lib/price-fetcher'
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

  // Yesterday's realized P&L (Dubai day just ended)
  const yesterdayStart = new Date(dubaiDayStartUTC().getTime() - 24 * 3600_000).toISOString()
  const todayStart = dubaiDayStartUTC().toISOString()
  const { data: yesterdayDemoTrades } = await db.from('demo_trades')
    .select('pnl')
    .not('exit_time', 'is', null)
    .gte('exit_time', yesterdayStart)
    .lt('exit_time', todayStart)
  const yesterdayPnl = (yesterdayDemoTrades ?? []).reduce((s, t) => s + Number(t.pnl || 0), 0)
  const yesterdayWins = (yesterdayDemoTrades ?? []).filter(t => Number(t.pnl) > 0).length
  const yesterdayLosses = (yesterdayDemoTrades ?? []).filter(t => Number(t.pnl) <= 0).length

  // Open demo positions unrealized P&L
  const { data: openDemoTrades } = await db.from('demo_trades')
    .select('instrument, direction, entry_price, quantity')
    .is('exit_time', null)
  let unrealizedPnl = 0
  for (const t of openDemoTrades ?? []) {
    const ticker = await fetchBinanceTicker(t.instrument as string).catch(() => null)
    if (!ticker) continue
    const entry = Number(t.entry_price); const qty = Number(t.quantity)
    unrealizedPnl += String(t.direction) === 'long'
      ? (ticker.price - entry) * qty
      : (entry - ticker.price) * qty
  }

  // Session cumulative for context
  const { data: session } = await db.from('demo_sessions')
    .select('total_pnl, total_pnl_pct, win_count, loss_count, total_trades')
    .eq('status', 'running')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  await notifyMorningBriefing(
    {
      capital: portfolio?.capital ?? 5000,
      totalPnl: portfolio?.total_pnl ?? 0,
      openPositions: openPositions ?? 0,
    },
    (activeSignals ?? []) as Signal[],
  )

  const extras: string[] = []
  extras.push(`\n📊 Yesterday (Dubai): ${yesterdayPnl >= 0 ? '+' : ''}$${yesterdayPnl.toFixed(0)} (${yesterdayWins}W/${yesterdayLosses}L)`)
  if ((openDemoTrades ?? []).length > 0) {
    extras.push(`📂 Open unrealized: ${unrealizedPnl >= 0 ? '+' : ''}$${unrealizedPnl.toFixed(0)} (${(openDemoTrades ?? []).length} positions)`)
  }
  if (session) {
    extras.push(`💼 Session total: ${session.total_pnl >= 0 ? '+' : ''}$${Number(session.total_pnl).toFixed(0)} (${Number(session.total_pnl_pct).toFixed(1)}%) | ${session.win_count}W/${session.loss_count}L`)
  }
  if (macroSummary) extras.push(`🌍 ${macroSummary}`)
  extras.push(`💰 AI Budget: $${budget.remaining.toFixed(2)} remaining`)

  await sendGroupMessage(extras.join('\n')).catch(() => {})

  return NextResponse.json({
    success: true,
    yesterday_pnl: +yesterdayPnl.toFixed(2),
    unrealized_pnl: +unrealizedPnl.toFixed(2),
    session_pnl: Number(session?.total_pnl ?? 0),
    timestamp: new Date().toISOString(),
  })
}
