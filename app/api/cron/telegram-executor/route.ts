/**
 * /api/cron/telegram-executor
 *
 * Phase 3 cron — drains `external_signals WHERE execution_status='pending'`
 * into REAL IG orders. Safety net for the inbound webhook
 * (`/api/telegram/webhook`) which is the primary low-latency path.
 *
 * Webhook + cron are race-safe: each row is atomically claimed via
 * `claimSignalRow()` before execution. Whoever claims first runs.
 *
 * See lib/telegram-executor.ts for the actual execution logic and the
 * full safety-floor list (allowlist, freshness, direction consistency,
 * atomic SL+TP, dry-run gate).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import {
  isExecutorEnabled,
  isDryRun,
  TELEGRAM_EXECUTOR_DEFAULTS,
  claimSignalRow,
  executeClaimedRow,
  type ExecutorOutcome,
} from '@/lib/telegram-executor'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceSupabase()
  const t0 = Date.now()

  if (!isExecutorEnabled()) {
    await db.from('agent_logs').insert({
      agent: 'telegram-executor-cron',
      level: 'info',
      message: 'executor disabled (TELEGRAM_SIGNALS_EXECUTOR_ENABLED!=true), no-op',
      metadata: { duration_ms: Date.now() - t0 },
    }).then(() => {})
    return NextResponse.json({ ok: true, disabled: true, fetched: 0 })
  }

  // Pull pending signals — newest first.
  const { data: rows, error: fetchErr } = await db
    .from('external_signals')
    .select('id, message_date')
    .eq('execution_status', 'pending')
    .order('message_date', { ascending: false })
    .limit(25)
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }

  const pending = rows ?? []
  const outcomes: ExecutorOutcome[] = []

  for (const r of pending) {
    const claimed = await claimSignalRow(db, r.id as string)
    if (!claimed) {
      // Webhook beat us to it.
      outcomes.push({ signal_id: r.id as string, status: 'race-lost', reason: 'webhook-faster' })
      continue
    }
    outcomes.push(await executeClaimedRow(db, claimed, t0))
  }

  const exec = outcomes.filter(o => o.status === 'executed').length
  const dry = outcomes.filter(o => o.status === 'dry-run').length
  const skipped = outcomes.filter(o => o.status === 'skipped').length
  const failed = outcomes.filter(o => o.status === 'failed').length
  const raceLost = outcomes.filter(o => o.status === 'race-lost').length

  await db.from('agent_logs').insert({
    agent: 'telegram-executor-cron',
    level: failed > 0 ? 'warn' : 'ok',
    message: `executor ran on ${pending.length} pending (executed=${exec}, dry=${dry}, skipped=${skipped}, failed=${failed}, race-lost=${raceLost})`,
    metadata: {
      outcomes,
      dry_run: isDryRun(),
      max_age_min: TELEGRAM_EXECUTOR_DEFAULTS.MAX_AGE_MIN,
      allowlist: TELEGRAM_EXECUTOR_DEFAULTS.ALLOWLIST,
      duration_ms: Date.now() - t0,
    },
  }).then(() => {})

  return NextResponse.json({
    fetched: pending.length,
    outcomes,
    dry_run: isDryRun(),
    duration_ms: Date.now() - t0,
  })
}
