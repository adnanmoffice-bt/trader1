/**
 * lib/telegram-executor.ts
 *
 * Shared execution core for the external-signal pipeline. Called from BOTH:
 *   - /api/telegram/webhook (instant on inbound forward, ~1s latency)
 *   - /api/cron/telegram-executor (every minute, picks up anything the
 *     webhook missed — outage, parser failure, IG transient)
 *
 * The two callers race for each row. Idempotency is guaranteed by an atomic
 * "claim" UPDATE that flips execution_status from 'pending' → 'executing'
 * and returns the row only to the caller that actually changed it. Whoever
 * loses the race gets no row back and moves on.
 *
 * Safety floors enforced here (these are physical/operational — NOT
 * relaxable by operator preference):
 *   1. Allowlist (XAU/USD only by default, via env)
 *   2. Freshness ≤ TELEGRAM_SIGNALS_MAX_AGE_MIN
 *   3. Direction-consistency on SL and TP1
 *   4. Atomic SL+TP via IGExchange.openMarketPosition()
 *   5. One-shot via atomic row claim — webhook + cron CANNOT double-fire
 *   6. DRY_RUN bypass (logs only, no IG POST)
 */
import type { createServiceSupabase } from './supabase'
import { getExchangeForInstrument } from './exchanges'
import { IGExchange } from './exchanges/ig'

type Supa = ReturnType<typeof createServiceSupabase>

export const TELEGRAM_EXECUTOR_DEFAULTS = {
  MAX_AGE_MIN: Number(process.env.TELEGRAM_SIGNALS_MAX_AGE_MIN ?? '5'),
  DEFAULT_LOTS_PER_1000: Number(process.env.TELEGRAM_SIGNALS_DEFAULT_LOTS_PER_1000 ?? '0.1'),
  MIN_IG_SIZE: 0.5,                  // IG min CFD size on majors / gold
  ALLOWLIST: (process.env.TELEGRAM_SIGNALS_ALLOWED_INSTRUMENTS ?? 'XAU/USD')
                .split(',').map(s => s.trim()).filter(Boolean),
  USER_ID: process.env.APEX_USER_ID || '3f8f9deb-c490-4ed0-b205-1cba0d3b81d1',
}

export interface ExternalSignalRow {
  id: string
  source: string
  external_message_id: number
  message_date: string | null
  raw_text: string
  parsed: {
    instrument: string
    direction: 'long' | 'short'
    entry: number | null
    entry_low?: number | null
    entry_high?: number | null
    stop_loss: number | null
    take_profit: number | null
    tp2?: number | null
    tp3?: number | null
    tp4?: number | null
    lots_per_1000?: number | null
  } | null
  instrument: string | null
  direction: 'long' | 'short' | null
  entry_price: number | null
  stop_loss: number | null
  take_profit: number | null
}

export interface ExecutorOutcome {
  signal_id: string
  status: 'executed' | 'skipped' | 'failed' | 'dry-run' | 'race-lost'
  reason?: string
  trade_id?: string
  ig_deal_id?: string
  error?: string
}

export function isExecutorEnabled(): boolean {
  return (process.env.TELEGRAM_SIGNALS_EXECUTOR_ENABLED ?? '').toLowerCase() === 'true'
}

export function isDryRun(): boolean {
  return (process.env.TELEGRAM_SIGNALS_EXECUTOR_DRY_RUN ?? '').toLowerCase() === 'true'
}

/**
 * Atomically claim a 'pending' row by flipping it to 'executing'. Only the
 * caller that actually changed the row gets it back. This is the race
 * primitive that makes webhook + cron co-existence safe.
 *
 * Note: Supabase update().eq().select() applies the .eq filter to the
 * UPDATE itself, so two concurrent calls with the same WHERE result in
 * exactly one row updated (the other returns 0 rows). We rely on this
 * Postgres behaviour.
 *
 * 2026-05-14 hardening: any UPDATE error (e.g. CHECK constraint violation
 * on `execution_status`, RLS rejection, network drop) is now written to
 * `agent_logs` BEFORE returning null. Without this, the 2026-05-13 outage
 * was completely invisible — the DB rejected every claim with code 23514,
 * the supabase-js client returned `{ data: null, error: {...} }`, the old
 * code only destructured `data` and reported every signal as "race-lost".
 * Two real Signal Feed XAU/USD signals never made it to IG. NEVER AGAIN.
 */
export async function claimSignalRow(db: Supa, id: string): Promise<ExternalSignalRow | null> {
  const { data, error } = await db.from('external_signals')
    .update({ execution_status: 'executing' })
    .eq('id', id)
    .eq('execution_status', 'pending')
    .select('id, source, external_message_id, message_date, raw_text, parsed, instrument, direction, entry_price, stop_loss, take_profit')
    .maybeSingle()
  if (error) {
    // Surface DB-level rejections (CHECK violations, RLS, etc.) — these are
    // schema/config bugs that MUST stop trading, not be papered over as
    // "race-lost". Returning null here keeps the contract (no execution),
    // but the operator will see this within 6h via self-audit and (at the
    // latest) on the next webhook hit since we log every attempt.
    await db.from('agent_logs').insert({
      agent: 'telegram-executor',
      level: 'error',
      message: `claimSignalRow DB error on ${id}: ${error.message}`,
      metadata: {
        signal_id: id,
        code: (error as { code?: string }).code ?? null,
        details: (error as { details?: string }).details ?? null,
        hint: (error as { hint?: string }).hint ?? null,
      },
    }).then(() => {})
    return null
  }
  return (data as ExternalSignalRow | null) ?? null
}

/**
 * Execute one external-signal row. Caller must have already claimed it via
 * claimSignalRow() (which flipped status to 'executing'). On return, status
 * will be one of: 'executed' | 'skipped' | 'failed'.
 */
export async function executeClaimedRow(
  db: Supa,
  row: ExternalSignalRow,
  cronT0: number = Date.now(),
): Promise<ExecutorOutcome> {
  const inst = row.parsed?.instrument ?? row.instrument
  const direction = row.parsed?.direction ?? row.direction
  const entry = row.parsed?.entry ?? row.entry_price
  const sl = row.parsed?.stop_loss ?? row.stop_loss
  const tp = row.parsed?.take_profit ?? row.take_profit
  const lotsPer1000 = row.parsed?.lots_per_1000 ?? TELEGRAM_EXECUTOR_DEFAULTS.DEFAULT_LOTS_PER_1000

  const skip = async (reason: string) => {
    await db.from('external_signals').update({
      execution_status: 'skipped', skip_reason: reason, executed_at: new Date().toISOString(),
    }).eq('id', row.id)
    return { signal_id: row.id, status: 'skipped' as const, reason }
  }

  const fail = async (err: string) => {
    await db.from('external_signals').update({
      execution_status: 'failed', exec_error: err.slice(0, 500), executed_at: new Date().toISOString(),
    }).eq('id', row.id)
    return { signal_id: row.id, status: 'failed' as const, error: err }
  }

  if (!inst || !direction || entry == null || sl == null || tp == null) {
    return skip('missing-fields')
  }

  // Instrument allowlist — defaults to XAU/USD only.
  const allow = TELEGRAM_EXECUTOR_DEFAULTS.ALLOWLIST
  if (allow.length && !allow.includes(inst)) {
    return skip(`not-in-allowlist (${inst})`)
  }

  // Freshness check.
  const msgDate = row.message_date ? new Date(row.message_date).getTime() : 0
  if (msgDate > 0) {
    const ageMin = (cronT0 - msgDate) / 60_000
    if (ageMin > TELEGRAM_EXECUTOR_DEFAULTS.MAX_AGE_MIN) {
      return skip(`stale (${ageMin.toFixed(1)}min > ${TELEGRAM_EXECUTOR_DEFAULTS.MAX_AGE_MIN})`)
    }
  }

  // Direction consistency (defence in depth — parser already checks this).
  if (direction === 'long' && (sl >= entry || tp <= entry)) return skip('inverted-long')
  if (direction === 'short' && (sl <= entry || tp >= entry)) return skip('inverted-short')

  // Route via IG.
  const ex = getExchangeForInstrument(inst)
  if (!(ex instanceof IGExchange)) return skip('no-ig-route')
  if (!ex.isConfigured()) return fail('IG not configured (missing IG_* env)')

  // Sizing: lots-per-$1000 × balance, floored at IG min size.
  let balance = 0
  try {
    balance = await ex.getQuoteBalance()
  } catch (e) {
    return fail(`IG getQuoteBalance failed: ${String(e).slice(0, 200)}`)
  }
  const targetLots = (lotsPer1000 / 1000) * balance
  const sizeContracts = Math.max(TELEGRAM_EXECUTOR_DEFAULTS.MIN_IG_SIZE, Number(targetLots.toFixed(2)))

  if (isDryRun()) {
    await db.from('external_signals').update({
      execution_status: 'skipped',
      skip_reason: 'dry-run',
      executed_at: new Date().toISOString(),
      exec_error: `DRY_RUN would open ${direction} ${sizeContracts} @ ~${entry} SL ${sl} TP ${tp} balance=${balance}`,
    }).eq('id', row.id)
    return { signal_id: row.id, status: 'dry-run', reason: `${direction} size=${sizeContracts} entry=${entry} sl=${sl} tp=${tp} balance=${balance}` }
  }

  // FIRE.
  let order
  try {
    order = await ex.openMarketPosition({
      symbol: inst,
      side: direction === 'long' ? 'BUY' : 'SELL',
      sizeContracts,
      stopLevel: sl,
      limitLevel: tp,
    })
  } catch (e) {
    return fail(`IG order failed: ${String(e).slice(0, 300)}`)
  }
  if (!order) return fail('IG order returned null')

  // Persist as a trade row.
  const { data: trade, error: tradeErr } = await db.from('trades').insert({
    user_id: TELEGRAM_EXECUTOR_DEFAULTS.USER_ID,
    instrument: inst,
    direction,
    quantity: order.executedQty,
    entry_price: order.avgPrice,
    stop_loss: sl,
    take_profit: tp,
    status: 'open',
    is_demo: false,
    opened_at: new Date().toISOString(),
    notes: JSON.stringify({
      external_signal_id: row.id,
      ig_deal_id: order.orderId,
      ig_side: order.side,
      source: row.source,
      external_message_id: row.external_message_id,
    }),
  }).select().single()

  if (tradeErr) {
    return fail(`order filled (deal ${order.orderId}) but trades insert failed: ${tradeErr.message}`)
  }

  await db.from('external_signals').update({
    execution_status: 'executed',
    executed_trade_id: trade?.id ?? null,
    executed_at: new Date().toISOString(),
  }).eq('id', row.id)

  return {
    signal_id: row.id,
    status: 'executed',
    trade_id: trade?.id,
    ig_deal_id: order.orderId,
  }
}

/**
 * Convenience: claim + execute in one call. Returns 'race-lost' if another
 * caller already claimed the row. Used by both the cron and the webhook.
 */
export async function tryExecuteSignalById(db: Supa, signalId: string): Promise<ExecutorOutcome> {
  const claimed = await claimSignalRow(db, signalId)
  if (!claimed) {
    return { signal_id: signalId, status: 'race-lost', reason: 'already-claimed' }
  }
  return executeClaimedRow(db, claimed)
}
