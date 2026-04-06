import { createServiceSupabase } from '@/lib/supabase'
import { kellyFraction } from '@/lib/indicators'

const USD_AED = 3.6725
const DAILY_LOSS_LIMIT_PCT = 0.03   // 3% — aligned with safety.ts
const MAX_SINGLE_TRADE_PCT = 0.10   // 10% of capital per position
const MAX_POSITIONS = 3
const MIN_RR = 1.5
const MAX_SL_PCT = 6                // SL cannot exceed 6% from entry

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

  const { data: trades } = await db
    .from('trades')
    .select('pnl_pct')
    .gte('closed_at', since)
    .eq('status', 'closed')
    .not('pnl_pct', 'is', null)

  if (!trades?.length || trades.length < 5) {
    return { totalTrades: trades?.length ?? 0, winRate: 0.5, avgWinPct: 1, avgLossPct: 1, kellyFraction: 0.02, streak: 0 }
  }

  const wins = trades.filter(t => Number(t.pnl_pct) > 0)
  const losses = trades.filter(t => Number(t.pnl_pct) <= 0)
  const winRate = wins.length / trades.length
  const avgWinPct = wins.length > 0 ? wins.reduce((s, t) => s + Number(t.pnl_pct), 0) / wins.length : 1
  const avgLossPct = losses.length > 0 ? losses.reduce((s, t) => s + Math.abs(Number(t.pnl_pct)), 0) / losses.length : 1

  const kf = kellyFraction(winRate, avgWinPct, avgLossPct)

  let streak = 0
  for (let i = trades.length - 1; i >= 0; i--) {
    const pnl = Number(trades[i].pnl_pct)
    if (i === trades.length - 1) { streak = pnl > 0 ? 1 : -1; continue }
    if ((pnl > 0 && streak > 0) || (pnl <= 0 && streak < 0)) {
      streak += streak > 0 ? 1 : -1
    } else break
  }

  return { totalTrades: trades.length, winRate, avgWinPct, avgLossPct, kellyFraction: kf, streak }
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

export async function checkDailyLossLimit(capitalAed: number): Promise<RiskCheck> {
  const db = createServiceSupabase()
  const today = new Date().toISOString().split('T')[0]

  const { data: closedToday } = await db
    .from('trades')
    .select('pnl_aed')
    .gte('closed_at', `${today}T00:00:00`)
    .eq('is_demo', false)

  const dailyPnl = (closedToday ?? []).reduce((s, t) => s + Number(t.pnl_aed ?? 0), 0)
  const limit = capitalAed * DAILY_LOSS_LIMIT_PCT

  if (dailyPnl < -limit) {
    return { allowed: false, reason: `Daily loss limit hit: AED ${Math.abs(dailyPnl).toFixed(0)} lost (limit: AED ${limit.toFixed(0)})` }
  }

  return { allowed: true, reason: `Daily P&L: AED ${dailyPnl.toFixed(0)} (limit: -AED ${limit.toFixed(0)})` }
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

export function checkTradeSize(tradeAmountAed: number, capitalAed: number): RiskCheck {
  const maxAmount = capitalAed * MAX_SINGLE_TRADE_PCT
  if (tradeAmountAed > maxAmount) {
    return { allowed: false, reason: `Trade AED ${tradeAmountAed.toFixed(0)} exceeds ${(MAX_SINGLE_TRADE_PCT * 100)}% limit (AED ${maxAmount.toFixed(0)})` }
  }
  return { allowed: true, reason: `Trade size OK: AED ${tradeAmountAed.toFixed(0)} / ${maxAmount.toFixed(0)}` }
}

export async function fullRiskCheck(capitalAed: number, tradeAmountAed: number): Promise<RiskCheck> {
  const dailyCheck = await checkDailyLossLimit(capitalAed)
  if (!dailyCheck.allowed) return dailyCheck

  const posCheck = await checkPositionLimit()
  if (!posCheck.allowed) return posCheck

  const sizeCheck = checkTradeSize(tradeAmountAed, capitalAed)
  if (!sizeCheck.allowed) return sizeCheck

  return { allowed: true, reason: 'All risk checks passed' }
}

export function riskBasedPositionSize(
  capitalUsd: number,
  entryPrice: number,
  stopLoss: number,
  stats: TradeStats,
): { units: number; notionalUsd: number; riskPct: number } {
  const riskPerUnit = Math.abs(entryPrice - stopLoss)
  if (riskPerUnit <= 0) return { units: 0, notionalUsd: 0, riskPct: 0 }

  const baseRiskPct = 0.02
  const kellyRisk = stats.kellyFraction > 0 ? stats.kellyFraction : baseRiskPct

  let riskPct = Math.min(kellyRisk, 0.05)

  if (stats.streak <= -3) riskPct *= 0.5
  if (stats.streak >= 5) riskPct = Math.min(riskPct * 1.2, 0.05)
  if (stats.totalTrades < 10) riskPct = Math.min(riskPct, 0.02)

  const riskAmount = capitalUsd * riskPct
  const units = riskAmount / riskPerUnit
  const notionalUsd = units * entryPrice
  const maxNotional = capitalUsd * 0.10
  const cappedNotional = Math.min(notionalUsd, maxNotional)
  const cappedUnits = cappedNotional / entryPrice

  return { units: cappedUnits, notionalUsd: cappedNotional, riskPct }
}

export { DAILY_LOSS_LIMIT_PCT, MAX_SINGLE_TRADE_PCT, MAX_POSITIONS, USD_AED, MIN_RR, MAX_SL_PCT }
