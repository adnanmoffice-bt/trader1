'use client'
import { useEffect, useState, useMemo } from 'react'

function cn(...c: (string | false | undefined | null)[]) { return c.filter(Boolean).join(' ') }
function fmt(n: number) { return n >= 1000 ? '$' + n.toLocaleString('en', { maximumFractionDigits: 0 }) : '$' + n.toFixed(2) }

type TradeFilter = { instrument: string; direction: string; result: string }

export default function SimulationPage() {
  const [demo, setDemo] = useState<{ session: any; trades: any[] }>({ session: null, trades: [] })
  const [filter, setFilter] = useState<TradeFilter>({ instrument: 'all', direction: 'all', result: 'all' })
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null)

  useEffect(() => {
    const load = () => fetch('/api/demo').then(r => r.json()).then(d => { if (d.success) setDemo({ session: d.data, trades: d.trades ?? [] }) }).catch(() => {})
    load()
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [])

  const s = demo.session
  const openT = demo.trades.filter((t: any) => !t.exit_time)
  const closedT = demo.trades.filter((t: any) => t.exit_time).sort((a: any, b: any) => new Date(b.exit_time).getTime() - new Date(a.exit_time).getTime())

  const cap = +(s?.initial_capital || 5000)
  const wins = closedT.filter((t: any) => +(t.pnl ?? 0) > 0)
  const losses = closedT.filter((t: any) => +(t.pnl ?? 0) <= 0)
  const totalPnl = closedT.reduce((s: number, t: any) => s + +(t.pnl ?? 0), 0)
  const totalPnlAed = closedT.reduce((s: number, t: any) => s + +(t.pnl_aed ?? 0), 0)
  const wr = closedT.length > 0 ? (wins.length / closedT.length * 100) : 0
  const avgWin = wins.length > 0 ? wins.reduce((s: number, t: any) => s + +(t.pnl ?? 0), 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? losses.reduce((s: number, t: any) => s + Math.abs(+(t.pnl ?? 0)), 0) / losses.length : 0
  const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : 0
  const bestTrade = closedT.reduce((best: any, t: any) => +(t.pnl ?? 0) > +(best?.pnl ?? -Infinity) ? t : best, closedT[0])
  const worstTrade = closedT.reduce((worst: any, t: any) => +(t.pnl ?? 0) < +(worst?.pnl ?? Infinity) ? t : worst, closedT[0])

  const instrumentStats = useMemo(() => {
    const stats: Record<string, { wins: number; losses: number; pnl: number; trades: number }> = {}
    closedT.forEach((t: any) => {
      const inst = t.instrument
      if (!stats[inst]) stats[inst] = { wins: 0, losses: 0, pnl: 0, trades: 0 }
      stats[inst].trades++
      stats[inst].pnl += +(t.pnl ?? 0)
      if (+(t.pnl ?? 0) > 0) stats[inst].wins++
      else stats[inst].losses++
    })
    return Object.entries(stats).sort((a, b) => b[1].pnl - a[1].pnl)
  }, [closedT])

  const filtered = useMemo(() => {
    return closedT.filter((t: any) => {
      if (filter.instrument !== 'all' && t.instrument !== filter.instrument) return false
      if (filter.direction !== 'all' && t.direction !== filter.direction) return false
      if (filter.result === 'win' && +(t.pnl ?? 0) <= 0) return false
      if (filter.result === 'loss' && +(t.pnl ?? 0) > 0) return false
      return true
    })
  }, [closedT, filter])

  const equityPoints = useMemo(() => {
    const pts = [cap]
    closedT.slice().reverse().forEach((t: any) => pts.push(pts[pts.length - 1] + +(t.pnl ?? 0)))
    return pts
  }, [closedT, cap])

  const streaks = useMemo(() => {
    const res: ('W' | 'L')[] = []
    closedT.slice().reverse().forEach((t: any) => res.push(+(t.pnl ?? 0) > 0 ? 'W' : 'L'))
    return res.slice(-30)
  }, [closedT])

  const instruments = ['all', ...new Set(closedT.map((t: any) => t.instrument))]

  if (!s) return <div className="p-4 lg:p-6 max-w-7xl mx-auto"><div className="text-center py-16 text-[var(--text-muted)]">No active simulation session</div></div>

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-black text-[var(--text-primary)]">Simulation Dashboard</h1>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Paper trading — {closedT.length} trades analyzed</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('text-[10px] font-black px-2 py-1 rounded', totalPnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')} style={{ background: totalPnl >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)' }}>
            {totalPnl >= 0 ? '▲' : '▼'} {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(0)} USD
          </span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-11 gap-2 mb-5">
        {[
          { l: 'CAPITAL', v: fmt(cap), c: '' },
          { l: 'CURRENT', v: fmt(cap + totalPnl), c: totalPnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]' },
          { l: 'P&L USD', v: `${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(0)}`, c: totalPnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]' },
          { l: 'P&L %', v: `${(totalPnl / cap * 100).toFixed(1)}%`, c: totalPnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]' },
          { l: 'WIN RATE', v: `${wr.toFixed(0)}%`, c: wr >= 50 ? 'text-[var(--green)]' : 'text-[var(--red)]' },
          { l: 'WINS', v: `${wins.length}`, c: 'text-[var(--green)]' },
          { l: 'LOSSES', v: `${losses.length}`, c: 'text-[var(--red)]' },
          { l: 'AVG WIN', v: `+${avgWin.toFixed(0)}`, c: 'text-[var(--green)]' },
          { l: 'AVG LOSS', v: `-${avgLoss.toFixed(0)}`, c: 'text-[var(--red)]' },
          { l: 'PROFIT F.', v: profitFactor.toFixed(2), c: profitFactor >= 1 ? 'text-[var(--green)]' : 'text-[var(--red)]' },
          { l: 'TRADES', v: `${closedT.length}`, c: '' },
        ].map(x => (
          <div key={x.l} className="metric-card rounded-lg border p-2.5" style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}>
            <div className="text-[7px] text-[var(--text-muted)] tracking-widest font-bold mb-1">{x.l}</div>
            <div className={cn('text-sm font-black tabular-nums', x.c || 'text-[var(--text-primary)]')}>{x.v}</div>
          </div>
        ))}
      </div>

      {/* Equity Curve + Streak + Instrument Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-5">
        <div className="lg:col-span-2 rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}>
          <div className="text-[9px] font-bold text-[var(--text-muted)] tracking-widest mb-3">EQUITY CURVE</div>
          <svg viewBox="0 0 700 160" className="w-full h-40">
            {(() => {
              if (equityPoints.length < 2) return null
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

        <div className="flex flex-col gap-3">
          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}>
            <div className="text-[9px] font-bold text-[var(--text-muted)] tracking-widest mb-2">LAST 30 TRADES</div>
            <div className="flex flex-wrap gap-1">
              {streaks.map((s, i) => (
                <div key={i} style={{ width: 14, height: 14, borderRadius: 2, background: s === 'W' ? 'var(--green)' : 'var(--red)', opacity: 0.8 }} title={s === 'W' ? 'Win' : 'Loss'} />
              ))}
            </div>
          </div>

          <div className="rounded-lg border p-3 flex-1" style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}>
            <div className="text-[9px] font-bold text-[var(--text-muted)] tracking-widest mb-2">BY INSTRUMENT</div>
            <div className="space-y-1.5">
              {instrumentStats.map(([inst, st]) => {
                const iwr = st.trades > 0 ? (st.wins / st.trades * 100) : 0
                return (
                  <div key={inst} className="flex items-center gap-2 text-[10px]">
                    <span className="font-bold text-[var(--text-primary)] w-16">{inst.replace('/USD', '')}</span>
                    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-3)' }}>
                      <div className="h-full rounded-full" style={{ width: `${iwr}%`, background: iwr >= 50 ? 'var(--green)' : 'var(--red)' }} />
                    </div>
                    <span className="tabular-nums w-8 text-right" style={{ color: iwr >= 50 ? 'var(--green)' : 'var(--red)' }}>{iwr.toFixed(0)}%</span>
                    <span className={cn('tabular-nums w-14 text-right font-bold', st.pnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{st.pnl >= 0 ? '+' : ''}{st.pnl.toFixed(0)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Open Positions */}
      {openT.length > 0 && (
        <>
          <div className="text-[10px] font-bold text-[var(--amber)] tracking-widest mb-2">⬡ OPEN POSITIONS ({openT.length})</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-5">
            {openT.map((t: any, i: number) => {
              const dir = String(t.direction), entry = +t.entry_price, cur = +(t.current_price || entry)
              const lp = +(t.live_pnl_aed || 0), lpct = +(t.live_pnl_pct || 0), up = lp >= 0
              return (
                <div key={i} className={cn('rounded-lg border p-3', dir === 'long' ? 'border-l-4 border-l-[var(--green)]' : 'border-l-4 border-l-[var(--red)]')} style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[var(--text-primary)]">{t.instrument}</span>
                      <span className={cn('text-[8px] font-black px-1.5 py-0.5 rounded', dir === 'long' ? 'text-[var(--green)]' : 'text-[var(--red)]')} style={{ background: dir === 'long' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)' }}>{dir.toUpperCase()}</span>
                    </div>
                    <span className={cn('font-black tabular-nums', up ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{up ? '+' : ''}{lp.toFixed(0)} AED</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[9px] text-[var(--text-muted)]">
                    <span>Entry: <b className="text-[var(--text-primary)]">{fmt(entry)}</b></span>
                    <span>Now: <b className="text-[var(--text-primary)]">{fmt(cur)}</b></span>
                    <span>SL: <b className="text-[var(--red)]">{fmt(+t.stop_loss)}</b></span>
                    <span>TP: <b className="text-[var(--green)]">{fmt(+t.take_profit)}</b></span>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Trade Filters */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-[10px] font-bold text-[var(--text-muted)] tracking-widest">TRADES ({filtered.length})</span>
        <div className="flex items-center gap-1">
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
      </div>

      {/* Trade Cards */}
      <div className="space-y-2">
        {filtered.map((t: any) => {
          const p = +(t.pnl ?? 0), pa = +(t.pnl_aed ?? 0), pp = +(t.pnl_pct ?? 0), w = p > 0
          const entry = +t.entry_price, exit = +t.exit_price, sl = +t.stop_loss, tp = +t.take_profit
          const slDist = Math.abs(entry - sl), tpDist = Math.abs(tp - entry)
          const plannedRR = slDist > 0 ? (tpDist / slDist).toFixed(2) : '—'
          const exitDist = Math.abs(exit - entry)
          const achievedRR = slDist > 0 ? ((w ? 1 : -1) * exitDist / slDist).toFixed(2) : '—'
          const entryTime = t.entry_time ? new Date(t.entry_time) : null
          const exitTime = t.exit_time ? new Date(t.exit_time) : null
          const holdMins = entryTime && exitTime ? Math.floor((exitTime.getTime() - entryTime.getTime()) / 60000) : 0
          const holdStr = holdMins >= 60 ? `${Math.floor(holdMins / 60)}h ${holdMins % 60}m` : `${holdMins}m`

          const range = slDist + tpDist
          const exitProgress = range > 0 ? ((t.direction === 'long' ? exit - sl : sl - exit) / range) * 100 : 50
          const expanded = expandedTrade === t.id

          return (
            <div key={t.id} onClick={() => setExpandedTrade(expanded ? null : t.id)}
              className="rounded-lg border cursor-pointer transition-all"
              style={{
                borderColor: 'var(--border)',
                borderLeftColor: w ? 'var(--green)' : 'var(--red)',
                borderLeftWidth: 3,
                background: 'var(--bg-panel)',
              }}>
              {/* Main Row */}
              <div className="flex items-center gap-3 px-3 py-2.5">
                <div className="flex items-center gap-2 w-24">
                  <span className="font-bold text-[11px] text-[var(--text-primary)]">{t.instrument.replace('/USD', '')}</span>
                  <span className="text-[8px] font-black px-1 py-0.5 rounded"
                    style={{ color: t.direction === 'long' ? 'var(--green)' : 'var(--red)', background: t.direction === 'long' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)' }}>
                    {t.direction.toUpperCase()}
                  </span>
                </div>

                <div className="flex items-center gap-1 text-[10px] tabular-nums w-32">
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

                <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded', w ? 'text-[var(--green)]' : 'text-[var(--red)]')}
                  style={{ background: w ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)' }}>
                  {t.exit_reason === 'take_profit' ? 'TARGET' : 'STOP'}
                </span>

                <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-12 text-right">{holdStr}</span>

                <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-16 text-right">
                  {entryTime ? entryTime.toLocaleDateString('en', { month: 'short', day: 'numeric' }) : '—'}
                </span>
              </div>

              {/* Expanded Detail */}
              {expanded && (
                <div className="px-3 pb-3 pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-[10px]">
                    <div><span className="text-[var(--text-muted)]">P&L AED</span><br/><span className={cn('font-bold', w ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{pa >= 0 ? '+' : ''}{pa.toFixed(0)} AED</span></div>
                    <div><span className="text-[var(--text-muted)]">SL Distance</span><br/><span className="font-bold text-[var(--red)]">{(slDist / entry * 100).toFixed(2)}%</span></div>
                    <div><span className="text-[var(--text-muted)]">TP Distance</span><br/><span className="font-bold text-[var(--green)]">{(tpDist / entry * 100).toFixed(2)}%</span></div>
                    <div><span className="text-[var(--text-muted)]">Planned R:R</span><br/><span className="font-bold text-[var(--blue)]">{plannedRR}x</span></div>
                    <div><span className="text-[var(--text-muted)]">Achieved R:R</span><br/><span className={cn('font-bold', w ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{achievedRR}x</span></div>
                    <div><span className="text-[var(--text-muted)]">Hold Time</span><br/><span className="font-bold text-[var(--text-primary)]">{holdStr}</span></div>
                  </div>
                  {t.signal_reason && (
                    <div className="mt-2 text-[9px] text-[var(--text-muted)] rounded p-2" style={{ background: 'var(--bg-secondary)' }}>
                      <span className="font-bold text-[var(--purple)]">STRATEGY:</span> {t.signal_reason}
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
    </div>
  )
}
