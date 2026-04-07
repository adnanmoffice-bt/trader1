'use client'
import { useEffect, useState } from 'react'

function cn(...c: (string | false | undefined | null)[]) { return c.filter(Boolean).join(' ') }
function fmt(n: number) { return n >= 1000 ? '$' + n.toLocaleString('en', { maximumFractionDigits: 0 }) : '$' + n.toFixed(2) }

export default function SimulationPage() {
  const [demo, setDemo] = useState<{ session: any; trades: any[] }>({ session: null, trades: [] })

  useEffect(() => {
    fetch('/api/demo').then(r => r.json()).then(d => { if (d.success) setDemo({ session: d.data, trades: d.trades ?? [] }) }).catch(() => {})
    const t = setInterval(() => {
      fetch('/api/demo').then(r => r.json()).then(d => { if (d.success) setDemo({ session: d.data, trades: d.trades ?? [] }) }).catch(() => {})
    }, 20000)
    return () => clearInterval(t)
  }, [])

  const s = demo.session
  const openT = demo.trades.filter((t: any) => !t.exit_time)
  const closedT = demo.trades.filter((t: any) => t.exit_time)
  const pnl = +(s?.total_pnl || 0), cap = +(s?.initial_capital || 5000)
  const wins = +(s?.win_count || 0), losses = +(s?.loss_count || 0)
  const wr = wins + losses > 0 ? (wins / (wins + losses) * 100) : 0

  // Simple equity curve data
  const equityPoints: number[] = [cap]
  closedT.forEach((t: any) => {
    const last = equityPoints[equityPoints.length - 1]
    equityPoints.push(last + +(t.pnl_aed || 0))
  })

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-black text-[var(--text-primary)] mb-5">Simulation (Paper Trading)</h1>

      {!s ? (
        <div className="text-center py-16 text-[var(--text-muted)]">No active simulation session</div>
      ) : (
        <>
          {/* Stats cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
            {[
              { l: 'Starting Capital', v: `$${cap.toLocaleString()}` },
              { l: 'Current Value', v: `$${(cap + pnl).toLocaleString()}`, cls: pnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]' },
              { l: 'Total P&L', v: `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(0)}`, cls: pnl >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]' },
              { l: 'Win Rate', v: `${wr.toFixed(0)}%` },
              { l: 'Wins / Losses', v: `${wins} / ${losses}` },
              { l: 'Total Trades', v: `${s.total_trades ?? 0}` },
              { l: 'Max Drawdown', v: s.max_drawdown ? `${(+s.max_drawdown * 100).toFixed(1)}%` : '—' },
            ].map(x => (
              <div key={x.l} className="rounded-xl border border-[var(--border)] p-3" style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
                <div className="text-[9px] text-[var(--text-muted)] tracking-wider mb-1">{x.l}</div>
                <div className={cn('text-base font-black mono', x.cls || 'text-[var(--text-primary)]')}>{x.v}</div>
              </div>
            ))}
          </div>

          {/* Equity curve */}
          {equityPoints.length > 1 && (
            <div className="rounded-xl border border-[var(--border)] p-4 mb-6" style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
              <div className="text-[10px] font-bold text-[var(--text-muted)] tracking-widest uppercase mb-3">Equity Curve</div>
              <svg viewBox={`0 0 600 120`} className="w-full h-32">
                {(() => {
                  const min = Math.min(...equityPoints) * 0.999, max = Math.max(...equityPoints) * 1.001
                  const yS = (v: number) => 110 - ((v - min) / (max - min)) * 100
                  const xS = (i: number) => (i / (equityPoints.length - 1)) * 580 + 10
                  const path = equityPoints.map((v, i) => `${i ? 'L' : 'M'}${xS(i)},${yS(v)}`).join(' ')
                  const lastV = equityPoints[equityPoints.length - 1]
                  const color = lastV >= cap ? 'var(--green)' : 'var(--red)'
                  return (
                    <>
                      <line x1={10} y1={yS(cap)} x2={590} y2={yS(cap)} stroke="var(--border)" strokeWidth={0.5} strokeDasharray="4 2" />
                      <text x={592} y={yS(cap) + 3} fill="var(--text-muted)" fontSize={8}>{cap.toLocaleString()}</text>
                      <path d={path} fill="none" stroke={color} strokeWidth={2} />
                      {equityPoints.map((v, i) => <circle key={i} cx={xS(i)} cy={yS(v)} r={2.5} fill={color} />)}
                    </>
                  )
                })()}
              </svg>
            </div>
          )}

          {/* Open positions */}
          <h2 className="text-[11px] font-bold text-[var(--text-muted)] tracking-widest uppercase mb-3">Open Positions ({openT.length})</h2>
          {openT.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
              {openT.map((t: any, i: number) => {
                const dir = String(t.direction), entry = +t.entry_price, cur = +(t.current_price || entry)
                const lp = +(t.live_pnl_aed || 0), lpct = +(t.live_pnl_pct || 0), up = lp >= 0
                const sl = +t.stop_loss, tp = +t.take_profit
                const slD = cur > 0 ? (Math.abs(cur - sl) / cur * 100) : 0, tpD = cur > 0 ? (Math.abs(tp - cur) / cur * 100) : 0
                const opened = t.entry_time ? new Date(t.entry_time) : null
                const mins = opened ? Math.floor((Date.now() - opened.getTime()) / 60000) : 0
                return (
                  <div key={i} className={cn('rounded-xl border overflow-hidden', dir === 'long' ? 'border-l-4 border-l-[var(--green)]' : 'border-l-4 border-l-[var(--red)]')} style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
                    <div className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[var(--text-primary)]">{t.instrument}</span>
                          <span className={cn('text-[9px] font-black px-1.5 py-0.5 rounded', dir === 'long' ? 'bg-green-50 text-[var(--green)]' : 'bg-red-50 text-[var(--red)]')}>{dir.toUpperCase()}</span>
                        </div>
                        <span className={cn('font-black mono', up ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{up ? '+' : ''}${lp.toFixed(0)} ({up ? '+' : ''}{lpct.toFixed(2)}%)</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[10px]">
                        <div><span className="text-[var(--text-muted)]">Entry:</span> <span className="mono">{fmt(entry)}</span></div>
                        <div><span className="text-[var(--text-muted)]">SL:</span> <span className="mono text-[var(--red)]">{fmt(sl)}</span> <span className="text-[var(--amber)]">({slD.toFixed(1)}%)</span></div>
                        <div><span className="text-[var(--text-muted)]">TP:</span> <span className="mono text-[var(--green)]">{fmt(tp)}</span> <span className="text-[var(--blue)]">({tpD.toFixed(1)}%)</span></div>
                      </div>
                      <div className="text-[9px] text-[var(--text-muted)] mt-1">Open {Math.floor(mins / 60)}h {mins % 60}m | {String(t.signal_reason ?? '')}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : <div className="text-sm text-[var(--text-muted)] mb-6">No open positions</div>}

          {/* Closed trades */}
          <h2 className="text-[11px] font-bold text-[var(--text-muted)] tracking-widest uppercase mb-3">Trade History ({closedT.length})</h2>
          {closedT.length > 0 && (
            <div className="rounded-xl border border-[var(--border)] overflow-hidden" style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
              <table className="w-full text-[11px]">
                <thead><tr className="border-b border-[var(--border)]" style={{ background: 'var(--bg-secondary)' }}>
                  {['Instrument', 'Dir', 'Entry', 'Exit', 'P&L', '%', 'Result', 'Strategy', 'Date'].map(h => (
                    <th key={h} className="text-left text-[9px] text-[var(--text-muted)] tracking-wider font-semibold px-3 py-2">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {closedT.map((t: any, i: number) => {
                    const p = +(t.pnl_aed || 0), w = p > 0
                    return (
                      <tr key={i} className="border-b border-[var(--border-light)] hover:bg-[var(--bg-hover)]">
                        <td className="px-3 py-2 font-bold text-[var(--text-primary)]">{t.instrument}</td>
                        <td className={cn('px-3 py-2 font-bold', t.direction === 'long' ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{String(t.direction).toUpperCase()}</td>
                        <td className="px-3 py-2 mono text-[var(--text-secondary)]">{fmt(+t.entry_price)}</td>
                        <td className="px-3 py-2 mono text-[var(--text-secondary)]">{fmt(+t.exit_price)}</td>
                        <td className={cn('px-3 py-2 mono font-bold', w ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{w ? '+' : ''}{p.toFixed(0)}</td>
                        <td className={cn('px-3 py-2 mono', w ? 'text-[var(--green)]' : 'text-[var(--red)]')}>{(+(t.pnl_pct || 0)).toFixed(2)}%</td>
                        <td className="px-3 py-2"><span className={cn('text-[9px] font-bold px-2 py-0.5 rounded', t.exit_reason === 'take_profit' ? 'bg-green-50 text-[var(--green)]' : 'bg-red-50 text-[var(--red)]')}>{t.exit_reason === 'take_profit' ? 'TARGET' : 'STOP'}</span></td>
                        <td className="px-3 py-2 text-[var(--text-muted)]">{String(t.signal_reason ?? '').slice(0, 20)}</td>
                        <td className="px-3 py-2 mono text-[var(--text-muted)]">{new Date(t.entry_time).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
