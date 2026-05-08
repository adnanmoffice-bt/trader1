import { createServiceSupabase } from '@/lib/supabase'
import { kellyFraction } from '@/lib/indicators'

const DAILY_LOSS_LIMIT_PCT = 0.05   // 5% — aligned with safety.ts (raised from 3% in commit be92ffce 2026-04-23)
const MAX_SINGLE_TRADE_PCT = 0.10   // 10% of capital per position
const MAX_POSITIONS = 3
const MIN_RR = 1.5
const MAX_SL_PCT = 6                // SL cannot exceed 6% from entry

// ─────────────────────────────────────────────────────────────────────────────
// PROBE WEEK — added 2026-05-08 under operator directive
// ─────────────────────────────────────────────────────────────────────────────
//
// Operator: "riskiraj 500 dolara ovu sedmicu da vidimo da li cemo izvuci
// profit, u live ne demo". One-week real-money trial at 1.5%/trade
// (REDUCED_RISK_CEILING_PCT lifted 0.5 → 2.0 in lib/safety.ts to allow
// the bypass to reach 1.5%). Hard kill at $200 cumulative real loss.
//
// PROBE_WEEK_START_ISO: 2026-05-08 14:30 Dubai = 2026-05-08 10:30 UTC.
// Real trades opened before this timestamp are excluded from the kill
// math (there shouldn't be any — last 30 days had 0 real fills — but
// defensive).
//
// PROBE_WEEK_END_ISO: 2026-05-16 00:00 Dubai = 2026-05-15 20:00 UTC.
// After this, checkProbeWeekKill returns blocked regardless of P&L —
// new live opens stop, existing live positions ride out to SL/TP.
//
// PROBE_WEEK_KILL_USD: cumulative real-money realized P&L. When the sum
// of `trades.pnl` (status in ['closed','stopped']) since
// PROBE_WEEK_START_ISO drops to -$200 or worse, the function:
//   1. Inserts an `agent_logs` row (agent='probe-week-kill', level='error')
//      so the kill state is durable across cron restarts.
//   2. Sets `user_settings.trading_mode = 'demo'` so the war-room's first
//      live-exec gate (line 1102 of agents/war-room.ts) closes the path.
//   3. Returns `allowed: false` so the in-flight tick also blocks.
//
// Reverting the kill once tripped: requires a developer to either delete
// the agent_logs row (`DELETE FROM agent_logs WHERE agent='probe-week-kill'`)
// AND re-set trading_mode='live' in user_settings, OR ship a code commit.
// Intentionally inconvenient — the operator wanted this to be sticky.
const PROBE_WEEK_START_ISO = '2026-05-08T10:30:00Z'
const PROBE_WEEK_END_ISO   = '2026-05-15T20:00:00Z'
const PROBE_WEEK_KILL_USD  = 200

export interface RiskCheck {
  allowed: boolean
  reason: string
}

export interface TradeStats {
  totalTrades: number
  winRate: number
  avgWinPct: number
  avgLossPct: number
  kellyFraction: number
  streak: number
}

export async function getTradeStats(lookbackDays = 30): Promise<TradeStats> {
  const db = createServiceSupabase()
  const since = new Date(Date.now() - lookbackDays * 86400_000).toISOString()

  // Check BOTH trades and demo_trades for unified risk view
  const { data: liveTrades } = await db
    .from('trades')
    .select('pnl_pct, closed_at')
    .gte('closed_at', since)
    .in('status', ['closed', 'stopped'])
    .not('pnl_pct', 'is', null)
    .order('closed_at', { ascending: true })

  const { data: demoTrades } = await db
    .from('demo_trades')
    .select('pnl_pct, exit_time')
    .not('exit_time', 'is', null)
    .not('pnl_pct', 'is', null)
    .gte('exit_time', since)
    .order('exit_time', { ascending: true })

  const allTrades = [
    ...(liveTrades ?? []).map(t => ({ pnl_pct: Number(t.pnl_pct), time: t.closed_at })),
    ...(demoTrades ?? []).map(t => ({ pnl_pct: Number(t.pnl_pct), time: t.exit_time })),
  ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

  if (!allTrades.length || allTrades.length < 5) {
    return { totalTrades: allTrades.length, winRate: 0.5, avgWinPct: 1, avgLossPct: 1, kellyFraction: 0.02, streak: 0 }
  }

  const wins = allTrades.filter(t => t.pnl_pct > 0)
  const losses = allTrades.filter(t => t.pnl_pct <= 0)
  const winRate = wins.length / allTrades.length
  const avgWinPct = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl_pct, 0) / wins.length : 1
  const avgLossPct = losses.length > 0 ? losses.reduce((s, t) => s + Math.abs(t.pnl_pct), 0) / losses.length : 1

  const kf = kellyFraction(winRate, avgWinPct, avgLossPct)

  // Streak from most recent trades (chronological order guaranteed)
  let streak = 0
  for (let i = allTrades.length - 1; i >= 0; i--) {
    const pnl = allTrades[i].pnl_pct
    if (i === allTrades.length - 1) { streak = pnl > 0 ? 1 : -1; continue }
    if ((pnl > 0 && streak > 0) || (pnl <= 0 && streak < 0)) {
      streak += streak > 0 ? 1 : -1
    } else break
  }

  return { totalTrades: allTrades.length, winRate, avgWinPct, avgLossPct, kellyFraction: kf, streak }
}

export function hardRiskCheck(
  rr: number,
  entryPrice: number,
  stopLoss: number,
  openPositions: number,
): RiskCheck {
  if (rr < MIN_RR) {
    return { allowed: false, reason: `R:R ${rr.toFixed(2)} < ${MIN_RR} minimum` }
  }
  if (openPositions >= MAX_POSITIONS) {
    return { allowed: false, reason: `Max positions (${MAX_POSITIONS}) reached: ${openPositions} open` }
  }
  if (!stopLoss || !entryPrice) {
    return { allowed: false, reason: 'Missing SL or entry price' }
  }
  const slPct = Math.abs(entryPrice - stopLoss) / entryPrice * 100
  if (slPct > MAX_SL_PCT) {
    return { allowed: false, reason: `SL ${slPct.toFixed(1)}% exceeds ${MAX_SL_PCT}% max from entry` }
  }
  return { allowed: true, reason: `R:R ${rr.toFixed(2)} SL:${slPct.toFixed(1)}% Pos:${openPositions}/${MAX_POSITIONS}` }
}

export async function checkDailyLossLimit(capitalUsd: number): Promise<RiskCheck> {
  const db = createServiceSupabase()
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const todayISO = todayStart.toISOString()

  // Check BOTH trades and demo_trades for unified daily loss view
  const { data: liveToday } = await db
    .from('trades')
    .select('pnl')
    .gte('closed_at', todayISO)
    .in('status', ['closed', 'stopped'])

  const { data: demoToday } = await db
    .from('demo_trades')
    .select('pnl')
    .not('exit_time', 'is', null)
    .gte('exit_time', todayISO)

  const livePnl = (liveToday ?? []).reduce((s, t) => s + Number(t.pnl ?? 0), 0)
  const demoPnl = (demoToday ?? []).reduce((s, t) => s + Number(t.pnl ?? 0), 0)
  const dailyPnl = livePnl + demoPnl
  const limit = capitalUsd * DAILY_LOSS_LIMIT_PCT

  if (dailyPnl <= -limit) {
    return { allowed: false, reason: `Daily loss limit hit: $${Math.abs(dailyPnl).toFixed(0)} lost (limit: $${limit.toFixed(0)})` }
  }

  return { allowed: true, reason: `Daily P&L: $${dailyPnl.toFixed(0)} (limit: -$${limit.toFixed(0)})` }
}

/**
 * PROBE WEEK kill switch — added 2026-05-08.
 *
 * Returns `allowed: false` when:
 *   - now < PROBE_WEEK_START_ISO → not started yet (cautious, wait for activation)
 *   - now > PROBE_WEEK_END_ISO   → probe ended naturally
 *   - probe-week-kill log row exists in last 30d → kill already tripped
 *   - cumulative real `trades.pnl` since start ≤ -PROBE_WEEK_KILL_USD → trip kill now
 *
 * On a fresh trip, persists state by:
 *   1. Inserting an `agent_logs` kill marker
 *   2. Setting `user_settings.trading_mode = 'demo'`
 *
 * Read-only on every other path. Pure function of two SQL reads + (rarely) two writes.
 *
 * Demo trades and demo P&L are NEVER counted here — the kill is purely about
 * real-money fills (trades table, status='closed' or 'stopped').
 */
export async function checkProbeWeekKill(): Promise<RiskCheck> {
  const db = createServiceSupabase()
  const now = new Date()
  const start = new Date(PROBE_WEEK_START_ISO)
  const end = new Date(PROBE_WEEK_END_ISO)

  if (now < start) {
    return { allowed: false, reason: `probe-week not started yet (starts ${PROBE_WEEK_START_ISO})` }
  }
  if (now > end) {
    return { allowed: false, reason: `probe-week ended ${PROBE_WEEK_END_ISO} — live opens halted (existing positions ride out)` }
  }

  // Existing kill marker?
  const since30d = new Date(now.getTime() - 30 * 86400_000).toISOString()
  const { data: existing } = await db
    .from('agent_logs')
    .select('id')
    .eq('agent', 'probe-week-kill')
    .eq('level', 'error')
    .gte('created_at', since30d)
    .limit(1)
    .maybeSingle()

  if (existing) {
    return { allowed: false, reason: `probe-week kill switch already active — manual reset required (delete agent_logs row + set trading_mode='live')` }
  }

  // Real-money realized P&L since probe start.
  const { data: realTrades } = await db
    .from('trades')
    .select('pnl')
    .gte('closed_at', PROBE_WEEK_START_ISO)
    .in('status', ['closed', 'stopped'])

  const realizedUsd = (realTrades ?? []).reduce((s, t) => s + Number(t.pnl ?? 0), 0)

  if (realizedUsd <= -PROBE_WEEK_KILL_USD) {
    // TRIP. Persist + demote mode. Best-effort writes — even if they fail
    // the in-flight tick still blocks because we return allowed=false below.
    try {
      await db.from('agent_logs').insert({
        agent: 'probe-week-kill',
        level: 'error',
        message: `PROBE WEEK KILL — cumulative real loss $${realizedUsd.toFixed(2)} reached -$${PROBE_WEEK_KILL_USD} threshold. Live execution halted.`,
        metadata: {
          realized_usd: realizedUsd,
          threshold_usd: -PROBE_WEEK_KILL_USD,
          trade_count: (realTrades ?? []).length,
          start_iso: PROBE_WEEK_START_ISO,
        },
      })
    } catch { /* best-effort */ }
    try {
      await db.from('user_settings').update({ trading_mode: 'demo' }).neq('id', 0)
    } catch { /* best-effort */ }
    return {
      allowed: false,
      reason: `probe-week KILL TRIPPED — realized $${realizedUsd.toFixed(2)} ≤ -$${PROBE_WEEK_KILL_USD}. trading_mode flipped to demo.`,
    }
  }

  const remaining = PROBE_WEEK_KILL_USD + realizedUsd  // realizedUsd is negative on a loss
  return {
    allowed: true,
    reason: `probe-week active: realized $${realizedUsd.toFixed(2)} / -$${PROBE_WEEK_KILL_USD} kill threshold ($${remaining.toFixed(2)} headroom)`,
  }
}

export async function checkPositionLimit(): Promise<RiskCheck> {
  const db = createServiceSupabase()
  const { count } = await db
    .from('positions')
    .select('*', { count: 'exact', head: true })
    .eq('is_demo', false)

  if ((count ?? 0) >= MAX_POSITIONS) {
    return { allowed: false, reason: `Max positions (${MAX_POSITIONS}) reached` }
  }

  return { allowed: true, reason: `Open positions: ${count ?? 0}/${MAX_POSITIONS}` }
}

export function checkTradeSize(tradeAmountUsd: number, capitalUsd: number): RiskCheck {
  const maxAmount = capitalUsd * MAX_SINGLE_TRADE_PCT
  if (tradeAmountUsd > maxAmount) {
    return { allowed: false, reason: `Trade $${tradeAmountUsd.toFixed(0)} exceeds ${(MAX_SINGLE_TRADE_PCT * 100)}% limit ($${maxAmount.toFixed(0)})` }
  }
  return { allowed: true, reason: `Trade size OK: $${tradeAmountUsd.toFixed(0)} / $${maxAmount.toFixed(0)}` }
}

export async function fullRiskCheck(capitalUsd: number, tradeAmountUsd: number): Promise<RiskCheck> {
  const dailyCheck = await checkDailyLossLimit(capitalUsd)
  if (!dailyCheck.allowed) return dailyCheck

  const posCheck = await checkPositionLimit()
  if (!posCheck.allowed) return posCheck

  const sizeCheck = checkTradeSize(tradeAmountUsd, capitalUsd)
  if (!sizeCheck.allowed) return sizeCheck

  return { allowed: true, reason: 'All risk checks passed' }
}

export function riskBasedPositionSize(
  capitalUsd: number,
  entryPrice: number,
  stopLoss: number,
  stats: TradeStats,
  confidence = 80,
): { units: number; notionalUsd: number; riskPct: number } {
  const riskPerUnit = Math.abs(entryPrice - stopLoss)
  if (riskPerUnit <= 0) return { units: 0, notionalUsd: 0, riskPct: 0 }

  // Confidence-tiered risk: scale with signal quality
  const confRisk = confidence >= 90 ? 0.02 : confidence >= 80 ? 0.015 : confidence >= 65 ? 0.01 : 0.005
  const kellyRisk = stats.kellyFraction > 0 ? Math.min(stats.kellyFraction, 0.03) : confRisk

  let riskPct = stats.totalTrades >= 10 ? Math.min(kellyRisk, confRisk) : confRisk

  // Streak-based adjustment
  if (stats.streak <= -2) riskPct = Math.max(riskPct * 0.5, 0.005)  // 2 losses: halve risk
  if (stats.streak <= -3) riskPct = Math.max(riskPct * 0.25, 0.005) // 3 losses: quarter risk
  if (stats.streak >= 3) riskPct = Math.min(riskPct * 1.1, 0.03)    // 3 wins: modest increase

  riskPct = Math.min(riskPct, 0.03) // hard cap 3%

  const riskAmount = capitalUsd * riskPct
  const units = riskAmount / riskPerUnit
  const notionalUsd = units * entryPrice
  const maxNotional = capitalUsd * 0.10
  const cappedNotional = Math.min(notionalUsd, maxNotional)
  const cappedUnits = cappedNotional / entryPrice

  return { units: cappedUnits, notionalUsd: cappedNotional, riskPct }
}

export function estimateSlippageAndFees(
  notionalUsd: number,
  instrument: string,
): { feesUsd: number; slippageUsd: number; totalCostUsd: number } {
  const feeRate = 0.001 // 0.1% per side
  const feesUsd = notionalUsd * feeRate * 2 // entry + exit

  const highLiquidity = ['BTC/USD', 'ETH/USD']
  const slippageRate = highLiquidity.includes(instrument) ? 0.0005 : 0.001
  const slippageUsd = notionalUsd * slippageRate * 2

  return {
    feesUsd: Math.round(feesUsd * 100) / 100,
    slippageUsd: Math.round(slippageUsd * 100) / 100,
    totalCostUsd: Math.round((feesUsd + slippageUsd) * 100) / 100,
  }
}

export { DAILY_LOSS_LIMIT_PCT, MAX_SINGLE_TRADE_PCT, MAX_POSITIONS, MIN_RR, MAX_SL_PCT, PROBE_WEEK_START_ISO, PROBE_WEEK_END_ISO, PROBE_WEEK_KILL_USD }
