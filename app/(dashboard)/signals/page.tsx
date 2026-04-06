'use client'
import { useEffect, useState } from 'react'

function cn(...c: (string | false | undefined | null)[]) { return c.filter(Boolean).join(' ') }

export default function SignalsPage() {
  const [signals, setSignals] = useState<any[]>([])
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    fetch('/api/signals?limit=50').then(r => r.json()).then(d => { if (d.data) setSignals(d.data) }).catch(() => {})
  }, [])

  const filtered = filter === 'all' ? signals : signals.filter(s => s.instrument === filter)
  const instruments = ['all', ...new Set(signals.map(s => s.instrument))]

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-black text-[var(--text-primary)]">AI Trading Signals</h1>
        <div className="flex items-center gap-1">
          {instruments.map(inst => (
            <button key={inst} onClick={() => setFilter(inst)} className={cn(
              'px-3 py-1.5 text-[11px] font-semibold rounded-md transition-colors',
              filter === inst ? 'bg-[var(--text-primary)] text-[var(--bg-primary)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
            )}>{inst === 'all' ? 'All' : inst}</button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {filtered.map((s: any) => {
          const isL = s.direction === 'long', isS = s.direction === 'short'
          const time = s.created_at ? new Date(s.created_at).toLocaleString('en', { timeZone: 'Asia/Dubai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
          return (
            <div key={s.id} className={cn(
              'rounded-xl border overflow-hidden transition-all hover:shadow-md',
              isL ? 'border-l-4 border-l-[var(--green)]' : isS ? 'border-l-4 border-l-[var(--red)]' : 'border-l-4 border-l-[var(--amber)]'
            )} style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)', boxShadow: 'var(--shadow)' }}>
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className="text-base font-bold text-[var(--text-primary)]">{s.instrument}</span>
                    <span className={cn('text-[10px] font-black px-2 py-0.5 rounded',
                      isL ? 'bg-green-50 text-[var(--green)]' : isS ? 'bg-red-50 text-[var(--red)]' : 'bg-amber-50 text-[var(--amber)]'
                    )}>{s.direction.toUpperCase()}</span>
                    <span className="text-[10px] font-bold text-[var(--blue)]">R:R {s.risk_reward ?? '—'}x</span>
                    <span className="text-[10px] text-[var(--text-muted)]">{time}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded',
                      s.status === 'active' ? 'bg-green-50 text-[var(--green)]' : 'bg-gray-100 text-[var(--text-muted)]'
                    )}>{s.status?.toUpperCase()}</span>
                    <span className="text-lg font-black mono text-[var(--text-primary)]">{s.confidence}%</span>
                  </div>
                </div>

                {s.direction !== 'hold' && (
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    {[
                      { l: 'ENTRY', v: `$${(+s.entry_price).toFixed(2)}`, cls: 'text-[var(--text-primary)]' },
                      { l: 'STOP LOSS', v: `$${(+s.stop_loss).toFixed(2)}`, cls: 'text-[var(--red)]' },
                      { l: 'TARGET', v: `$${(+(s.take_profit_1 ?? 0)).toFixed(2)}`, cls: 'text-[var(--green)]' },
                    ].map(x => (
                      <div key={x.l} className="rounded-lg p-2.5" style={{ background: 'var(--bg-secondary)' }}>
                        <div className="text-[8px] text-[var(--text-muted)] tracking-wider mb-0.5">{x.l}</div>
                        <div className={cn('text-[13px] font-bold mono', x.cls)}>{x.v}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="rounded-lg p-3" style={{ background: 'var(--bg-secondary)' }}>
                  <div className="text-[9px] font-bold text-[var(--purple)] tracking-wider mb-1">AI ANALYSIS</div>
                  <div className="text-[12px] text-[var(--text-secondary)] leading-relaxed">{s.ai_analysis || s.reasoning}</div>
                </div>

                {s.reasoning && s.ai_analysis && (
                  <div className="mt-2 text-[11px] text-[var(--text-muted)]">
                    <span className="font-bold">Strategy: </span>{s.reasoning}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div className="text-center py-16 text-[var(--text-muted)]">No signals yet. The AI scans every 30 minutes.</div>
        )}
      </div>
    </div>
  )
}
