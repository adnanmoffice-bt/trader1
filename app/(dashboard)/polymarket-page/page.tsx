'use client'
import { useEffect, useState } from 'react'

function cn(...c: (string | false | undefined | null)[]) { return c.filter(Boolean).join(' ') }

export default function PolymarketPage() {
  const [bets, setBets] = useState<any[]>([])
  const [markets, setMarkets] = useState<any[]>([])
  const [logs, setLogs] = useState<any[]>([])

  useEffect(() => {
    fetch('/api/polymarket/bets').then(r => r.json()).then(d => { if (d.data) setBets(d.data) }).catch(() => {})
    fetch('/api/polymarket/markets').then(r => r.json()).then(d => { if (d.data) setMarkets(d.data) }).catch(() => {})
    fetch('/api/agent-logs').then(r => r.json()).then(d => {
      if (d.data) setLogs(d.data.filter((l: any) => l.agent === 'polymarket-scanner'))
    }).catch(() => {})
  }, [])

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-black text-[var(--text-primary)] mb-5">Polymarket — Prediction Markets</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Bets + Markets */}
        <div className="space-y-5">
          {/* Active bets */}
          <div>
            <h2 className="text-[11px] font-bold text-[var(--text-muted)] tracking-widest uppercase mb-3">Active Bets ({bets.length})</h2>
            {bets.length === 0 ? (
              <div className="rounded-xl border border-[var(--border)] p-6 text-center text-[var(--text-muted)] text-sm" style={{ background: 'var(--bg-panel)' }}>
                No active bets. AI scans every 30 min and bets when it finds &gt;3% edge with &gt;50% confidence.
              </div>
            ) : (
              <div className="space-y-2">
                {bets.map((b: any, i: number) => {
                  const side = String(b.side), entry = +(b.entry_price || 0)
                  return (
                    <div key={i} className={cn('rounded-xl border overflow-hidden', side === 'YES' ? 'border-l-4 border-l-[var(--green)]' : 'border-l-4 border-l-[var(--red)]')} style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
                      <div className="p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className={cn('text-[10px] font-black px-2 py-0.5 rounded', side === 'YES' ? 'bg-green-50 text-[var(--green)]' : 'bg-red-50 text-[var(--red)]')}>{side}</span>
                          <span className="text-[10px] font-bold text-[var(--blue)]">${(+(b.amount_usd || 0)).toFixed(2)}</span>
                        </div>
                        <div className="text-[12px] font-semibold text-[var(--text-primary)] mb-1">{String(b.question)}</div>
                        <div className="grid grid-cols-3 gap-2 text-[10px]">
                          <div><span className="text-[var(--text-muted)]">Entry:</span> <span className="mono">{(entry * 100).toFixed(0)}%</span></div>
                          <div><span className="text-[var(--text-muted)]">AI Prob:</span> <span className="mono text-[var(--purple)]">{((+(b.ai_probability || 0)) * 100).toFixed(0)}%</span></div>
                          <div><span className="text-[var(--text-muted)]">Edge:</span> <span className="mono font-bold text-[var(--green)]">{((+(b.edge || 0)) * 100).toFixed(1)}%</span></div>
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)] mt-1">{String(b.reasoning)}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Trending markets */}
          <div>
            <h2 className="text-[11px] font-bold text-[var(--text-muted)] tracking-widest uppercase mb-3">Trending Markets ({markets.length})</h2>
            <div className="rounded-xl border border-[var(--border)] overflow-hidden" style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
              {markets.map((m: any, i: number) => {
                const yp = +(m.yes_price || 0)
                return (
                  <div key={i} className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-light)] hover:bg-[var(--bg-hover)] transition-colors">
                    <div className="flex-1 pr-4">
                      <div className="text-[12px] text-[var(--text-primary)] font-medium">{String(m.question)}</div>
                      <div className="text-[9px] text-[var(--text-muted)] mt-0.5">Vol: ${(+(m.volume || 0)).toLocaleString('en', { maximumFractionDigits: 0 })}</div>
                    </div>
                    <div className="flex gap-3 flex-shrink-0 text-center">
                      <div>
                        <div className="text-[8px] text-[var(--text-muted)]">YES</div>
                        <div className={cn('text-sm font-black mono', yp > 0.6 ? 'text-[var(--green)]' : yp < 0.4 ? 'text-[var(--red)]' : 'text-[var(--amber)]')}>
                          {(yp * 100).toFixed(0)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-[8px] text-[var(--text-muted)]">NO</div>
                        <div className="text-sm font-black mono text-[var(--text-secondary)]">{((1 - yp) * 100).toFixed(0)}%</div>
                      </div>
                    </div>
                  </div>
                )
              })}
              {markets.length === 0 && <div className="p-6 text-center text-[var(--text-muted)] text-sm">Loading markets...</div>}
            </div>
          </div>
        </div>

        {/* Right: AI analysis log */}
        <div>
          <h2 className="text-[11px] font-bold text-[var(--text-muted)] tracking-widest uppercase mb-3">AI Analysis Log ({logs.length})</h2>
          <div className="rounded-xl border border-[var(--border)] overflow-hidden" style={{ background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
            {logs.slice(0, 30).map((log: any, i: number) => {
              const level = String(log.level ?? 'info')
              const dot = level === 'ok' ? 'bg-[var(--green)]' : level === 'warn' ? 'bg-[var(--amber)]' : 'bg-[var(--blue)]'
              const time = log.created_at ? new Date(log.created_at).toLocaleTimeString('en', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' }) : ''
              return (
                <div key={i} className="flex items-start gap-2 px-3 py-2 border-b border-[var(--border-light)] hover:bg-[var(--bg-hover)]">
                  <span className={cn('w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0', dot)} />
                  <span className="text-[9px] mono text-[var(--text-muted)] w-10 flex-shrink-0">{time}</span>
                  <span className="text-[11px] text-[var(--text-secondary)] leading-snug">{String(log.message)}</span>
                </div>
              )
            })}
            {logs.length === 0 && <div className="p-6 text-center text-[var(--text-muted)] text-sm">No Polymarket activity yet</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
