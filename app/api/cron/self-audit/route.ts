/**
 * /api/cron/self-audit
 *
 * Runs every 6h. Self-checks the system since the last audit window and
 * posts a plain-English health + activity summary to the WhatsApp group.
 *
 * Three classes of checks:
 *  1. Health regressions — counts of failures that should be ~0 if the
 *     2026-05-07 fixes are still holding (data-quality fails, AI 404s,
 *     false loss-streak pauses).
 *  2. Activity — rotation closes, meetings opened, signals, trades.
 *  3. Coverage — per-instrument candle freshness (stale-by-asset-class).
 *
 * Read-only. Safe to invoke manually with CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { notifySelfAudit, type SelfAuditPayload } from '@/lib/whatsapp'

export const runtime = 'nodejs'
export const maxDuration = 60

// Asset-class freshness budgets (minutes). Anything older than this is
// flagged as stale in the WA report. Mirrors the thresholds in
// lib/data-quality.ts so the audit and the validator agree.
const STALE_BUDGET_MIN: Record<string, number> = {
  // Crypto: 24/7 — anything > 2h is genuinely a feed problem
  'BTC/USD': 120, 'ETH/USD': 120, 'DOGE/USD': 120, 'AVAX/USD': 120,
  'LINK/USD': 120, 'ADA/USD': 120, 'DOT/USD': 120, 'MATIC/USD': 120,
  'NEAR/USD': 120, 'APT/USD': 120, 'XAU/USD': 120,
  // FX: 24/5 with weekend gap
  'EUR/USD': 90, 'GBP/USD': 90, 'USD/JPY': 90, 'XAG/USD': 90,
  // Energy futures: ~23h/d weekday
  'WTI': 240, 'BRENT': 240,
  // US equities: closed overnight + weekends → very loose
  'SPY': 18 * 60, 'QQQ': 18 * 60,
}

const ALL_INSTRUMENTS = Object.keys(STALE_BUDGET_MIN)

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceSupabase()
  const t0 = Date.now()
  const WINDOW_H = 6
  const since = new Date(Date.now() - WINDOW_H * 3600_000).toISOString()

  await db.from('agent_logs').insert({ agent: 'self-audit-cron', level: 'info', message: 'starting' }).then(() => {})

  // ── 1. War-room messages in window ─────────────────────────────────────────
  const { data: wrMsgs } = await db
    .from('war_room_messages')
    .select('role, instrument, message, data, created_at')
    .gte('created_at', since)

  const closes = (wrMsgs ?? []).filter(m => m.role === 'close')
  const opens = (wrMsgs ?? []).filter(m => m.role === 'open')
  const decisions = (wrMsgs ?? []).filter(m => m.role === 'decision')
  const alerts = (wrMsgs ?? []).filter(m => m.role === 'alert')

  const closesByReasonMap: Record<string, number> = {}
  for (const m of closes) {
    const reason = (m.data as { reason?: string } | null)?.reason ?? 'unknown'
    closesByReasonMap[reason] = (closesByReasonMap[reason] ?? 0) + 1
  }
  const closesByReason = Object.entries(closesByReasonMap)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)

  // Decisions: count execute vs reject
  let decisionsExecuted = 0
  let decisionsRejected = 0
  for (const m of decisions) {
    const t = String(m.message ?? '').toUpperCase()
    if (t.includes('EXECUTE') || t.includes('APPROVE')) decisionsExecuted++
    else decisionsRejected++
  }

  // ── 2. Health regression counts ────────────────────────────────────────────
  // Data-quality fails: closes citing the validator. Post-2026-05-07 should
  // be near zero across all instruments (was ~42% of closes pre-fix).
  const dataQualityFails = closes.filter(m => {
    const blob = JSON.stringify(m.data ?? {}) + String(m.message ?? '')
    return /data-quality|data_quality|stale data|suspicious volume|missing candles/i.test(blob)
  }).length

  // AI model errors (Anthropic 404s logged as agent alert messages).
  const modelErrors = alerts.filter(m => {
    const txt = String(m.message ?? '') + JSON.stringify(m.data ?? {})
    return /\b404\b|not_found_error|model:\s*c/i.test(txt)
  }).length

  // False loss-streak pauses: any cooldown alert that fired in window.
  // After the 2026-05-07 fix this should only fire on REAL losses; demo
  // SL streaks no longer trigger it.
  const falseLossStreakPauses = alerts.filter(m => {
    const txt = String(m.message ?? '')
    return /loss-streak|consecutive REAL losses|consecutive losses/i.test(txt)
  }).length

  // ── 3. Trades + signals in window ──────────────────────────────────────────
  const { data: signalsRows } = await db
    .from('signals')
    .select('id')
    .gte('created_at', since)
  const signalsGenerated = signalsRows?.length ?? 0

  const { data: realOpened } = await db.from('trades').select('id').eq('is_demo', false).gte('opened_at', since)
  const { data: realClosed } = await db.from('trades').select('pnl').eq('is_demo', false).eq('status', 'closed').gte('closed_at', since)
  const realTradesOpened = realOpened?.length ?? 0
  const realTradesClosed = realClosed?.length ?? 0
  const realPnl = (realClosed ?? []).reduce((s, t) => s + Number(t.pnl ?? 0), 0)

  const { data: demoOpened } = await db.from('demo_trades').select('id').gte('entry_time', since)
  const { data: demoClosed } = await db.from('demo_trades').select('pnl').not('exit_time', 'is', null).gte('exit_time', since)
  const demoTradesOpened = demoOpened?.length ?? 0
  const demoTradesClosed = demoClosed?.length ?? 0
  const demoPnl = (demoClosed ?? []).reduce((s, t) => s + Number(t.pnl ?? 0), 0)

  // ── 3b. External-signals execution lag (added 2026-05-14) ─────────────────
  // After the 2026-05-13 outage where the DB CHECK constraint silently
  // rejected every claim for ~13h (two real XAU/USD signals never reached
  // IG), we permanently watch for rows stuck in 'pending' beyond the
  // freshness window. ANY row >10 min old still 'pending' = something is
  // wrong end-to-end (executor disabled, schema drift, IG outage, etc.).
  const { data: stuckSignals } = await db
    .from('external_signals')
    .select('id, instrument, direction, created_at, raw_text')
    .eq('execution_status', 'pending')
    .lt('created_at', new Date(Date.now() - 10 * 60_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(10)
  const stuckPendingExternal = stuckSignals?.length ?? 0

  // Also surface the most recent telegram-executor error so the operator
  // can see WHY claim is failing without digging through agent_logs.
  const { data: telExecErr } = await db
    .from('agent_logs')
    .select('created_at, message')
    .eq('agent', 'telegram-executor')
    .eq('level', 'error')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
  const telExecLastError = telExecErr?.[0]?.message ?? null

  // ── 4. Coverage: per-instrument latest candle age ──────────────────────────
  const staleInstruments: Array<{ instrument: string; ageMin: number }> = []
  for (const inst of ALL_INSTRUMENTS) {
    const { data: rows } = await db
      .from('price_history')
      .select('timestamp')
      .eq('symbol', inst)
      .order('timestamp', { ascending: false })
      .limit(1)
    const ts = rows?.[0]?.timestamp
    if (!ts) {
      staleInstruments.push({ instrument: inst, ageMin: 99999 })
      continue
    }
    const ageMin = (Date.now() - new Date(ts as string).getTime()) / 60_000
    if (ageMin > STALE_BUDGET_MIN[inst]) {
      staleInstruments.push({ instrument: inst, ageMin })
    }
  }
  staleInstruments.sort((a, b) => b.ageMin - a.ageMin)

  // ── 5. Verdict + notes ─────────────────────────────────────────────────────
  const totalHealthIssues = dataQualityFails + modelErrors + falseLossStreakPauses + stuckPendingExternal
  let verdict: SelfAuditPayload['verdict'] = 'healthy'
  if (totalHealthIssues > 0 || staleInstruments.length > 4) verdict = 'warning'
  if (modelErrors > 5 || dataQualityFails > 50 || staleInstruments.length > 10) verdict = 'critical'
  // Stuck external signals = trading is effectively offline → critical.
  if (stuckPendingExternal > 0) verdict = 'critical'

  const notes: string[] = []
  if (totalHealthIssues === 0 && opens.length === 0 && signalsGenerated === 0) {
    notes.push(`No triggers fired — market quiet. Rotation healthy, just waiting for setups.`)
  }
  if (closesByReasonMap['atr-extreme'] > 10) {
    notes.push(`Many ATR-extreme bounces — likely overnight compression on US equities (will normalise at NY open).`)
  }
  if (closesByReasonMap['mtf-veto'] > 10) {
    notes.push(`Many MTF vetoes — 4H/1D against single 1H trigger. Trend-aligned setups needed.`)
  }
  if (closesByReasonMap['long-only-mode'] > 5) {
    notes.push(`Several short triggers blocked by LONG-ONLY mode (shorts have 0% historical win rate).`)
  }
  if (realTradesOpened > 0) {
    notes.push(`Live execution active — ${realTradesOpened} live trade(s) opened in window.`)
  }
  if (stuckPendingExternal > 0) {
    const tail = telExecLastError ? ` Last executor error: ${telExecLastError.slice(0, 140)}.` : ''
    notes.push(
      `CRITICAL: ${stuckPendingExternal} external signal(s) stuck pending >10min — IG execution path is broken. Check vercel logs + DB CHECK constraints on external_signals.execution_status.${tail}`,
    )
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  const payload: SelfAuditPayload = {
    windowHours: WINDOW_H,
    health: { dataQualityFails, modelErrors, falseLossStreakPauses, stuckPendingExternal },
    activity: {
      closes: closes.length,
      meetingsOpened: opens.length,
      decisionsExecuted,
      decisionsRejected,
      signalsGenerated,
      realTradesOpened,
      realTradesClosed,
      demoTradesOpened,
      demoTradesClosed,
      realPnl,
      demoPnl,
    },
    closesByReason,
    staleInstruments: staleInstruments.slice(0, 6),
    verdict,
    notes,
  }

  const sent = await notifySelfAudit(payload).catch(err => {
    console.error('[self-audit] notifySelfAudit error:', err)
    return false
  })

  await db.from('agent_logs').insert({
    agent: 'self-audit-cron',
    level: sent ? 'ok' : 'warn',
    message: `audit ${sent ? 'sent' : 'NOT sent'} · verdict=${verdict} · closes=${closes.length} opens=${opens.length} health-issues=${totalHealthIssues}`,
    metadata: { durationMs: Date.now() - t0, payload },
  }).then(() => {})

  return NextResponse.json({
    success: true,
    sent,
    verdict,
    health: payload.health,
    activity: payload.activity,
    duration_ms: Date.now() - t0,
  })
}
