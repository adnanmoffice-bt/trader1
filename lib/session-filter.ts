/**
 * Session-of-day filter for war-room entries.
 *
 * Backtest 2026-04-30 (10-day window, 17 closed demo trades on BTC/ETH/XAU):
 *   Dubai 02:00–09:00  → 0/8  (0% WR)   — Asia chop window for crypto majors
 *   Dubai 09:00–14:00  → 0/0  (no trades)
 *   Dubai 14:00–20:00  → 2/6  (33% WR)  — London/NY overlap
 *   Dubai 20:00–02:00  → 2/3  (67% WR)  — NY PM + Asia open
 *
 * Filtering out 02:00–09:00 alone takes the 10-day result from −$308.65
 * (4W/13L, 23.5%) to roughly +$310 (4W/5L, 44%). Same signals.
 *
 * The gate is OVERRIDABLE for very high-conviction setups so we don't choke
 * off rare strong opportunities (e.g. dovish FOMC surprise into Asia open).
 */

export interface SessionGateInput {
  /** war-room conviction score (0–100) on the proposed trade */
  conviction: number
  /** macro risk level from buildMacroContext() */
  macroRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' | null
  /** number of confirmed triggers (rawTriggers.length) */
  triggerCount: number
  /** Date object — defaults to now. Pass-in for tests. */
  now?: Date
}

export interface SessionGateResult {
  allowed: boolean
  reason: string
  dubaiHour: number
  sessionLabel: 'asia-chop' | 'asia-late' | 'eu-ny-overlap' | 'ny-pm-asia-open'
}

/**
 * Decide whether to allow a new entry given the current Dubai hour.
 *
 * Rule: the Asia-chop window (02:00–09:00 Dubai) is blocked unless EITHER
 *   (a) conviction ≥ 90 AND macroRisk ≤ MEDIUM, OR
 *   (b) triggerCount ≥ 3 (confluence override)
 */
export function checkSessionGate(input: SessionGateInput): SessionGateResult {
  const now = input.now ?? new Date()
  const dubaiHour = (now.getUTCHours() + 4) % 24

  let sessionLabel: SessionGateResult['sessionLabel']
  if (dubaiHour >= 2 && dubaiHour < 9) sessionLabel = 'asia-chop'
  else if (dubaiHour >= 9 && dubaiHour < 14) sessionLabel = 'asia-late'
  else if (dubaiHour >= 14 && dubaiHour < 20) sessionLabel = 'eu-ny-overlap'
  else sessionLabel = 'ny-pm-asia-open'

  if (sessionLabel !== 'asia-chop') {
    return { allowed: true, reason: `${sessionLabel} (Dubai ${dubaiHour}:00) — productive window`, dubaiHour, sessionLabel }
  }

  // Asia-chop: only allow on very high-conviction or strong confluence.
  const highConviction = input.conviction >= 90 && (input.macroRisk === 'LOW' || input.macroRisk === 'MEDIUM')
  const strongConfluence = input.triggerCount >= 3
  if (highConviction) {
    return { allowed: true, reason: `asia-chop override — conviction ${input.conviction}% AND macro ${input.macroRisk}`, dubaiHour, sessionLabel }
  }
  if (strongConfluence) {
    return { allowed: true, reason: `asia-chop override — ${input.triggerCount} triggers in confluence`, dubaiHour, sessionLabel }
  }

  return {
    allowed: false,
    reason: `asia-chop window (Dubai ${dubaiHour}:00, hist 0% WR) — need conviction ≥ 90 + macro ≤ MEDIUM, or 3+ triggers`,
    dubaiHour,
    sessionLabel,
  }
}
