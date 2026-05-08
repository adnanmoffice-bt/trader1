'use client'
import { useEffect, useState, useMemo } from 'react'

function cn(...c: (string | false | undefined | null)[]) { return c.filter(Boolean).join(' ') }
function fmt(n: number) { return n >= 1000 ? '$' + n.toLocaleString('en', { maximumFractionDigits: 0 }) : '$' + n.toFixed(2) }

type TradeFilter = { instrument: string; direction: string; result: string; strategy: string; viewMode: 'session' | 'all' }
type ViewTab = 'overview' | 'history' | 'analysis' | 'loss-causes'

function extractStrategy(reason: string): string {
  const r = String(reason ?? '').toUpperCase()
  if (r.includes('BB_SQUEEZE') || r.includes('BB SQUEEZE')) return 'BB_SQUEEZE'
  if (r.includes('EMA_CROSS') || r.includes('EMA 12/26')) return 'EMA_CROSS'
  if (r.includes('EMA 50')) return 'EMA50'
  if (r.includes('MACD')) return 'MACD'
  if (r.includes('RSI')) return 'RSI'
  if (r.includes('TECH_SCORE') || r.includes('TECH SCORE')) return 'TECH_SCORE'
  if (r.includes('VOLUME')) return 'VOLUME'
  if (r.includes('WAR ROOM') || r.includes('CONSENSUS')) return 'WAR_ROOM'
  return 'OTHER'
}

function classifyLoss(t: any): string {
  const holdMins = t.entry_time && t.exit_time ? (new Date(t.exit_time).getTime() - new Date(t.entry_time).getTime()) / 60000 : 0
  if (+(t.pnl ?? 0) > 0) return 'WIN'
  if (t.exit_reason === 'stop_loss' && holdMins < 30) return 'FAST_STOPOUT'
  if (t.exit_reason === 'stop_loss' && holdMins < 120) return 'QUICK_STOPOUT'
  if (t.exit_reason === 'stop_loss') return 'SLOW_STOPOUT'
  if (t.exit_reason === 'timeout') return 'TIMEOUT'
  if (t.exit_reason === 'manual') return 'MANUAL'
  return 'OTHER'
}

export default function SimulationPage() {
  const [demo, setDemo] = useState<{ session: any; trades: any[]; sessions: any[]; archived_count: number }>({ session: null, trades: [], sessions: [], archived_count: 0 })
  const [filter, setFilter] = useState<TradeFilter>({ instrument: 'all', direction: 'all', result: 'all', strategy: 'all', viewMode: 'all' })
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null)
  const [tab, setTab] = useState<ViewTab>('overview')

  useEffect(() => {
    const load = () => fetch(`/api/demo?all=${filter.viewMode === 'all'}`).then(r => r.json()).then(d => { if (d.success) setDemo({ session: d.data, trades: d.trades ?? [], sessions: d.sessions ?? [], archived_count: d.archived_count ?? 0 }) }).catch(() => {})
    load()
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [filter.viewMode])

  const s = demo.session
  const openT = demo.trades.filter((t: any) => !t.exit_time)
  const closedT = demo.trades.filter((t: any) => t.exit_time).sort((a: any, b: any) => new Date(b.exit_time).getTime() - new Date(a.exit_time).getTime())

  const cap = +(s?.initial_capital || 5000)
  const wins = closedT.filter((t: any) => +(t.pnl ?? 0) > 0)
  const losses = closedT.filter((t: any) => +(t.pnl ?? 0) <= 0)
  const totalPnl = closedT.reduce((acc: number, t: any) => acc + +(t.pnl ?? 0), 0)
  const wr = closedT.length > 0 ? (wins.length / closedT.length * 100) : 0
  const avgWin = wins.length > 0 ? wins.reduce((acc: number, t: any) => acc + +(t.pnl ?? 0), 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? losses.reduce((acc: number, t: any) => acc + Math.abs(+(t.pnl ?? 0)), 0) / losses.length : 0
  const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : 0
  const expectancy = closedT.length > 0 ? totalPnl / closedT.length : 0

  // Max drawdown calculation
  const maxDD = useMemo(() => {
    let peak = cap, maxDdAmt = 0, maxDdPct = 0, curr = cap
    closedT.slice().reverse().forEach((t: any) => {
      curr += +(t.pnl ?? 0)
      if (curr > peak) peak = curr
      const dd = peak - curr
      if (dd > maxDdAmt) { maxDdAmt = dd; maxDdPct = peak > 0 ? (dd / peak) * 100 : 0 }
    })
    return { amt: maxDdAmt, pct: maxDdPct }
  }, [closedT, cap])

  // Strategy breakdown
  const strategyStats = useMemo(() => {
    const stats: Record<string, { wins: number; losses: number; pnl: number; trades: number; avgPnl: number }> = {}
    closedT.forEach((t: any) => {
      const key = extractStrategy(t.signal_reason)
      if (!stats[key]) stats[key] = { wins: 0, losses: 0, pnl: 0, trades: 0, avgPnl: 0 }
      stats[key].trades++
      stats[key].pnl += +(t.pnl ?? 0)
      if (+(t.pnl ?? 0) > 0) stats[key].wins++
      else stats[key].losses++
    })
    Object.values(stats).forEach(s => s.avgPnl = s.trades > 0 ? s.pnl / s.trades : 0)
    return Object.entries(stats).sort((a, b) => a[1].pnl - b[1].pnl)
  }, [closedT])

  // Instrument breakdown
  const instrumentStats = useMemo(() => {
    const stats: Record<string, { wins: number; losses: number; pnl: number; trades: number; longWins: number; longTotal: number; shortWins: number; shortTotal: number }> = {}
    closedT.forEach((t: any) => {
      const inst = t.instrument
      if (!stats[inst]) stats[inst] = { wins: 0, losses: 0, pnl: 0, trades: 0, longWins: 0, longTotal: 0, shortWins: 0, shortTotal: 0 }
      stats[inst].trades++
      stats[inst].pnl += +(t.pnl ?? 0)
      const isWin = +(t.pnl ?? 0) > 0
      if (isWin) stats[inst].wins++; else stats[inst].losses++
      if (t.direction === 'long') { stats[inst].longTotal++; if (isWin) stats[inst].longWins++ }
      else { stats[inst].shortTotal++; if (isWin) stats[inst].shortWins++ }
    })
    return Object.entries(stats).sort((a, b) => a[1].pnl - b[1].pnl)
  }, [closedT])

  // Direction breakdown
  const directionStats = useMemo(() => {
    const stats: Record<string, { wins: number; losses: number; pnl: number; trades: number }> = { long: { wins: 0, losses: 0, pnl: 0, trades: 0 }, short: { wins: 0, losses: 0, pnl: 0, trades: 0 } }
    closedT.forEach((t: any) => {
      const d = t.direction
      if (!stats[d]) return
      stats[d].trades++
      stats[d].pnl += +(t.pnl ?? 0)
      if (+(t.pnl ?? 0) > 0) stats[d].wins++; else stats[d].losses++
    })
    return stats
  }, [closedT])

  // Hour of day analysis
  const hourStats = useMemo(() => {
    const stats: Record<number, { wins: number; losses: number; pnl: number }> = {}
    closedT.forEach((t: any) => {
      if (!t.entry_time) return
      const h = new Date(t.entry_time).getUTCHours()
      if (!stats[h]) stats[h] = { wins: 0, losses: 0, pnl: 0 }
      stats[h].pnl += +(t.pnl ?? 0)
      if (+(t.pnl ?? 0) > 0) stats[h].wins++; else stats[h].losses++
    })
    return stats
  }, [closedT])

  // Loss cause breakdown
  const lossCauseStats = useMemo(() => {
    const stats: Record<string, { count: number; pnl: number; avgHold: number; totalHold: number }> = {}
    closedT.forEach((t: any) => {
      const cat = classifyLoss(t)
      if (cat === 'WIN') return
      if (!stats[cat]) stats[cat] = { count: 0, pnl: 0, avgHold: 0, totalHold: 0 }
      stats[cat].count++
      stats[cat].pnl += +(t.pnl ?? 0)
      const holdMins = t.entry_time && t.exit_time ? (new Date(t.exit_time).getTime() - new Date(t.entry_time).getTime()) / 60000 : 0
      stats[cat].totalHold += holdMins
    })
    Object.values(stats).forEach(s => s.avgHold = s.count > 0 ? s.totalHold / s.count : 0)
    return Object.entries(stats).sort((a, b) => a[1].pnl - b[1].pnl)
  }, [closedT])

  // Top wins/losses
  const topWins = useMemo(() => [...wins].sort((a, b) => +(b.pnl) - +(a.pnl)).slice(0, 5), [wins])
  const topLosses = useMemo(() => [...losses].sort((a, b) => +(a.pnl) - +(b.pnl)).slice(0, 5), [losses])

  // Streak history
  const streaks = useMemo(() => {
    const res: ('W' | 'L')[] = []
    closedT.slice().reverse().forEach((t: any) => res.push(+(t.pnl ?? 0) > 0 ? 'W' : 'L'))
    return res.slice(-50)
  }, [closedT])

  // Filtered trades for history view
  const filtered = useMemo(() => {
    return closedT.filter((t: any) => {
      if (filter.instrument !== 'all' && t.instrument !== filter.instrument) return false
      if (filter.direction !== 'all' && t.direction !== filter.direction) return false
      if (filter.result === 'win' && +(t.pnl ?? 0) <= 0) return false
      if (filter.result === 'loss' && +(t.pnl ?? 0) > 0) return false
      if (filter.strategy !== 'all' && extractStrategy(t.signal_reason) !== filter.strategy) return false
      return true
    })
  }, [closedT, filter])

  // Equity curve
  const equityPoints = useMemo(() => {
    const pts = [cap]
    closedT.slice().reverse().forEach((t: any) => pts.push(pts[pts.length - 1] + +(t.pnl ?? 0)))
    return pts
  }, [closedT, cap])

  const instruments = ['all', ...new Set(closedT.map((t: any) => t.instrument))]
  const strategies = ['all', ...new Set(closedT.map((t: any) => extractStrategy(t.signal_reason)))]

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black text-[var(--text-primary)]">Trade Analytics</h1>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
            {filter.viewMode === 'all' ? 'Current rule set (post 2026-04-17)' : 'Current session'} — {closedT.length} closed, {openT.length} open
            {demo.archived_count > 0 && (
              <span className="ml-2 text-[var(--text-muted)] opacity-70">
                · {demo.archived_count} legacy trade{demo.archived_count === 1 ? '' : 's'} archived (SOL/BNB/BB_SQUEEZE era)
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View scope toggle */}
          <div className="flex items-center gap-0 rounded-md overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {(['session', 'all'] as const).map(m => (
              <button key={m} onClick={() => setFilter(f => ({ ...f, viewMode: m }))}
                className="px-2.5 py-1 text-[9px] font-bold transition-colors"
                style={{ background: filter.viewMode === m ? 'var(--amber)' : 'transparent', color: filter.viewMode === m ? '#000' : 'var(--text-muted)' }}>
                {m === 'session' ? 'SESSION' : 'ALL TIME'}
              </button>
            ))}
          </div>
          <span className={cn('text-[10px] font-black px-2 py-1 rounded', totalPnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}
            style={{ background: totalPnl >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)' }}>
            {totalPnl >= 0 ? '▲' : '▼'} {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(0)} USD
          </span>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex items-center gap-0 mb-4" style={{ borderBottom: '1px solid var(--border)' }}>
        {([
          { k: 'overview' as const, l: 'OVERVIEW', i: '◉' },
          { k: 'history' as const, l: 'FULL HISTORY', i: '☰' },
          { k: 'analysis' as const, l: 'ANALYSIS', i: '◪' },
          { k: 'loss-causes' as const, l: 'LOSS CAUSES', i: '⚠' },
        ]).map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold transition-colors"
            style={{
              color: tab === t.k ? 'var(--amber)' : 'var(--text-muted)',
              borderBottom: tab === t.k ? '2px solid var(--amber)' : '2px solid transparent',
              marginBottom: -1,
            }}>
            <span className="text-[8px] opacity-60">{t.i}</span>
            {t.l}
          </button>
        ))}
      </div>

      {/* ══ OVERVIEW TAB ══ */}
      {tab === 'overview' && (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-12 gap-2 mb-5">
            {[
              { l: 'CAPITAL', v: fmt(cap), c: '' },
              { l: 'CURRENT', v: fmt(cap + totalPnl), c: totalPnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]' },
              { l: 'P&L', v: `${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(0)}`, c: totalPnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]' },
              { l: 'P&L %', v: `${(totalPnl / cap * 100).toFixed(1)}%`, c: totalPnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]' },
              { l: 'WIN RATE', v: `${wr.toFixed(0)}%`, c: wr >= 50 ? 'text-[var(--green)]' : 'text-[var(--red)]' },
              { l: 'WINS', v: `${wins.length}`, c: 'text-[var(--green)]' },
              { l: 'LOSSES', v: `${losses.length}`, c: 'text-[var(--red)]' },
              { l: 'AVG WIN', v: `+${avgWin.toFixed(0)}`, c: 'text-[var(--green)]' },
              { l: 'AVG LOSS', v: `-${avgLoss.toFixed(0)}`, c: 'text-[var(--red)]' },
              { l: 'P.FACTOR', v: profitFactor.toFixed(2), c: profitFactor >= 1 ? 'text-[var(--green)]' : 'text-[var(--red)]' },
              { l: 'EXPECT.', v: `${expectancy >= 0 ? '+' : ''}${expectancy.toFixed(1)}`, c: expectancy >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]' },
              { l: 'MAX DD', v: `-${maxDD.pct.toFixed(0)}%`, c: 'text-[var(--red)]' },
            ].map(x => (
              <div key={x.l} className="metric-card rounded-lg border p-2.5" style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}>
                <div className="text-[7px] text-[var(--text-muted)] tracking-widest font-bold mb-1">{x.l}</div>
                <div className={cn('text-sm font-black tabular-nums', x.c || 'text-[var(--text-primary)]')}>{x.v}</div>
              </div>
            ))}
          </div>

          {/* Equity + Streak */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-5">
            <div className="lg:col-span-2 rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-[9px] font-bold text-[var(--text-muted)] tracking-widest">EQUITY CURVE</div>
                <div className="text-[9px] text-[var(--text-muted)]">Peak: {fmt(Math.max(...equityPoints))} | DD: -{maxDD.pct.toFixed(0)}% (${maxDD.amt.toFixed(0)})</div>
              </div>
              <svg viewBox="0 0 700 160" className="w-full h-40">
                {equityPoints.length >= 2 && (() => {
                  const min = Math.min(...equityPoints) * 0.998, max = Math.max(...equityPoints) * 1.002
                  const yS = (v: number) => 145 - ((v - min) / (max - min || 1)) * 130
                  const xS = (i: number) => (i / (equityPoints.length - 1)) * 680 + 10
                  const path = equityPoints.map((v, i) => `${i ? 'L' : 'M'}${xS(i)},${yS(v)}`).join(' ')
                  const lastV = equityPoints[equityPoints.length - 1]
                  const color = lastV >= cap ? 'var(--green)' : 'var(--red)'
                  const fillPath = path + ` L${xS(equityPoints.length - 1)},150 L${xS(0)},150 Z`
                  return (
                    <>
                      <defs>
                        <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={lastV >= cap ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'} />
                          <stop offset="100%" stopColor="transparent" />
                        </linearGradient>
                      </defs>
                      <line x1={10} y1={yS(cap)} x2={690} y2={yS(cap)} stroke="var(--border)" strokeWidth={0.5} strokeDasharray="4 2" />
                      <text x={692} y={yS(cap) + 3} fill="var(--text-muted)" fontSize={7} textAnchor="end">{fmt(cap)}</text>
                      <path d={fillPath} fill="url(#eqGrad)" />
                      <path d={path} fill="none" stroke={color} strokeWidth={1.5} />
                      <circle cx={xS(equityPoints.length - 1)} cy={yS(lastV)} r={3} fill={color} />
                      <text x={xS(equityPoints.length - 1)} y={yS(lastV) - 6} fill={color} fontSize={8} textAnchor="middle" fontWeight="bold">{fmt(lastV)}</text>
                    </>
                  )
                })()}
              </svg>
            </div>

            <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}>
              <div className="text-[9px] font-bold text-[var(--text-muted)] tracking-widest mb-2">LAST 50 TRADES</div>
              <div className="flex flex-wrap gap-0.5">
                {streaks.map((s, i) => (
                  <div key={i} style={{ width: 12, height: 12, borderRadius: 2, background: s === 'W' ? 'var(--green)' : 'var(--red)', opacity: 0.9 }} title={s === 'W' ? 'Win' : 'Loss'} />
                ))}
              </div>
              <div className="mt-3 flex items-center gap-3 text-[9px]">
                <span>Longest W: <b className="text-[var(--green)]">{longestStreak(streaks, 'W')}</b></span>
                <span>Longest L: <b className="text-[var(--red)]">{longestStreak(streaks, 'L')}</b></span>
              </div>
            </div>
          </div>

          {/* Direction comparison */}
          <div className="grid grid-cols-2 gap-3 mb-5">
            {(['long', 'short'] as const).map(d => {
              const st = directionStats[d]
              const wrd = st.trades > 0 ? (st.wins / st.trades * 100) : 0
              return (
                <div key={d} className="rounded-lg border p-4" style={{
                  borderColor: 'var(--border)', background: 'var(--bg-panel)',
                  borderLeft: `3px solid ${d === 'long' ? 'var(--green)' : 'var(--red)'}`
                }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] font-bold tracking-widest" style={{ color: d === 'long' ? 'var(--green)' : 'var(--red)' }}>{d.toUpperCase()} TRADES</div>
                    <div className={cn('text-lg font-black tabular-nums', st.pnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>
                      {st.pnl >= 0 ? '+' : ''}{st.pnl.toFixed(0)}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-[10px]">
                    <div><span className="text-[var(--text-muted)]">Trades</span><br/><span className="font-bold">{st.trades}</span></div>
                    <div><span className="text-[var(--text-muted)]">Wins</span><br/><span className="font-bold text-[var(--green)]">{st.wins}</span></div>
                    <div><span className="text-[var(--text-muted)]">Losses</span><br/><span className="font-bold text-[var(--red)]">{st.losses}</span></div>
                    <div><span className="text-[var(--text-muted)]">Win Rate</span><br/><span className={cn('font-bold', wrd >= 50 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{wrd.toFixed(0)}%</span></div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Top Wins/Losses */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
            <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}>
              <div className="text-[10px] font-bold text-[var(--green)] tracking-widest mb-3">TOP 5 WINS ✓</div>
              {topWins.length === 0 ? <div className="text-[10px] text-[var(--text-muted)]">No wins yet</div> : topWins.map((t: any, i: number) => (
                <div key={i} className="flex items-center justify-between py-1 text-[10px]" style={{ borderBottom: i < topWins.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div className="flex items-center gap-2">
                    <span className="font-bold w-16">{t.instrument}</span>
                    <span className={cn('text-[8px] font-black px-1 rounded', t.direction === 'long' ? 'text-[var(--green)]' : 'text-[var(--red)]')} style={{ background: t.direction === 'long' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)' }}>{t.direction.toUpperCase()}</span>
                    <span className="text-[8px] text-[var(--text-muted)]">{extractStrategy(t.signal_reason)}</span>
                  </div>
                  <span className="font-bold text-[var(--green)] tabular-nums">+{(+t.pnl).toFixed(0)}</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}>
              <div className="text-[10px] font-bold text-[var(--red)] tracking-widest mb-3">TOP 5 LOSSES ✗</div>
              {topLosses.length === 0 ? <div className="text-[10px] text-[var(--text-muted)]">No losses</div> : topLosses.map((t: any, i: number) => (
                <div key={i} className="flex items-center justify-between py-1 text-[10px]" style={{ borderBottom: i < topLosses.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div className="flex items-center gap-2">
                    <span className="font-bold w-16">{t.instrument}</span>
                    <span className={cn('text-[8px] font-black px-1 rounded', t.direction === 'long' ? 'text-[var(--green)]' : 'text-[var(--red)]')} style={{ background: t.direction === 'long' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)' }}>{t.direction.toUpperCase()}</span>
                    <span className="text-[8px] text-[var(--text-muted)]">{extractStrategy(t.signal_reason)}</span>
                  </div>
                  <span className="font-bold text-[var(--red)] tabular-nums">{(+t.pnl).toFixed(0)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ══ ANALYSIS TAB — Strategy, Instrument, Time ══ */}
      {tab === 'analysis' && (
        <>
          {/* Strategy Performance */}
          <div className="rounded-lg border p-4 mb-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}>
            <div className="text-[10px] font-bold text-[var(--text-muted)] tracking-widest mb-3">STRATEGY BREAKDOWN</div>
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-[8px] text-[var(--text-muted)] tracking-widest">
                  <th className="text-left font-bold py-1">STRATEGY</th>
                  <th className="text-right font-bold">TRADES</th>
                  <th className="text-right font-bold">WINS</th>
                  <th className="text-right font-bold">LOSSES</th>
                  <th className="text-right font-bold">WR</th>
                  <th className="text-right font-bold">AVG</th>
                  <th className="text-right font-bold">TOTAL P&L</th>
                  <th className="text-left font-bold pl-4">WR BAR</th>
                </tr>
              </thead>
              <tbody>
                {strategyStats.map(([name, st]) => {
                  const wrs = st.trades > 0 ? (st.wins / st.trades * 100) : 0
                  return (
                    <tr key={name} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="py-2 font-bold text-[var(--text-primary)]">{name}</td>
                      <td className="text-right tabular-nums">{st.trades}</td>
                      <td className="text-right tabular-nums text-[var(--green)]">{st.wins}</td>
                      <td className="text-right tabular-nums text-[var(--red)]">{st.losses}</td>
                      <td className={cn('text-right font-bold tabular-nums', wrs >= 50 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{wrs.toFixed(0)}%</td>
                      <td className={cn('text-right tabular-nums', st.avgPnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{st.avgPnl >= 0 ? '+' : ''}{st.avgPnl.toFixed(0)}</td>
                      <td className={cn('text-right font-black tabular-nums', st.pnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{st.pnl >= 0 ? '+' : ''}{st.pnl.toFixed(0)}</td>
                      <td className="pl-4 py-2">
                        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-3)' }}>
                          <div className="h-full rounded-full" style={{ width: `${wrs}%`, background: wrs >= 50 ? 'var(--green)' : 'var(--red)' }} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Instrument Performance */}
          <div className="rounded-lg border p-4 mb-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}>
            <div className="text-[10px] font-bold text-[var(--text-muted)] tracking-widest mb-3">INSTRUMENT BREAKDOWN (LONG vs SHORT)</div>
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-[8px] text-[var(--text-muted)] tracking-widest">
                  <th className="text-left font-bold py-1">INSTRUMENT</th>
                  <th className="text-right font-bold">TRADES</th>
                  <th className="text-right font-bold">WIN RATE</th>
                  <th className="text-right font-bold">LONG W/L</th>
                  <th className="text-right font-bold">SHORT W/L</th>
                  <th className="text-right font-bold">TOTAL P&L</th>
                </tr>
              </thead>
              <tbody>
                {instrumentStats.map(([name, st]) => {
                  const wrs = st.trades > 0 ? (st.wins / st.trades * 100) : 0
                  const lwr = st.longTotal > 0 ? (st.longWins / st.longTotal * 100) : 0
                  const swr = st.shortTotal > 0 ? (st.shortWins / st.shortTotal * 100) : 0
                  return (
                    <tr key={name} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="py-2 font-bold text-[var(--text-primary)]">{name}</td>
                      <td className="text-right tabular-nums">{st.trades}</td>
                      <td className={cn('text-right font-bold tabular-nums', wrs >= 50 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{wrs.toFixed(0)}%</td>
                      <td className="text-right text-[var(--text-muted)] tabular-nums">
                        {st.longTotal > 0 ? <><span className="text-[var(--green)]">{st.longWins}</span>/<span className="text-[var(--red)]">{st.longTotal - st.longWins}</span> <span className="text-[8px]">({lwr.toFixed(0)}%)</span></> : '—'}
                      </td>
                      <td className="text-right text-[var(--text-muted)] tabular-nums">
                        {st.shortTotal > 0 ? <><span className="text-[var(--green)]">{st.shortWins}</span>/<span className="text-[var(--red)]">{st.shortTotal - st.shortWins}</span> <span className="text-[8px]">({swr.toFixed(0)}%)</span></> : '—'}
                      </td>
                      <td className={cn('text-right font-black tabular-nums', st.pnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{st.pnl >= 0 ? '+' : ''}{st.pnl.toFixed(0)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Hour of day analysis */}
          <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}>
            <div className="text-[10px] font-bold text-[var(--text-muted)] tracking-widest mb-3">HOUR OF DAY (UTC) — P&L HEATMAP</div>
            <div className="grid grid-cols-24 gap-0.5" style={{ gridTemplateColumns: 'repeat(24, 1fr)' }}>
              {Array.from({ length: 24 }, (_, h) => {
                const st = hourStats[h]
                const pnl = st?.pnl ?? 0
                const trades = st ? st.wins + st.losses : 0
                const maxPnl = Math.max(...Object.values(hourStats).map(s => Math.abs(s.pnl)), 1)
                const intensity = Math.min(Math.abs(pnl) / maxPnl, 1)
                const bg = trades === 0 ? 'var(--bg-3)' : pnl >= 0 ? `rgba(34,197,94,${0.2 + intensity * 0.8})` : `rgba(239,68,68,${0.2 + intensity * 0.8})`
                return (
                  <div key={h} className="text-center p-1 rounded" style={{ background: bg }}>
                    <div className="text-[8px] font-bold text-[var(--text-muted)]">{String(h).padStart(2, '0')}</div>
                    <div className="text-[9px] font-black tabular-nums" style={{ color: pnl === 0 ? 'var(--text-muted)' : pnl > 0 ? 'var(--text-0)' : 'var(--text-0)' }}>
                      {pnl === 0 ? '—' : pnl >= 0 ? '+' + pnl.toFixed(0) : pnl.toFixed(0)}
                    </div>
                    <div className="text-[7px] text-[var(--text-muted)]">{trades > 0 ? `${trades}t` : ''}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* ══ LOSS CAUSES TAB ══ */}
      {tab === 'loss-causes' && (
        <>
          <div className="rounded-lg border p-4 mb-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}>
            <div className="text-[10px] font-bold text-[var(--red)] tracking-widest mb-3">WHY DID WE LOSE? — LOSS CAUSE BREAKDOWN</div>
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-[8px] text-[var(--text-muted)] tracking-widest">
                  <th className="text-left font-bold py-1">CATEGORY</th>
                  <th className="text-left font-bold">DESCRIPTION</th>
                  <th className="text-right font-bold">COUNT</th>
                  <th className="text-right font-bold">TOTAL LOSS</th>
                  <th className="text-right font-bold">AVG LOSS</th>
                  <th className="text-right font-bold">AVG HOLD</th>
                  <th className="text-left font-bold pl-4">% OF LOSSES</th>
                </tr>
              </thead>
              <tbody>
                {lossCauseStats.map(([name, st]) => {
                  const pct = losses.length > 0 ? (st.count / losses.length * 100) : 0
                  const labels: Record<string, string> = {
                    FAST_STOPOUT: 'Stopped out in <30min — likely bad entry / noise',
                    QUICK_STOPOUT: 'Stopped in 30min-2h — weak signal',
                    SLOW_STOPOUT: 'Stopped after 2h+ — trend reversal',
                    TIMEOUT: 'Position timed out (48h) — no movement',
                    MANUAL: 'Manually closed',
                    OTHER: 'Other exit reason',
                  }
                  return (
                    <tr key={name} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="py-2 font-bold text-[var(--red)]">{name.replace(/_/g, ' ')}</td>
                      <td className="text-[var(--text-muted)] text-[9px]">{labels[name] ?? name}</td>
                      <td className="text-right tabular-nums font-bold">{st.count}</td>
                      <td className="text-right font-black text-[var(--red)] tabular-nums">{st.pnl.toFixed(0)}</td>
                      <td className="text-right text-[var(--red)] tabular-nums">{(st.pnl / st.count).toFixed(0)}</td>
                      <td className="text-right tabular-nums text-[var(--text-muted)]">
                        {st.avgHold < 60 ? `${st.avgHold.toFixed(0)}m` : `${(st.avgHold / 60).toFixed(1)}h`}
                      </td>
                      <td className="pl-4 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-3)' }}>
                            <div className="h-full rounded-full bg-[var(--red)]" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[9px] font-bold tabular-nums w-8 text-right">{pct.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}>
            <div className="text-[10px] font-bold text-[var(--amber)] tracking-widest mb-3">KEY INSIGHTS</div>
            <div className="space-y-2 text-[11px]">
              {lossCauseStats.filter(([n]) => n === 'FAST_STOPOUT').map(([, st]) => st.count > 5 && (
                <div key="fs" className="flex items-start gap-2 p-2 rounded" style={{ background: 'rgba(239,68,68,0.08)', borderLeft: '3px solid var(--red)' }}>
                  <span className="text-[var(--red)]">⚠</span>
                  <div><b>{st.count} fast stopouts</b> ({(st.pnl).toFixed(0)} lost) — stop loss too tight or bad entries. Consider wider SL.</div>
                </div>
              ))}
              {strategyStats.filter(([, s]) => s.trades >= 5 && s.wins / s.trades < 0.3).map(([n, st]) => (
                <div key={n} className="flex items-start gap-2 p-2 rounded" style={{ background: 'rgba(239,68,68,0.08)', borderLeft: '3px solid var(--red)' }}>
                  <span className="text-[var(--red)]">⚠</span>
                  <div><b>{n}</b> strategy: {(st.wins / st.trades * 100).toFixed(0)}% WR over {st.trades} trades (lost ${(-st.pnl).toFixed(0)}). Consider disabling.</div>
                </div>
              ))}
              {instrumentStats.filter(([, s]) => s.trades >= 5 && s.wins / s.trades < 0.2).map(([n, st]) => (
                <div key={n} className="flex items-start gap-2 p-2 rounded" style={{ background: 'rgba(239,68,68,0.08)', borderLeft: '3px solid var(--red)' }}>
                  <span className="text-[var(--red)]">⚠</span>
                  <div><b>{n}</b>: only {(st.wins / st.trades * 100).toFixed(0)}% WR ({st.trades} trades, lost ${(-st.pnl).toFixed(0)}). Consider blacklisting.</div>
                </div>
              ))}
              {directionStats.short.trades >= 5 && directionStats.short.wins / directionStats.short.trades < 0.2 && (
                <div className="flex items-start gap-2 p-2 rounded" style={{ background: 'rgba(239,68,68,0.08)', borderLeft: '3px solid var(--red)' }}>
                  <span className="text-[var(--red)]">⚠</span>
                  <div><b>SHORT trades</b>: {(directionStats.short.wins / directionStats.short.trades * 100).toFixed(0)}% WR ({directionStats.short.trades} trades). Market is likely trending up — consider LONG-only mode.</div>
                </div>
              )}
              {wr >= 50 && totalPnl > 0 && (
                <div className="flex items-start gap-2 p-2 rounded" style={{ background: 'rgba(34,197,94,0.08)', borderLeft: '3px solid var(--green)' }}>
                  <span className="text-[var(--green)]">✓</span>
                  <div>System is <b>profitable</b> with {wr.toFixed(0)}% win rate. Profit factor: {profitFactor.toFixed(2)}.</div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ══ HISTORY TAB ══ */}
      {tab === 'history' && (
        <>
          {/* Filters */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-[10px] font-bold text-[var(--text-muted)] tracking-widest">{filtered.length} TRADES</span>
            <div className="flex items-center gap-0.5">
              {instruments.map(inst => (
                <button key={inst} onClick={() => setFilter(f => ({ ...f, instrument: inst }))}
                  className="px-2 py-0.5 text-[9px] font-bold rounded transition-colors"
                  style={{ color: filter.instrument === inst ? '#000' : 'var(--text-muted)', background: filter.instrument === inst ? 'var(--amber)' : 'transparent' }}>
                  {inst === 'all' ? 'ALL' : inst.replace('/USD', '')}
                </button>
              ))}
            </div>
            <div className="w-px h-4" style={{ background: 'var(--border)' }} />
            {['all', 'long', 'short'].map(d => (
              <button key={d} onClick={() => setFilter(f => ({ ...f, direction: d }))}
                className="px-2 py-0.5 text-[9px] font-bold rounded transition-colors"
                style={{ color: filter.direction === d ? '#000' : 'var(--text-muted)', background: filter.direction === d ? (d === 'long' ? 'var(--green)' : d === 'short' ? 'var(--red)' : 'var(--amber)') : 'transparent' }}>
                {d.toUpperCase()}
              </button>
            ))}
            <div className="w-px h-4" style={{ background: 'var(--border)' }} />
            {['all', 'win', 'loss'].map(r => (
              <button key={r} onClick={() => setFilter(f => ({ ...f, result: r }))}
                className="px-2 py-0.5 text-[9px] font-bold rounded transition-colors"
                style={{ color: filter.result === r ? '#000' : 'var(--text-muted)', background: filter.result === r ? (r === 'win' ? 'var(--green)' : r === 'loss' ? 'var(--red)' : 'var(--amber)') : 'transparent' }}>
                {r === 'all' ? 'ALL' : r === 'win' ? '✓ WINS' : '✗ LOSSES'}
              </button>
            ))}
            <div className="w-px h-4" style={{ background: 'var(--border)' }} />
            <select value={filter.strategy} onChange={e => setFilter(f => ({ ...f, strategy: e.target.value }))}
              className="px-2 py-0.5 text-[9px] font-bold rounded"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
              {strategies.map(s => <option key={s} value={s}>{s === 'all' ? 'ALL STRATEGIES' : s}</option>)}
            </select>
          </div>

          {/* Trade Cards */}
          <div className="space-y-2">
            {filtered.map((t: any) => {
              const p = +(t.pnl ?? 0), pp = +(t.pnl_pct ?? 0), w = p > 0
              const entry = +t.entry_price, exit = +t.exit_price, sl = +t.stop_loss, tp = +t.take_profit
              const slDist = Math.abs(entry - sl), tpDist = Math.abs(tp - entry)
              const plannedRR = slDist > 0 ? (tpDist / slDist).toFixed(2) : '—'
              const exitDist = Math.abs(exit - entry)
              const achievedRR = slDist > 0 ? ((w ? 1 : -1) * exitDist / slDist).toFixed(2) : '—'
              const entryTime = t.entry_time ? new Date(t.entry_time) : null
              const exitTime = t.exit_time ? new Date(t.exit_time) : null
              const holdMins = entryTime && exitTime ? Math.floor((exitTime.getTime() - entryTime.getTime()) / 60000) : 0
              const holdStr = holdMins >= 60 ? `${Math.floor(holdMins / 60)}h ${holdMins % 60}m` : `${holdMins}m`
              const strat = extractStrategy(t.signal_reason)
              const lossClass = classifyLoss(t)
              const range = slDist + tpDist
              const exitProgress = range > 0 ? ((t.direction === 'long' ? exit - sl : sl - exit) / range) * 100 : 50
              const expanded = expandedTrade === t.id

              return (
                <div key={t.id} onClick={() => setExpandedTrade(expanded ? null : t.id)}
                  className="rounded-lg border cursor-pointer transition-all hover:shadow-md"
                  style={{
                    borderColor: 'var(--border)', borderLeftColor: w ? 'var(--green)' : 'var(--red)',
                    borderLeftWidth: 3, background: 'var(--bg-panel)',
                  }}>
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <div className="flex items-center gap-2 w-24">
                      <span className="font-bold text-[11px] text-[var(--text-primary)]">{t.instrument.replace('/USD', '')}</span>
                      <span className="text-[8px] font-black px-1 py-0.5 rounded"
                        style={{ color: t.direction === 'long' ? 'var(--green)' : 'var(--red)', background: t.direction === 'long' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)' }}>
                        {t.direction.toUpperCase()}
                      </span>
                    </div>
                    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-secondary)', color: 'var(--purple)' }}>{strat}</span>
                    <div className="flex items-center gap-1 text-[10px] tabular-nums w-28">
                      <span className="text-[var(--text-secondary)]">{fmt(entry)}</span>
                      <span className="text-[var(--text-muted)]">→</span>
                      <span className="text-[var(--text-secondary)]">{fmt(exit)}</span>
                    </div>
                    <div className={cn('text-[11px] font-black tabular-nums w-16 text-right', w ? 'text-[var(--green)]' : 'text-[var(--red)]')}>
                      {w ? '+' : ''}{p.toFixed(0)}
                    </div>
                    <div className={cn('text-[10px] tabular-nums w-14 text-right', w ? 'text-[var(--green)]' : 'text-[var(--red)]')}>
                      {pp.toFixed(2)}%
                    </div>
                    <div className="flex-1 h-1.5 rounded-full mx-2" style={{ background: 'var(--bg-3)' }}>
                      <div className="h-full rounded-full transition-all" style={{
                        width: `${Math.max(2, Math.min(100, exitProgress))}%`,
                        background: w ? 'var(--green)' : 'var(--red)',
                      }} />
                    </div>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                      style={{
                        color: w ? 'var(--green)' : lossClass === 'FAST_STOPOUT' ? 'var(--red)' : 'var(--amber)',
                        background: w ? 'rgba(34,197,94,0.1)' : lossClass === 'FAST_STOPOUT' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.1)',
                      }}>
                      {w ? 'WIN' : lossClass.replace('_', ' ')}
                    </span>
                    <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-12 text-right">{holdStr}</span>
                    <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-16 text-right">
                      {entryTime ? entryTime.toLocaleDateString('en', { month: 'short', day: 'numeric' }) : '—'}
                    </span>
                  </div>

                  {expanded && (
                    <div className="px-3 pb-3 pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 text-[10px]">
                        <div><span className="text-[var(--text-muted)]">P&L USD</span><br/><span className={cn('font-bold', w ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{p >= 0 ? '+' : ''}${p.toFixed(2)}</span></div>
                        <div><span className="text-[var(--text-muted)]">SL Dist</span><br/><span className="font-bold text-[var(--red)]">{(slDist / entry * 100).toFixed(2)}%</span></div>
                        <div><span className="text-[var(--text-muted)]">TP Dist</span><br/><span className="font-bold text-[var(--green)]">{(tpDist / entry * 100).toFixed(2)}%</span></div>
                        <div><span className="text-[var(--text-muted)]">Plan R:R</span><br/><span className="font-bold text-[var(--blue)]">{plannedRR}x</span></div>
                        <div><span className="text-[var(--text-muted)]">Actual R:R</span><br/><span className={cn('font-bold', w ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{achievedRR}x</span></div>
                        <div><span className="text-[var(--text-muted)]">Hold Time</span><br/><span className="font-bold">{holdStr}</span></div>
                        <div><span className="text-[var(--text-muted)]">Exit Reason</span><br/><span className="font-bold">{t.exit_reason ?? '—'}</span></div>
                      </div>
                      {t.signal_reason && (
                        <div className="mt-2 text-[9px] text-[var(--text-muted)] rounded p-2" style={{ background: 'var(--bg-secondary)' }}>
                          <span className="font-bold text-[var(--purple)]">SIGNAL:</span> {t.signal_reason}
                        </div>
                      )}
                      <div className="flex gap-4 mt-2 text-[8px] text-[var(--text-muted)]">
                        <span>Entry: {entryTime?.toLocaleString('en', { timeZone: 'Asia/Dubai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        <span>Exit: {exitTime?.toLocaleString('en', { timeZone: 'Asia/Dubai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            {filtered.length === 0 && (
              <div className="text-center py-8 text-[var(--text-muted)] text-sm">No trades match the selected filters</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function longestStreak(arr: ('W' | 'L')[], target: 'W' | 'L'): number {
  let max = 0, curr = 0
  for (const v of arr) {
    if (v === target) { curr++; if (curr > max) max = curr } else curr = 0
  }
  return max
}
