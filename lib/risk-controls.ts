import { createServiceSupabase } from '@/lib/supabase'
import { kellyFraction } from '@/lib/indicators'

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

export { DAILY_LOSS_LIMIT_PCT, MAX_SINGLE_TRADE_PCT, MAX_POSITIONS, MIN_RR, MAX_SL_PCT }
