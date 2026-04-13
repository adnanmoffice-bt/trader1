'use client'
import { useEffect, useState } from 'react'

function cn(...c: (string | false | undefined | null)[]) { return c.filter(Boolean).join(' ') }

export default function SignalsPage() {
  const [signals, setSignals] = useState<any[]>([])
  const [filter, setFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({ instrument: 'BTC/USD', direction: 'long', entry_price: '', stop_loss: '', take_profit_1: '', take_profit_2: '', confidence: 80, reasoning: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/signals?limit=50').then(r => r.json()).then(d => { if (d.data) setSignals(d.data) }).catch(() => {})
  }, [])

  async function handleCreateSignal(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          entry_price: parseFloat(formData.entry_price),
          stop_loss: parseFloat(formData.stop_loss),
          take_profit_1: parseFloat(formData.take_profit_1),
          take_profit_2: formData.take_profit_2 ? parseFloat(formData.take_profit_2) : null,
        }),
      })
      const data = await res.json()
      if (data.success && data.data) {
        setSignals(prev => [data.data, ...prev])
        setShowForm(false)
        setFormData({ instrument: 'BTC/USD', direction: 'long', entry_price: '', stop_loss: '', take_profit_1: '', take_profit_2: '', confidence: 80, reasoning: '' })
      }
    } catch {} finally { setSaving(false) }
  }

  const filtered = filter === 'all' ? signals : signals.filter(s => s.instrument === filter)
  const instruments = ['all', ...new Set(signals.map(s => s.instrument))]

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-black text-[var(--text-primary)]">AI Trading Signals</h1>
          <button onClick={() => setShowForm(!showForm)} className="px-3 py-1.5 text-[11px] font-bold rounded-md transition-colors" style={{ background: showForm ? 'var(--red)' : 'var(--green)', color: '#fff' }}>
            {showForm ? '✕ Cancel' : '+ New Signal'}
          </button>
        </div>
        <div className="flex items-center gap-1">
          {instruments.map(inst => (
            <button key={inst} onClick={() => setFilter(inst)} className={cn(
              'px-3 py-1.5 text-[11px] font-semibold rounded-md transition-colors',
              filter === inst ? 'bg-[var(--text-primary)] text-[var(--bg-primary)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
            )}>{inst === 'all' ? 'All' : inst}</button>
          ))}
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleCreateSignal} className="mb-5 rounded-xl border p-5" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
          <div className="text-[11px] font-bold text-[var(--amber)] tracking-wider mb-4">CREATE MANUAL SIGNAL</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="text-[10px] text-[var(--text-muted)] block mb-1">Instrument</label>
              <select value={formData.instrument} onChange={e => setFormData(p => ({ ...p, instrument: e.target.value }))} className="w-full px-2 py-1.5 rounded text-[12px] font-mono" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                {['BTC/USD','ETH/USD','SOL/USD','BNB/USD','DOGE/USD','AVAX/USD','LINK/USD','XAU/USD'].map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-muted)] block mb-1">Direction</label>
              <div className="flex gap-1">
                {(['long', 'short'] as const).map(d => (
                  <button type="button" key={d} onClick={() => setFormData(p => ({ ...p, direction: d }))} className="flex-1 px-2 py-1.5 rounded text-[11px] font-bold" style={{ background: formData.direction === d ? (d === 'long' ? 'var(--green)' : 'var(--red)') : 'var(--bg-secondary)', color: formData.direction === d ? '#fff' : 'var(--text-muted)', border: '1px solid var(--border)' }}>
                    {d.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-muted)] block mb-1">Entry Price</label>
              <input type="number" step="any" required value={formData.entry_price} onChange={e => setFormData(p => ({ ...p, entry_price: e.target.value }))} className="w-full px-2 py-1.5 rounded text-[12px] font-mono" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} placeholder="60000" />
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-muted)] block mb-1">Stop Loss</label>
              <input type="number" step="any" required value={formData.stop_loss} onChange={e => setFormData(p => ({ ...p, stop_loss: e.target.value }))} className="w-full px-2 py-1.5 rounded text-[12px] font-mono" style={{ background: 'var(--bg-secondary)', color: 'var(--red)', border: '1px solid var(--border)' }} placeholder="58500" />
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-muted)] block mb-1">Take Profit 1</label>
              <input type="number" step="any" required value={formData.take_profit_1} onChange={e => setFormData(p => ({ ...p, take_profit_1: e.target.value }))} className="w-full px-2 py-1.5 rounded text-[12px] font-mono" style={{ background: 'var(--bg-secondary)', color: 'var(--green)', border: '1px solid var(--border)' }} placeholder="63000" />
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-muted)] block mb-1">Take Profit 2 (optional)</label>
              <input type="number" step="any" value={formData.take_profit_2} onChange={e => setFormData(p => ({ ...p, take_profit_2: e.target.value }))} className="w-full px-2 py-1.5 rounded text-[12px] font-mono" style={{ background: 'var(--bg-secondary)', color: 'var(--green)', border: '1px solid var(--border)' }} placeholder="65000" />
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-muted)] block mb-1">Confidence: {formData.confidence}%</label>
              <input type="range" min="50" max="100" value={formData.confidence} onChange={e => setFormData(p => ({ ...p, confidence: +e.target.value }))} className="w-full" />
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-muted)] block mb-1">R:R Preview</label>
              <div className="text-lg font-black mono mt-1" style={{ color: 'var(--blue)' }}>
                {formData.entry_price && formData.stop_loss && formData.take_profit_1
                  ? (Math.abs(parseFloat(formData.take_profit_1) - parseFloat(formData.entry_price)) / Math.abs(parseFloat(formData.entry_price) - parseFloat(formData.stop_loss))).toFixed(2) + 'x'
                  : '—'}
              </div>
            </div>
          </div>
          <div className="mb-3">
            <label className="text-[10px] text-[var(--text-muted)] block mb-1">Reasoning</label>
            <input type="text" value={formData.reasoning} onChange={e => setFormData(p => ({ ...p, reasoning: e.target.value }))} className="w-full px-2 py-1.5 rounded text-[12px]" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} placeholder="Why are you taking this trade?" />
          </div>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-[12px] font-bold" style={{ background: 'var(--green)', color: '#fff', opacity: saving ? 0.5 : 1 }}>
            {saving ? 'Creating...' : '📡 Create Signal'}
          </button>
        </form>
      )}

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
