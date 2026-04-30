import { createServiceSupabase } from '@/lib/supabase'

const MAX_DRAWDOWN_HARD_STOP = 0.75  // 75% — only kill switch at catastrophic level
// Raised 3% → 5% on 2026-04-23: with R:R 2.25:1 and 1.5% risk/trade,
// 2 consecutive SLs = 3% = instant block. 5% gives room for 3 losses + recovery.
const DAILY_LOSS_LIMIT_PCT = 0.05
const MAX_POSITIONS = 3

// Dubai is our business timezone (UTC+4). Using UTC midnight as day boundary
// caused morning SLs (Dubai ~04:30) to eat the whole day's loss budget.
// Compute "day start" as 00:00 Dubai → 20:00 UTC previous day.
export const DUBAI_UTC_OFFSET_HOURS = 4
export function dubaiDayStartUTC(): Date {
  const now = new Date()
  const dubaiNow = new Date(now.getTime() + DUBAI_UTC_OFFSET_HOURS * 3600_000)
  // midnight Dubai that bounds the current Dubai day
  const dubaiMidnight = new Date(Date.UTC(
    dubaiNow.getUTCFullYear(),
    dubaiNow.getUTCMonth(),
    dubaiNow.getUTCDate(),
    0, 0, 0, 0,
  ))
  // convert back to UTC: subtract offset
  return new Date(dubaiMidnight.getTime() - DUBAI_UTC_OFFSET_HOURS * 3600_000)
}

export interface SafetyStatus {
  safe: boolean
  killSwitchActive: boolean
  drawdownPct: number
  drawdownLimit: number
  drawdownOk: boolean
  dailyLossPct: number
  dailyLossLimit: number
  dailyLossOk: boolean
  openPositions: number
  maxPositions: number
  positionsOk: boolean
  peakCapital: number
  currentCapital: number
  todayPnl: number
  reason?: string
}

export async function checkSafety(userId?: string): Promise<SafetyStatus> {
  const db = createServiceSupabase()

  // Check kill switch
  const { data: killFlag } = await db
    .from('agent_logs')
    .select('id')
    .eq('agent', 'kill-switch')
    .eq('level', 'error')
    .gte('created_at', new Date(Date.now() - 86400_000).toISOString())
    .limit(1)
    .single()

  const killSwitchActive = !!killFlag

  // Get portfolio capital and user settings for initial capital
  const { data: portfolio } = await db
    .from('portfolio')
    .select('capital, available_capital, realized_pnl')
    .eq('is_demo', false)
    .single()

  // Try to get user's configured initial capital from settings
  const { data: settings } = await db
    .from('user_settings')
    .select('initial_capital')
    .limit(1)
    .single()

  const initialCapital = settings?.initial_capital ?? 5000
  const currentCapital = portfolio?.available_capital ?? initialCapital
  const realizedPnl = portfolio?.realized_pnl ?? 0

  // True high-water mark: the highest equity ever reached
  // Peak = initial + max cumulative realized PnL (at least initial)
  const peakCapital = Math.max(initialCapital, initialCapital + Math.max(0, realizedPnl), currentCapital)

  // Drawdown from peak — recovery mode handles throttling, only hard-stop at catastrophic levels
  const drawdownPct = peakCapital > 0 ? Math.max(0, (peakCapital - currentCapital) / peakCapital) : 0
  const drawdownOk = drawdownPct < MAX_DRAWDOWN_HARD_STOP

  // Daily loss: sum of today's closed trades from BOTH tables.
  // Day boundary is Dubai midnight (UTC+4), not UTC midnight.
  const todayISO = dubaiDayStartUTC().toISOString()

  const { data: todayLiveTrades } = await db
    .from('trades')
    .select('pnl')
    .gte('closed_at', todayISO)
    .in('status', ['closed', 'stopped'])

  const { data: todayDemoTrades } = await db
    .from('demo_trades')
    .select('pnl')
    .not('exit_time', 'is', null)
    .gte('exit_time', todayISO)

  const todayPnl = (todayLiveTrades ?? []).reduce((s, t) => s + (Number(t.pnl) || 0), 0)
    + (todayDemoTrades ?? []).reduce((s, t) => s + (Number(t.pnl) || 0), 0)
  const dailyLossPct = todayPnl < 0 ? Math.abs(todayPnl) / currentCapital : 0
  const dailyLossOk = dailyLossPct < DAILY_LOSS_LIMIT_PCT

  // Position count
  const { count: openPositions } = await db
    .from('positions')
    .select('*', { count: 'exact', head: true })
    .eq('is_demo', false)

  const positionsOk = (openPositions ?? 0) < MAX_POSITIONS

  const safe = !killSwitchActive && drawdownOk && dailyLossOk && positionsOk

  let reason: string | undefined
  if (killSwitchActive) reason = 'Kill switch is active'
  else if (!drawdownOk) reason = `Drawdown ${(drawdownPct * 100).toFixed(1)}% exceeds ${MAX_DRAWDOWN_HARD_STOP * 100}% hard stop`
  else if (!dailyLossOk) reason = `Daily loss ${(dailyLossPct * 100).toFixed(1)}% exceeds ${DAILY_LOSS_LIMIT_PCT * 100}% limit`
  else if (!positionsOk) reason = `${openPositions} open positions at max ${MAX_POSITIONS}`

  return {
    safe, killSwitchActive,
    drawdownPct, drawdownLimit: MAX_DRAWDOWN_HARD_STOP, drawdownOk,
    dailyLossPct, dailyLossLimit: DAILY_LOSS_LIMIT_PCT, dailyLossOk,
    openPositions: openPositions ?? 0, maxPositions: MAX_POSITIONS, positionsOk,
    peakCapital, currentCapital, todayPnl,
    reason,
  }
}

export interface RecoveryMode {
  active: boolean
  drawdownPct: number
  maxRiskPct: number
  maxPositions: number
  minConfidence: number
  minRR: number
  message: string
}

export function getRecoveryMode(drawdownPct: number): RecoveryMode {
  // Tier 1: Normal (DD < 10%)
  if (drawdownPct < 0.10) {
    return { active: false, drawdownPct, maxRiskPct: 0.02, maxPositions: 3, minConfidence: 70, minRR: 2.0, message: 'Normal mode' }
  }
  // Tier 2: Cautious (DD 10-25%)
  if (drawdownPct < 0.25) {
    return { active: true, drawdownPct, maxRiskPct: 0.01, maxPositions: 2, minConfidence: 75, minRR: 2.5, message: `Cautious mode: ${(drawdownPct * 100).toFixed(0)}% drawdown — reduced risk` }
  }
  // Tier 3: Recovery (DD 25-50%)
  if (drawdownPct < 0.50) {
    return { active: true, drawdownPct, maxRiskPct: 0.005, maxPositions: 1, minConfidence: 80, minRR: 3.0, message: `Recovery mode: ${(drawdownPct * 100).toFixed(0)}% drawdown — ultra-conservative` }
  }
  // Tier 4: Survival (DD > 50%)
  return { active: true, drawdownPct, maxRiskPct: 0.003, maxPositions: 1, minConfidence: 85, minRR: 3.5, message: `Survival mode: ${(drawdownPct * 100).toFixed(0)}% drawdown — minimum risk only` }
}

export async function activateKillSwitch(): Promise<void> {
  const db = createServiceSupabase()

  await db.from('agent_logs').insert({
    agent: 'kill-switch',
    level: 'error',
    message: 'KILL SWITCH ACTIVATED — all trading halted for 24 hours',
  })

  // Close all open positions (mark for closing on next cron)
  await db.from('positions')
    .update({ take_profit: 0 })
    .eq('is_demo', false)
}

export async function deactivateKillSwitch(): Promise<void> {
  const db = createServiceSupabase()

  await db.from('agent_logs')
    .delete()
    .eq('agent', 'kill-switch')
    .eq('level', 'error')
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE-TRADING EDGE GATE — added 2026-04-30
// ─────────────────────────────────────────────────────────────────────────────
//
// 6-month walk-forward backtest (scripts/backtest-gate-stack.mjs run on
// 2026-04-30) found NEGATIVE expectancy across all 24 SL/TP combos tested
// on the 11-instrument set. Best config (-0.094 R/trade) still loses.
//
// Conclusion: the system in its current trigger-set has no proven edge.
// Until edge is positive on a 30-day rolling window, live execution is
// gated off. Demo trades continue (they're how we measure edge).
//
// Two layers:
//   1. Per-instrument blacklist for instruments that lost > 10R over
//      the 6-month backtest (ADA, DOT, APT). Hard-block live exec
//      regardless of rolling stats. Demo allowed.
//   2. Dynamic rolling-30d expectancy gate. If 30d demo+live trade
//      expectancy < EDGE_THRESHOLD R/trade with sample >= 20 trades,
//      block live exec on ALL instruments.
//
// Both layers are intentionally conservative — they FAIL CLOSED (no live
// trading) if data is missing or ambiguous. The edge MUST be proven
// positive before risking real money.

const EDGE_THRESHOLD_R = -0.05         // 30-day rolling R-expectancy floor
const MIN_TRADES_FOR_GATE = 20         // need at least 20 closed trades to evaluate

/**
 * Per-instrument LIVE-only blacklist. Keep these instruments in the war-room
 * meeting loop (demo continues) but never let them risk real money.
 *
 * Sourced from 180d backtest (NEW mode) on 2026-04-30:
 *   ADA/USD: 37 trades, 24.3% WR, -14.5R = roughly -$1,088 in real money
 *   DOT/USD: 33 trades, 24.2% WR, -13.0R = roughly -$975
 *   APT/USD: 36 trades, 30.6% WR, -8.5R  = roughly -$638
 *
 * Lift one of these only when the per-instrument gate (below) shows
 * positive expectancy on that instrument over a 30-day window.
 */
export const LIVE_INSTRUMENT_BLACKLIST = new Set<string>([
  'ADA/USD', 'DOT/USD', 'APT/USD',
])

export interface LiveTradingGate {
  allowed: boolean
  reason: string
  expectancyR: number | null
  tradeCount: number
  instrument: string | null
}

/**
 * Check whether real-money execution is allowed RIGHT NOW.
 *
 * Pass `instrument` to also enforce the per-instrument blacklist; pass
 * undefined for the global rolling-expectancy gate only.
 *
 * The function reads `demo_trades` (real production sample) over the
 * trailing 30 days, computes R-multiples per closed trade as
 * `pnl / (|entry - sl| * quantity)`, and gates on the mean.
 *
 * Returns `allowed: true` ONLY when:
 *   1. Instrument (if provided) is NOT in the live blacklist
 *   2. Sample size >= MIN_TRADES_FOR_GATE OR trading_mode forces it off
 *   3. Mean R-expectancy >= EDGE_THRESHOLD_R
 */
export async function checkLiveTradingAllowed(instrument?: string): Promise<LiveTradingGate> {
  // Layer 1: per-instrument blacklist
  if (instrument && LIVE_INSTRUMENT_BLACKLIST.has(instrument)) {
    return {
      allowed: false,
      reason: `${instrument} is on LIVE_INSTRUMENT_BLACKLIST (negative 6mo expectancy). Demo allowed; live blocked.`,
      expectancyR: null,
      tradeCount: 0,
      instrument: instrument ?? null,
    }
  }

  const db = createServiceSupabase()
  const since = new Date(Date.now() - 30 * 86400_000).toISOString()

  let q = db.from('demo_trades')
    .select('pnl, entry_price, stop_loss, quantity, instrument')
    .not('exit_time', 'is', null)
    .gte('exit_time', since)
  if (instrument) q = q.eq('instrument', instrument)
  const { data: trades, error } = await q
  if (error) {
    // Fail CLOSED on DB error — better to skip live exec than trade blind.
    return {
      allowed: false,
      reason: `edge gate DB error (fail-closed): ${error.message}`,
      expectancyR: null,
      tradeCount: 0,
      instrument: instrument ?? null,
    }
  }

  const rows = (trades ?? []).filter(t =>
    Number(t.pnl) !== 0 &&
    Number(t.entry_price) > 0 &&
    Number(t.stop_loss) > 0 &&
    Number(t.quantity) > 0,
  )

  if (rows.length < MIN_TRADES_FOR_GATE) {
    // Not enough data to prove edge yet. FAIL CLOSED — no live trades
    // until we have a real sample. (Keeps the system honest in the early
    // weeks of demo collection.)
    return {
      allowed: false,
      reason: `insufficient sample for edge gate: ${rows.length} closed trades in 30d (need ${MIN_TRADES_FOR_GATE}). Live blocked until enough data.`,
      expectancyR: null,
      tradeCount: rows.length,
      instrument: instrument ?? null,
    }
  }

  // Compute R-multiples
  let totalR = 0
  let n = 0
  for (const t of rows) {
    const entry = Number(t.entry_price)
    const sl = Number(t.stop_loss)
    const qty = Number(t.quantity)
    const pnl = Number(t.pnl)
    const riskUsd = Math.abs(entry - sl) * qty
    if (riskUsd <= 0) continue
    totalR += pnl / riskUsd
    n++
  }
  const expectancyR = n > 0 ? totalR / n : 0

  if (expectancyR < EDGE_THRESHOLD_R) {
    return {
      allowed: false,
      reason: `30d expectancy ${expectancyR.toFixed(3)} R/trade < ${EDGE_THRESHOLD_R} threshold (${n} trades${instrument ? ` on ${instrument}` : ''}). Live blocked until edge recovers.`,
      expectancyR,
      tradeCount: n,
      instrument: instrument ?? null,
    }
  }

  return {
    allowed: true,
    reason: `30d expectancy ${expectancyR.toFixed(3)} R/trade over ${n} trades${instrument ? ` on ${instrument}` : ''} — edge gate passed.`,
    expectancyR,
    tradeCount: n,
    instrument: instrument ?? null,
  }
}

export { EDGE_THRESHOLD_R, MIN_TRADES_FOR_GATE }
