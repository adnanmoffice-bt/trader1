import { createServiceSupabase } from '@/lib/supabase'

const MAX_DRAWDOWN_HARD_STOP = 0.75  // 75% — only kill switch at catastrophic level
const DAILY_LOSS_LIMIT_PCT = 0.03    // 3% max daily loss
const MAX_POSITIONS = 3

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

  // Daily loss: sum of today's closed trades from BOTH tables
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const todayISO = todayStart.toISOString()

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
