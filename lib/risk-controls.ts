import { createServiceSupabase } from '@/lib/supabase'

const USD_AED = 3.6725
const DAILY_LOSS_LIMIT_PCT = 0.05   // 5% of capital
const MAX_SINGLE_TRADE_PCT = 0.10   // 10% of capital
const MAX_POSITIONS = 3

export interface RiskCheck {
  allowed: boolean
  reason: string
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

export { DAILY_LOSS_LIMIT_PCT, MAX_SINGLE_TRADE_PCT, MAX_POSITIONS, USD_AED }
