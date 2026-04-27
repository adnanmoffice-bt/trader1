'use client'

import { useEffect, useState } from 'react'

type BudgetData = {
  today: { spent: number; remaining: number; budget: number; calls: number; exhausted: boolean }
  last7d: Array<{ date: string; spent: number; calls: number }>
  allTime: { spent: number; calls: number }
  byModel: Record<string, { spent: number; calls: number }>
  lastCallAt: string | null
}

export function AIBudgetTile() {
  const [data, setData] = useState<BudgetData | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    const load = () => fetch('/api/budget').then(r => r.json()).then(d => { if (alive) setData(d) }).catch(() => {})
    load()
    const iv = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(iv) }
  }, [])

  if (!data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingRight: 10, borderRight: '1px solid var(--border)', marginRight: 10 }}>
        <span style={{ color: 'var(--text-3)', fontSize: 8 }}>AI</span>
        <span className="tabular-nums" style={{ fontWeight: 700, color: 'var(--text-3)' }}>—</span>
      </div>
    )
  }

  const { today, last7d, allTime, byModel, lastCallAt } = data
  const pct = today.budget > 0 ? today.spent / today.budget : 0
  const color =
    today.exhausted ? 'var(--red)' :
    pct >= 0.8     ? 'var(--red)' :
    pct >= 0.5     ? 'var(--amber)' :
                     'var(--green)'

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        paddingRight: 10, borderRight: '1px solid var(--border)', marginRight: 10,
        cursor: 'pointer', position: 'relative',
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen(o => !o)}
      title="Click for full Anthropic budget breakdown"
    >
      <span style={{ color: 'var(--text-3)', fontSize: 8 }}>AI</span>
      <span className="tabular-nums" style={{ fontWeight: 700, color }}>
        ${today.spent.toFixed(2)}/${today.budget.toFixed(0)}
      </span>
      <span style={{ fontSize: 8, color: 'var(--text-3)' }}>{today.calls}c</span>

      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            right: 0,
            marginBottom: 4,
            background: 'var(--bg-1)',
            border: '1px solid var(--border)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            padding: 12,
            minWidth: 280,
            fontSize: 10,
            zIndex: 100,
            color: 'var(--text-1)',
            fontFamily: "'JetBrains Mono', monospace",
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ fontWeight: 800, color: 'var(--amber)', marginBottom: 8, fontSize: 11 }}>
            ANTHROPIC API BUDGET
          </div>

          <Row label="Today spent"     value={`$${today.spent.toFixed(4)}`}     valueColor={color} />
          <Row label="Daily budget"    value={`$${today.budget.toFixed(2)}`} />
          <Row label="Remaining today" value={`$${today.remaining.toFixed(4)}`} valueColor={today.remaining > 0 ? 'var(--green)' : 'var(--red)'} />
          <Row label="Calls today"     value={String(today.calls)} />
          <Row label="Usage"           value={`${(pct * 100).toFixed(1)}%`} valueColor={color} />

          <div style={{ height: 4, background: 'var(--bg-2)', borderRadius: 2, marginTop: 6, marginBottom: 10, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, pct * 100)}%`, height: '100%', background: color, transition: 'width 0.3s' }} />
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
            <div style={{ fontWeight: 700, color: 'var(--text-2)', marginBottom: 4, fontSize: 9 }}>LAST 7 DAYS</div>
            {last7d.map(d => {
              const dpct = today.budget > 0 ? d.spent / today.budget : 0
              return (
                <div key={d.date} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ color: 'var(--text-3)', width: 60, fontSize: 9 }}>{d.date.slice(5)}</span>
                  <div style={{ flex: 1, height: 4, background: 'var(--bg-2)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, dpct * 100)}%`, height: '100%', background: dpct >= 0.8 ? 'var(--red)' : dpct >= 0.5 ? 'var(--amber)' : 'var(--green)' }} />
                  </div>
                  <span className="tabular-nums" style={{ width: 60, textAlign: 'right', color: 'var(--text-1)', fontWeight: 600, fontSize: 9 }}>
                    ${d.spent.toFixed(3)}
                  </span>
                  <span className="tabular-nums" style={{ width: 30, textAlign: 'right', color: 'var(--text-3)', fontSize: 9 }}>
                    {d.calls}
                  </span>
                </div>
              )
            })}
          </div>

          {Object.keys(byModel).length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
              <div style={{ fontWeight: 700, color: 'var(--text-2)', marginBottom: 4, fontSize: 9 }}>BY MODEL TODAY</div>
              {Object.entries(byModel).sort((a, b) => b[1].spent - a[1].spent).map(([model, m]) => (
                <Row key={model} label={shortModel(model)} value={`$${m.spent.toFixed(4)} (${m.calls})`} small />
              ))}
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
            <Row label="All-time spent" value={`$${allTime.spent.toFixed(2)}`} valueColor="var(--text-0)" />
            <Row label="All-time calls" value={String(allTime.calls)} />
            {lastCallAt && (
              <Row label="Last call" value={new Date(lastCallAt).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', hour12: false }).slice(5, 17)} small />
            )}
          </div>

          <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--border)', fontSize: 8, color: 'var(--text-3)' }}>
            Daily limit set via <code style={{ color: 'var(--cyan)' }}>AI_DAILY_BUDGET</code> env var. Spend tracked in <code style={{ color: 'var(--cyan)' }}>agent_logs (budget-tracker)</code>.
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, valueColor, small }: { label: string; value: string; valueColor?: string; small?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
      <span style={{ color: 'var(--text-3)', fontSize: small ? 9 : 10 }}>{label}</span>
      <span className="tabular-nums" style={{ fontWeight: 700, color: valueColor ?? 'var(--text-1)', fontSize: small ? 9 : 10 }}>{value}</span>
    </div>
  )
}

function shortModel(m: string): string {
  if (m.includes('opus'))   return 'Opus'
  if (m.includes('sonnet')) return 'Sonnet'
  if (m.includes('haiku'))  return 'Haiku'
  return m.length > 20 ? m.slice(0, 18) + '…' : m
}
