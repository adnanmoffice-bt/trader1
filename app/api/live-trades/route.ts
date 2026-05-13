/**
 * /api/live-trades
 *
 * Aggregated read endpoint for the operator's live-trades dashboard.
 * Returns three slices in one call so the page polls only one URL:
 *
 *   - open_positions    : trades.is_demo=false AND status='open'
 *                         (sorted by opened_at DESC)
 *   - recent_signals    : last 30 rows from external_signals
 *   - webhook_activity  : last 30 rows from agent_logs where
 *                         agent IN ('telegram-webhook','telegram-executor-cron')
 *   - state             : live env state snapshot (executor_enabled, dry_run,
 *                         require_forward, instruments) — same shape as the
 *                         GET /api/telegram/webhook endpoint
 *
 * Auth: any authenticated dashboard user (RLS on the underlying tables
 * already restricts; we read via the service role for simplicity since
 * agent_logs and external_signals are service-role-only anyway).
 */
import { NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase-server'

export const runtime = 'nodejs'

export async function GET() {
  // Require an authenticated user (dashboard route).
  const userSupa = await createServerSupabase()
  const { data: { user } } = await userSupa.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const db = createServiceSupabase()

  const [openRes, signalsRes, logsRes] = await Promise.all([
    db.from('trades')
      .select('id, instrument, direction, quantity, entry_price, stop_loss, take_profit, opened_at, status, notes')
      .eq('is_demo', false)
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .limit(20),
    db.from('external_signals')
      .select('id, created_at, message_date, source, instrument, direction, entry_price, stop_loss, take_profit, execution_status, skip_reason, exec_error, executed_trade_id, parse_status, parser_version, metadata')
      .order('created_at', { ascending: false })
      .limit(30),
    db.from('agent_logs')
      .select('id, created_at, agent, level, message, metadata')
      .in('agent', ['telegram-webhook', 'telegram-executor-cron'])
      .order('created_at', { ascending: false })
      .limit(30),
  ])

  return NextResponse.json({
    ok: true,
    server_time: new Date().toISOString(),
    open_positions: openRes.data ?? [],
    recent_signals: signalsRes.data ?? [],
    webhook_activity: logsRes.data ?? [],
    state: {
      executor_enabled: (process.env.TELEGRAM_SIGNALS_EXECUTOR_ENABLED ?? '').toLowerCase() === 'true',
      dry_run: (process.env.TELEGRAM_SIGNALS_EXECUTOR_DRY_RUN ?? '').toLowerCase() === 'true',
      require_forward: (process.env.TELEGRAM_SIGNALS_REQUIRE_FORWARD ?? '').toLowerCase() === 'true',
      instruments: (process.env.TELEGRAM_SIGNALS_ALLOWED_INSTRUMENTS ?? 'XAU/USD').split(',').map(s => s.trim()).filter(Boolean),
      forward_from: (process.env.TELEGRAM_SIGNALS_FORWARD_FROM ?? '').split(',').map(s => s.trim()).filter(Boolean),
      max_age_min: Number(process.env.TELEGRAM_SIGNALS_MAX_AGE_MIN ?? '5'),
    },
    errors: {
      open: openRes.error?.message ?? null,
      signals: signalsRes.error?.message ?? null,
      logs: logsRes.error?.message ?? null,
    },
  })
}
