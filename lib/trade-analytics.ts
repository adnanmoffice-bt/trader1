import { createServiceSupabase } from '@/lib/supabase'
import type { OHLCV } from '@/types'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface TradeAnalyticsResult {
  trade_id: string
  instrument: string
  direction: string
  mfe_price: number
  mfe_pct: number
  mae_price: number
  mae_pct: number
  running_max_pnl: number
  running_min_pnl: number
  time_in_green_mins: number
  time_in_red_mins: number
  holding_duration_mins: number
  entry_hour: number
  exit_hour: number
  entry_day_of_week: number
  best_exit_price: number
  best_exit_pnl: number
  exit_efficiency_pct: number
  r_value: number
}

export interface DailySnapshot {
  date: string
  equity: number
  daily_pnl: number
  cumulative_pnl: number
  trade_count: number
  win_count: number
  loss_count: number
  win_rate: number
  profit_factor: number | null
  expectancy: number | null
  avg_r_value: number | null
  max_drawdown_pct: number
  current_drawdown_pct: number
  win_streak: number
  loss_streak: number
  max_win_streak: number
  max_loss_streak: number
  best_instrument: string | null
  worst_instrument: string | null
  avg_hold_duration_mins: number | null
  avg_mfe_pct: number | null
  avg_mae_pct: number | null
  avg_exit_efficiency_pct: number | null
  kelly_fraction: number | null
}

export interface PerformanceContext {
  total_trades: number
  win_rate: number
  profit_factor: number
  expectancy: number
  avg_r_value: number
  current_streak: number
  streak_type: 'win' | 'loss' | 'none'
  current_drawdown_pct: number
  max_drawdown_pct: number
  avg_exit_efficiency_pct: number
  avg_mfe_pct: number
  avg_mae_pct: number
  kelly_fraction: number
  by_instrument: Record<string, { trades: number; win_rate: number; avg_pnl: number; avg_r: number }>
  by_hour: Record<number, { trades: number; win_rate: number }>
  by_day: Record<number, { trades: number; win_rate: number }>
  weaknesses: string[]
  strengths: string[]
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPUTE TRADE ANALYTICS — MFE/MAE/exit analysis for a single closed trade
// ═══════════════════════════════════════════════════════════════════════════

export function computeTradeAnalytics(
  trade: {
    id: string; instrument: string; direction: string
    entry_price: number; exit_price: number; stop_loss: number
    take_profit: number; quantity: number; pnl: number
    entry_time: string; exit_time: string
  },
  candles: OHLCV[]
): TradeAnalyticsResult {
  const entry = trade.entry_price
  const qty = trade.quantity
  const isLong = trade.direction === 'long'
  const entryTime = new Date(trade.entry_time).getTime()
  const exitTime = new Date(trade.exit_time).getTime()

  let maxFavorable = 0, maxAdverse = 0
  let bestExitPrice = entry
  let runningMaxPnl = 0, runningMinPnl = 0
  let greenMins = 0, redMins = 0

  const tradeDurationCandles = candles.filter(
    c => c.timestamp >= entryTime && c.timestamp <= exitTime
  )

  for (const c of tradeDurationCandles) {
    const favorablePrice = isLong ? c.high : c.low
    const adversePrice = isLong ? c.low : c.high

    const favorableMove = isLong ? favorablePrice - entry : entry - favorablePrice
    const adverseMove = isLong ? entry - adversePrice : adversePrice - entry

    if (favorableMove > maxFavorable) {
      maxFavorable = favorableMove
      bestExitPrice = favorablePrice
    }
    if (adverseMove > maxAdverse) maxAdverse = adverseMove

    const midPnl = isLong ? (c.close - entry) * qty : (entry - c.close) * qty
    if (midPnl > runningMaxPnl) runningMaxPnl = midPnl
    if (midPnl < runningMinPnl) runningMinPnl = midPnl

    const candleMins = 60
    if (midPnl >= 0) greenMins += candleMins
    else redMins += candleMins
  }

  const mfePct = entry > 0 ? (maxFavorable / entry) * 100 : 0
  const maePct = entry > 0 ? (maxAdverse / entry) * 100 : 0
  const bestExitPnl = isLong
    ? (bestExitPrice - entry) * qty
    : (entry - bestExitPrice) * qty

  const actualPnl = trade.pnl
  const exitEfficiency = bestExitPnl > 0 ? (actualPnl / bestExitPnl) * 100 : (actualPnl >= 0 ? 100 : 0)

  const slDist = Math.abs(entry - trade.stop_loss)
  const rValue = slDist > 0 ? actualPnl / (slDist * qty) : 0

  const entryDate = new Date(trade.entry_time)
  const exitDate = new Date(trade.exit_time)
  const holdMins = Math.round((exitTime - entryTime) / 60000)

  return {
    trade_id: trade.id,
    instrument: trade.instrument,
    direction: trade.direction,
    mfe_price: isLong ? entry + maxFavorable : entry - maxFavorable,
    mfe_pct: mfePct,
    mae_price: isLong ? entry - maxAdverse : entry + maxAdverse,
    mae_pct: maePct,
    running_max_pnl: runningMaxPnl,
    running_min_pnl: runningMinPnl,
    time_in_green_mins: greenMins,
    time_in_red_mins: redMins,
    holding_duration_mins: holdMins,
    entry_hour: entryDate.getUTCHours(),
    exit_hour: exitDate.getUTCHours(),
    entry_day_of_week: entryDate.getUTCDay(),
    best_exit_price: bestExitPrice,
    best_exit_pnl: bestExitPnl,
    exit_efficiency_pct: Math.min(Math.max(exitEfficiency, -100), 100),
    r_value: Math.round(rValue * 100) / 100,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DAILY SNAPSHOT — aggregate all trades for a date into performance metrics
// ═══════════════════════════════════════════════════════════════════════════

export async function computeDailySnapshot(dateStr: string): Promise<DailySnapshot> {
  const db = createServiceSupabase()

  const { data: session } = await db.from('demo_sessions').select('initial_capital')
    .eq('status', 'running').order('created_at', { ascending: false }).limit(1).single()
  const initialCap = session?.initial_capital ?? 200000

  const { data: todayTrades } = await db.from('demo_trades').select('*')
    .gte('exit_time', `${dateStr}T00:00:00`).lt('exit_time', `${dateStr}T23:59:59`)
    .not('exit_time', 'is', null)

  const trades = (todayTrades ?? []).map(t => ({ ...t, pnl: +(t.pnl ?? 0) }))
  const wins = trades.filter(t => t.pnl > 0)
  const losses = trades.filter(t => t.pnl <= 0)
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const dailyPnl = trades.reduce((s, t) => s + t.pnl, 0)

  const { data: allClosedBefore } = await db.from('demo_trades').select('pnl')
    .lt('exit_time', `${dateStr}T23:59:59`).not('exit_time', 'is', null)
  const cumulativePnl = (allClosedBefore ?? []).reduce((s, t) => s + +(t.pnl ?? 0), 0)

  const { data: analytics } = await db.from('trade_analytics').select('*')
    .in('trade_id', trades.map(t => t.id))

  const analyticsMap = new Map((analytics ?? []).map(a => [a.trade_id, a]))

  const rValues = trades.map(t => {
    const a = analyticsMap.get(t.id)
    return a?.r_value ? +a.r_value : null
  }).filter((v): v is number => v !== null)

  // Streaks from recent trades
  const { data: recentTrades } = await db.from('demo_trades').select('pnl, exit_time')
    .not('exit_time', 'is', null).order('exit_time', { ascending: false }).limit(50)

  let winStreak = 0, lossStreak = 0, maxWS = 0, maxLS = 0, curWS = 0, curLS = 0
  for (const t of (recentTrades ?? [])) {
    const p = +(t.pnl ?? 0)
    if (p > 0) { curWS++; curLS = 0; if (curWS > maxWS) maxWS = curWS }
    else { curLS++; curWS = 0; if (curLS > maxLS) maxLS = curLS }
  }
  winStreak = curWS; lossStreak = curLS

  // Drawdown from equity curve
  const equity = initialCap + cumulativePnl
  let peak = initialCap
  const allPnls = (allClosedBefore ?? []).map(t => +(t.pnl ?? 0))
  let running = initialCap, maxDD = 0
  for (const p of allPnls) {
    running += p
    if (running > peak) peak = running
    const dd = (peak - running) / peak
    if (dd > maxDD) maxDD = dd
  }
  const currentDD = peak > 0 ? (peak - equity) / peak : 0

  // By instrument
  const byInst: Record<string, { pnl: number; count: number; wins: number }> = {}
  for (const t of trades) {
    if (!byInst[t.instrument]) byInst[t.instrument] = { pnl: 0, count: 0, wins: 0 }
    byInst[t.instrument].pnl += t.pnl
    byInst[t.instrument].count++
    if (t.pnl > 0) byInst[t.instrument].wins++
  }
  const sorted = Object.entries(byInst).sort((a, b) => b[1].pnl - a[1].pnl)

  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0
  const expectancy = trades.length > 0
    ? (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss
    : 0

  const wr = wins.length / (trades.length || 1)
  const kelly = avgLoss > 0 ? wr - (1 - wr) / (avgWin / avgLoss) : 0

  const holdDurations = (analytics ?? []).map(a => +a.holding_duration_mins).filter(v => v > 0)
  const mfePcts = (analytics ?? []).map(a => +a.mfe_pct).filter(v => !isNaN(v))
  const maePcts = (analytics ?? []).map(a => +a.mae_pct).filter(v => !isNaN(v))
  const exitEffs = (analytics ?? []).map(a => +a.exit_efficiency_pct).filter(v => !isNaN(v))

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null

  return {
    date: dateStr,
    equity,
    daily_pnl: dailyPnl,
    cumulative_pnl: cumulativePnl,
    trade_count: trades.length,
    win_count: wins.length,
    loss_count: losses.length,
    win_rate: winRate,
    profit_factor: grossLoss > 0 ? grossProfit / grossLoss : null,
    expectancy: expectancy || null,
    avg_r_value: avg(rValues),
    max_drawdown_pct: maxDD * 100,
    current_drawdown_pct: currentDD * 100,
    win_streak: winStreak,
    loss_streak: lossStreak,
    max_win_streak: maxWS,
    max_loss_streak: maxLS,
    best_instrument: sorted[0]?.[0] ?? null,
    worst_instrument: sorted.length > 1 ? sorted[sorted.length - 1][0] : null,
    avg_hold_duration_mins: avg(holdDurations) ? Math.round(avg(holdDurations)!) : null,
    avg_mfe_pct: avg(mfePcts) ? Math.round(avg(mfePcts)! * 100) / 100 : null,
    avg_mae_pct: avg(maePcts) ? Math.round(avg(maePcts)! * 100) / 100 : null,
    avg_exit_efficiency_pct: avg(exitEffs) ? Math.round(avg(exitEffs)! * 100) / 100 : null,
    kelly_fraction: Math.max(0, Math.min(kelly, 0.25)),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PERFORMANCE CONTEXT — summary for AI agents to use in their decisions
// ═══════════════════════════════════════════════════════════════════════════

export async function getPerformanceContext(instrument?: string): Promise<PerformanceContext> {
  const db = createServiceSupabase()

  const { data: allTrades } = await db.from('demo_trades').select('id, instrument, direction, pnl, pnl_pct, entry_time, exit_time, stop_loss, entry_price')
    .not('exit_time', 'is', null).order('exit_time', { ascending: false }).limit(100)

  const trades = (allTrades ?? []).map(t => ({
    ...t, pnl: +(t.pnl ?? 0), entry_price: +(t.entry_price ?? 0), stop_loss: +(t.stop_loss ?? 0),
  }))

  const { data: analytics } = await db.from('trade_analytics').select('*')
    .in('trade_id', trades.map(t => t.id))
  const aMap = new Map((analytics ?? []).map(a => [a.trade_id, a]))

  const wins = trades.filter(t => t.pnl > 0)
  const losses = trades.filter(t => t.pnl <= 0)
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))

  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 50
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 1
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0
  const expectancy = trades.length > 0 ? (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss : 0

  const rValues = analytics?.map(a => +(a.r_value ?? 0)).filter(v => v !== 0) ?? []
  const avgR = rValues.length > 0 ? rValues.reduce((s, v) => s + v, 0) / rValues.length : 0

  // Current streak
  let streak = 0, streakType: 'win' | 'loss' | 'none' = 'none'
  for (const t of trades) {
    if (streak === 0) { streakType = t.pnl > 0 ? 'win' : 'loss'; streak = 1 }
    else if ((streakType === 'win' && t.pnl > 0) || (streakType === 'loss' && t.pnl <= 0)) streak++
    else break
  }

  // By instrument
  const byInst: Record<string, { trades: number; win_rate: number; avg_pnl: number; avg_r: number }> = {}
  const instGroups: Record<string, typeof trades> = {}
  for (const t of trades) {
    if (!instGroups[t.instrument]) instGroups[t.instrument] = []
    instGroups[t.instrument].push(t)
  }
  for (const [inst, tds] of Object.entries(instGroups)) {
    const w = tds.filter(t => t.pnl > 0).length
    const rs = tds.map(t => { const a = aMap.get(t.id); return a ? +(a.r_value ?? 0) : 0 }).filter(v => v !== 0)
    byInst[inst] = {
      trades: tds.length,
      win_rate: (w / tds.length) * 100,
      avg_pnl: tds.reduce((s, t) => s + t.pnl, 0) / tds.length,
      avg_r: rs.length > 0 ? rs.reduce((s, v) => s + v, 0) / rs.length : 0,
    }
  }

  // By hour and day of week
  const byHour: Record<number, { trades: number; win_rate: number }> = {}
  const byDay: Record<number, { trades: number; win_rate: number }> = {}
  for (const t of trades) {
    if (!t.entry_time) continue
    const d = new Date(t.entry_time)
    const h = d.getUTCHours(), dow = d.getUTCDay()
    if (!byHour[h]) byHour[h] = { trades: 0, win_rate: 0 }
    if (!byDay[dow]) byDay[dow] = { trades: 0, win_rate: 0 }
    byHour[h].trades++
    byDay[dow].trades++
  }
  for (const t of trades.filter(t => t.pnl > 0)) {
    if (!t.entry_time) continue
    const h = new Date(t.entry_time).getUTCHours()
    const dow = new Date(t.entry_time).getUTCDay()
    if (byHour[h]) byHour[h].win_rate = (byHour[h].win_rate * (byHour[h].trades - 1) + 100) / byHour[h].trades
  }
  for (const [h, v] of Object.entries(byHour)) {
    const hTrades = trades.filter(t => t.entry_time && new Date(t.entry_time).getUTCHours() === +h)
    const hWins = hTrades.filter(t => t.pnl > 0).length
    v.win_rate = hTrades.length > 0 ? (hWins / hTrades.length) * 100 : 0
  }
  for (const [d, v] of Object.entries(byDay)) {
    const dTrades = trades.filter(t => t.entry_time && new Date(t.entry_time).getUTCDay() === +d)
    const dWins = dTrades.filter(t => t.pnl > 0).length
    v.win_rate = dTrades.length > 0 ? (dWins / dTrades.length) * 100 : 0
  }

  // Drawdown
  const { data: snapshots } = await db.from('performance_snapshots').select('max_drawdown_pct, current_drawdown_pct')
    .order('date', { ascending: false }).limit(1).single()

  const mfePcts = analytics?.map(a => +(a.mfe_pct ?? 0)).filter(v => v > 0) ?? []
  const maePcts = analytics?.map(a => +(a.mae_pct ?? 0)).filter(v => v > 0) ?? []
  const exitEffs = analytics?.map(a => +(a.exit_efficiency_pct ?? 0)).filter(v => !isNaN(v)) ?? []

  const avg = (a: number[]) => a.length > 0 ? a.reduce((s, v) => s + v, 0) / a.length : 0

  const wr = wins.length / (trades.length || 1)
  const kelly = avgLoss > 0 ? Math.max(0, Math.min(wr - (1 - wr) / (avgWin / avgLoss || 1), 0.25)) : 0

  // Identify weaknesses and strengths
  const weaknesses: string[] = []
  const strengths: string[] = []

  if (avg(exitEffs) < 50 && exitEffs.length > 5) weaknesses.push(`Low exit efficiency (${avg(exitEffs).toFixed(0)}%) - cutting winners too short`)
  if (avg(maePcts) > 3 && maePcts.length > 5) weaknesses.push(`High avg MAE (${avg(maePcts).toFixed(1)}%) - entries could be tighter`)
  if (streak >= 3 && streakType === 'loss') weaknesses.push(`On a ${streak}-trade loss streak - consider reducing size`)
  for (const [inst, data] of Object.entries(byInst)) {
    if (data.win_rate < 35 && data.trades >= 5) weaknesses.push(`${inst}: only ${data.win_rate.toFixed(0)}% WR over ${data.trades} trades`)
  }
  for (const [h, data] of Object.entries(byHour)) {
    if (data.win_rate < 30 && data.trades >= 3) weaknesses.push(`Hour ${h} UTC: ${data.win_rate.toFixed(0)}% WR (${data.trades} trades) - weak trading hour`)
  }

  if (winRate > 55) strengths.push(`Strong overall win rate: ${winRate.toFixed(0)}%`)
  if (profitFactor > 1.5) strengths.push(`Solid profit factor: ${profitFactor.toFixed(2)}`)
  if (avg(exitEffs) > 70 && exitEffs.length > 5) strengths.push(`Good exit efficiency: ${avg(exitEffs).toFixed(0)}%`)
  if (avgR > 1.5) strengths.push(`High avg R-value: ${avgR.toFixed(2)}`)
  for (const [inst, data] of Object.entries(byInst)) {
    if (data.win_rate > 65 && data.trades >= 5) strengths.push(`${inst}: ${data.win_rate.toFixed(0)}% WR - strong instrument`)
  }

  return {
    total_trades: trades.length,
    win_rate: winRate,
    profit_factor: profitFactor,
    expectancy,
    avg_r_value: avgR,
    current_streak: streak,
    streak_type: streakType,
    current_drawdown_pct: +(snapshots?.current_drawdown_pct ?? 0),
    max_drawdown_pct: +(snapshots?.max_drawdown_pct ?? 0),
    avg_exit_efficiency_pct: avg(exitEffs),
    avg_mfe_pct: avg(mfePcts),
    avg_mae_pct: avg(maePcts),
    kelly_fraction: kelly,
    by_instrument: byInst,
    by_hour: byHour,
    by_day: byDay,
    weaknesses,
    strengths,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FORMAT PERFORMANCE CONTEXT AS PROMPT TEXT for AI agents
// ═══════════════════════════════════════════════════════════════════════════

export function formatPerformanceForPrompt(ctx: PerformanceContext, instrument?: string): string {
  const lines: string[] = []
  lines.push(`=== YOUR TRADING PERFORMANCE (last ${ctx.total_trades} trades) ===`)
  lines.push(`Win Rate: ${ctx.win_rate.toFixed(1)}% | Profit Factor: ${ctx.profit_factor.toFixed(2)} | Expectancy: ${ctx.expectancy.toFixed(2)}`)
  lines.push(`Avg R-value: ${ctx.avg_r_value.toFixed(2)} | Kelly: ${(ctx.kelly_fraction * 100).toFixed(1)}%`)
  lines.push(`Exit Efficiency: ${ctx.avg_exit_efficiency_pct.toFixed(0)}% | Avg MFE: ${ctx.avg_mfe_pct.toFixed(1)}% | Avg MAE: ${ctx.avg_mae_pct.toFixed(1)}%`)

  if (ctx.current_streak > 0) {
    lines.push(`Current streak: ${ctx.current_streak} ${ctx.streak_type}s in a row`)
  }
  if (ctx.current_drawdown_pct > 2) {
    lines.push(`WARNING: In ${ctx.current_drawdown_pct.toFixed(1)}% drawdown`)
  }

  if (instrument && ctx.by_instrument[instrument]) {
    const d = ctx.by_instrument[instrument]
    lines.push(`--- ${instrument} specifically: ${d.trades} trades, ${d.win_rate.toFixed(0)}% WR, avg R: ${d.avg_r.toFixed(2)}`)
  }

  if (ctx.weaknesses.length > 0) {
    lines.push(`WEAKNESSES: ${ctx.weaknesses.slice(0, 3).join(' | ')}`)
  }
  if (ctx.strengths.length > 0) {
    lines.push(`STRENGTHS: ${ctx.strengths.slice(0, 3).join(' | ')}`)
  }

  return lines.join('\n')
}
