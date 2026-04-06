import { createServiceSupabase } from '@/lib/supabase'

const USD_AED = 3.6725
const MIN_PAYOUT_AED = 100
const MIN_PORTFOLIO_GROWTH = 0.20  // 20% growth before any payout
const MIN_TRADES_FOR_PAYOUT = 30

export interface AllocationResult {
  totalProfit: number
  reinvestPct: number
  payoutPct: number
  reservePct: number
  reinvestAmt: number
  payoutAmt: number
  reserveAmt: number
  payoutReady: boolean
  reason: string
}

export async function calculateAllocation(): Promise<AllocationResult> {
  const db = createServiceSupabase()

  // Get demo session (or real portfolio when live)
  const { data: session } = await db
    .from('demo_sessions')
    .select('*')
    .eq('status', 'running')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const initialCapital = Number(session?.initial_capital ?? 5000)
  const totalPnl = Number(session?.total_pnl ?? 0)
  const wins = Number(session?.win_count ?? 0)
  const losses = Number(session?.loss_count ?? 0)
  const totalTrades = wins + losses
  const winRate = totalTrades > 0 ? wins / totalTrades : 0
  const maxDD = Number(session?.max_drawdown ?? 0)
  const currentCapital = initialCapital + totalPnl

  // No profit = nothing to allocate
  if (totalPnl <= 0) {
    return {
      totalProfit: totalPnl, reinvestPct: 100, payoutPct: 0, reservePct: 0,
      reinvestAmt: 0, payoutAmt: 0, reserveAmt: 0, payoutReady: false,
      reason: 'No profit to allocate',
    }
  }

  // Check if portfolio has grown enough
  const growthPct = totalPnl / initialCapital
  if (growthPct < MIN_PORTFOLIO_GROWTH) {
    return {
      totalProfit: totalPnl, reinvestPct: 70, payoutPct: 0, reservePct: 30,
      reinvestAmt: totalPnl * 0.7, payoutAmt: 0, reserveAmt: totalPnl * 0.3,
      payoutReady: false,
      reason: `Portfolio growth ${(growthPct * 100).toFixed(1)}% < ${MIN_PORTFOLIO_GROWTH * 100}% minimum. All profit stays in system.`,
    }
  }

  // Check track record
  if (totalTrades < MIN_TRADES_FOR_PAYOUT) {
    return {
      totalProfit: totalPnl, reinvestPct: 60, payoutPct: 0, reservePct: 40,
      reinvestAmt: totalPnl * 0.6, payoutAmt: 0, reserveAmt: totalPnl * 0.4,
      payoutReady: false,
      reason: `Only ${totalTrades} trades (need ${MIN_TRADES_FOR_PAYOUT}). Building track record.`,
    }
  }

  // Dynamic allocation based on performance
  let reinvest: number, payout: number, reserve: number

  // Check recent streak
  const { data: recentTrades } = await db
    .from('demo_trades')
    .select('pnl')
    .eq('session_id', session?.id ?? '')
    .not('exit_time', 'is', null)
    .order('exit_time', { ascending: false })
    .limit(5)

  const recentWins = (recentTrades ?? []).filter(t => Number(t.pnl) > 0).length
  const onStreak = recentWins >= 4

  // Sharpe-like metric (simplified)
  const avgReturn = totalPnl / totalTrades
  const performanceScore = winRate * 100 + (avgReturn > 0 ? 20 : -20) - maxDD * 100

  if (onStreak && performanceScore > 70) {
    // Hot streak + strong performance → bigger payout
    reinvest = 40; payout = 40; reserve = 20
  } else if (maxDD > 0.10) {
    // Recent drawdown → protect capital
    reinvest = 70; payout = 10; reserve = 20
  } else if (performanceScore > 50) {
    // Steady performance → balanced
    reinvest = 50; payout = 30; reserve = 20
  } else {
    // Weak performance → conservative
    reinvest = 60; payout = 15; reserve = 25
  }

  // Check reserve health
  const reserveBalance = totalPnl * (reserve / 100)
  const reserveTarget = currentCapital * 0.15  // Reserve should be 15% of capital
  if (reserveBalance < reserveTarget) {
    const deficit = reserveTarget - reserveBalance
    const shiftFromPayout = Math.min(payout, deficit / totalPnl * 100)
    payout -= shiftFromPayout
    reserve += shiftFromPayout
  }

  const payoutAmt = totalPnl * (payout / 100)
  const payoutReady = payoutAmt >= MIN_PAYOUT_AED

  let reason = ''
  if (onStreak) reason = `Win streak detected (${recentWins}/5). `
  if (maxDD > 0.10) reason += `High drawdown (${(maxDD * 100).toFixed(1)}%). `
  reason += `Performance score: ${performanceScore.toFixed(0)}. `
  reason += payoutReady
    ? `Payout of AED ${payoutAmt.toFixed(0)} ready for withdrawal.`
    : `Payout AED ${payoutAmt.toFixed(0)} below minimum (${MIN_PAYOUT_AED}).`

  return {
    totalProfit: totalPnl,
    reinvestPct: reinvest, payoutPct: payout, reservePct: reserve,
    reinvestAmt: totalPnl * (reinvest / 100),
    payoutAmt,
    reserveAmt: totalPnl * (reserve / 100),
    payoutReady,
    reason,
  }
}

export async function logAllocation(alloc: AllocationResult): Promise<void> {
  const db = createServiceSupabase()
  await db.from('agent_logs').insert({
    agent: 'profit-engine',
    level: alloc.payoutReady ? 'ok' : 'info',
    message: `PROFIT ALLOCATION: Total ${alloc.totalProfit.toFixed(0)} AED → Reinvest ${alloc.reinvestPct}% (${alloc.reinvestAmt.toFixed(0)}) | Payout ${alloc.payoutPct}% (${alloc.payoutAmt.toFixed(0)}) | Reserve ${alloc.reservePct}% (${alloc.reserveAmt.toFixed(0)}) | ${alloc.reason}`,
    metadata: alloc as unknown as Record<string, unknown>,
  })
}
