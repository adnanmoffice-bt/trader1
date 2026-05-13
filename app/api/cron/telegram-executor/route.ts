/**
 * /api/cron/telegram-executor
 *
 * Phase 3 of the external-signal pipeline. Drains
 * `external_signals WHERE execution_status='pending'` into REAL IG orders.
 *
 * Wiring vs Phase 1:
 *   - Ingestor sets execution_status='pending' when
 *     TELEGRAM_SIGNALS_EXECUTOR_ENABLED=true (otherwise 'disabled').
 *   - Executor reads only 'pending' rows AND requires the same env flag
 *     to be true at exec time (belt-and-suspenders: a row that became
 *     pending earlier won't fire if the operator subsequently turns the
 *     executor off).
 *
 * Safety floors (operator chose to relax kill switch + blacklist for this
 * path, but these are physical / operational floors that cannot be
 * relaxed without risking obvious bad fills):
 *
 *   1. FRESHNESS — signals older than TELEGRAM_SIGNALS_MAX_AGE_MIN (default 5)
 *      are skipped with reason='stale'. A 30-minute-old SELL XAU @ 4700
 *      against a market now at 4730 would fire a backward order.
 *
 *   2. INSTRUMENT MAP — only IG_INSTRUMENTS (XAU/XAG/WTI/BRENT/EUR/USD/
 *      GBP/USD/USD/JPY/SPY/QQQ) are routable. Anything else gets
 *      reason='unknown-instrument' and stays parked.
 *
 *   3. PARSED FIELDS — entry, SL, and TP1 must all be present and
 *      direction-consistent (parser already enforces SL on the protective
 *      side of entry; executor re-checks defensively).
 *
 *   4. SIZE FLOOR — IG enforces a min position size per epic. We send
 *      max(parsed_lots_based_size, 0.5) for gold/oil/indices (per IG's
 *      0.5 contract min on most CFDs).
 *
 *   5. ATOMIC SL/TP — orders go through IGExchange.openMarketPosition
 *      which attaches stopLevel + limitLevel in the same POST. No naked
 *      position window.
 *
 *   6. ONE-SHOT — each external_signal row is locked to execution_status
 *      'executed' / 'failed' / 'skipped' before the loop moves on. Re-runs
 *      of the cron after a failure don't re-fire.
 *
 *   7. DRY_RUN — if TELEGRAM_SIGNALS_EXECUTOR_DRY_RUN=true, the executor
 *      logs what it WOULD do but does not POST to IG. Recommended for
 *      first 24h of operation.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { IG_INSTRUMENTS, getExchangeForInstrument } from '@/lib/exchanges'
import { IGExchange } from '@/lib/exchanges/ig'

export const runtime = 'nodejs'
export const maxDuration = 30

const EXECUTOR_ENABLED =
  (process.env.TELEGRAM_SIGNALS_EXECUTOR_ENABLED ?? '').toLowerCase() === 'true'
const DRY_RUN =
  (process.env.TELEGRAM_SIGNALS_EXECUTOR_DRY_RUN ?? '').toLowerCase() === 'true'
const MAX_AGE_MIN = Number(process.env.TELEGRAM_SIGNALS_MAX_AGE_MIN ?? '5')
const DEFAULT_LOTS_PER_1000 = Number(process.env.TELEGRAM_SIGNALS_DEFAULT_LOTS_PER_1000 ?? '0.1')
const MIN_IG_SIZE = 0.5 // IG min CFD size on most majors / gold

interface ExternalSignalRow {
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

interface ExecutorOutcome {
  signal_id: string
  status: 'executed' | 'skipped' | 'failed' | 'dry-run'
  reason?: string
  trade_id?: string
  ig_deal_id?: string
  error?: string
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceSupabase()
  const t0 = Date.now()

  if (!EXECUTOR_ENABLED) {
    await db.from('agent_logs').insert({
      agent: 'telegram-executor-cron',
      level: 'info',
      message: 'executor disabled (TELEGRAM_SIGNALS_EXECUTOR_ENABLED!=true), no-op',
      metadata: { duration_ms: Date.now() - t0 },
    }).then(() => {})
    return NextResponse.json({ ok: true, disabled: true, fetched: 0 })
  }

  // Pull pending signals — recent first so a backlog doesn't fire stale
  // orders before fresh ones.
  const { data: rows, error: fetchErr } = await db
    .from('external_signals')
    .select('id, source, external_message_id, message_date, raw_text, parsed, instrument, direction, entry_price, stop_loss, take_profit')
    .eq('execution_status', 'pending')
    .order('message_date', { ascending: false })
    .limit(25)
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }

  const pending = (rows ?? []) as ExternalSignalRow[]
  const outcomes: ExecutorOutcome[] = []
  const userId = process.env.APEX_USER_ID || '3f8f9deb-c490-4ed0-b205-1cba0d3b81d1'

  for (const row of pending) {
    const oc = await executeRow(db, row, userId, t0)
    outcomes.push(oc)
  }

  await db.from('agent_logs').insert({
    agent: 'telegram-executor-cron',
    level: outcomes.some(o => o.status === 'failed') ? 'warn' : 'ok',
    message: `executor ran on ${pending.length} pending (executed=${outcomes.filter(o => o.status === 'executed').length}, dry=${outcomes.filter(o => o.status === 'dry-run').length}, skipped=${outcomes.filter(o => o.status === 'skipped').length}, failed=${outcomes.filter(o => o.status === 'failed').length})`,
    metadata: { outcomes, dry_run: DRY_RUN, max_age_min: MAX_AGE_MIN, duration_ms: Date.now() - t0 },
  }).then(() => {})

  return NextResponse.json({
    fetched: pending.length,
    outcomes,
    dry_run: DRY_RUN,
    duration_ms: Date.now() - t0,
  })
}

async function executeRow(
  db: ReturnType<typeof createServiceSupabase>,
  row: ExternalSignalRow,
  userId: string,
  cronT0: number,
): Promise<ExecutorOutcome> {
  const inst = row.parsed?.instrument ?? row.instrument
  const direction = row.parsed?.direction ?? row.direction
  const entry = row.parsed?.entry ?? row.entry_price
  const sl = row.parsed?.stop_loss ?? row.stop_loss
  const tp = row.parsed?.take_profit ?? row.take_profit
  const lotsPer1000 = row.parsed?.lots_per_1000 ?? DEFAULT_LOTS_PER_1000

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
  if (!IG_INSTRUMENTS.has(inst)) {
    return skip('unknown-instrument')
  }

  // Freshness check.
  const msgDate = row.message_date ? new Date(row.message_date).getTime() : 0
  if (msgDate > 0) {
    const ageMin = (cronT0 - msgDate) / 60_000
    if (ageMin > MAX_AGE_MIN) return skip(`stale (${ageMin.toFixed(1)}min > ${MAX_AGE_MIN})`)
  }

  // Direction consistency (defence in depth — parser already checks this).
  if (direction === 'long' && (sl >= entry || tp <= entry)) return skip('inverted-long')
  if (direction === 'short' && (sl <= entry || tp >= entry)) return skip('inverted-short')

  // Route via IG.
  const ex = getExchangeForInstrument(inst)
  if (!(ex instanceof IGExchange)) return skip('no-ig-route')
  if (!ex.isConfigured()) return fail('IG not configured (missing IG_* env)')

  // Sizing: convert lots-per-$1000 hint × account balance → IG contract size.
  // For Spot Gold ($1/contract = 1 oz exposure per "size" unit), 0.10 lots
  // per $1000 on a $500 account = 0.05 lots. IG's min size on most CFDs is
  // 0.5 contracts, so we floor there. This is intentionally conservative —
  // a precise mapping per epic lands when we see the first real fill.
  let balance = 0
  try {
    balance = await ex.getQuoteBalance()
  } catch (e) {
    return fail(`IG getQuoteBalance failed: ${String(e).slice(0, 200)}`)
  }
  const targetLots = (lotsPer1000 / 1000) * balance
  const sizeContracts = Math.max(MIN_IG_SIZE, Number(targetLots.toFixed(2)))

  if (DRY_RUN) {
    await db.from('external_signals').update({
      execution_status: 'skipped',
      skip_reason: 'dry-run',
      executed_at: new Date().toISOString(),
      exec_error: `DRY_RUN would open ${direction} ${sizeContracts} @ ~${entry} SL ${sl} TP ${tp}`,
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

  // Persist as a trade row. notes carries the external-signal link both ways
  // (external_signals.executed_trade_id is set immediately after via the
  // returned trade.id).
  const { data: trade, error: tradeErr } = await db.from('trades').insert({
    user_id: userId,
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
    // Order DID fill but DB write failed — keep the cell as failed but
    // include the deal id so operator can reconcile manually.
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
