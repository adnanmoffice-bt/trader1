'use client'
import { useEffect, useState } from 'react'
import { EquityCurve } from '@/components/analytics/EquityCurve'
import { TradeCalendar } from '@/components/analytics/TradeCalendar'
import { PerformanceMetrics } from '@/components/analytics/PerformanceMetrics'
import { ExitAnalysis } from '@/components/analytics/ExitAnalysis'

type Tab = 'overview' | 'exit' | 'calendar'

export default function AnalyticsPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const [perf, setPerf] = useState<any>(null)
  const [equity, setEquity] = useState<any[]>([])
  const [calendar, setCalendar] = useState<any[]>([])
  const [analytics, setAnalytics] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/analytics/performance').then(r => r.json()),
      fetch('/api/analytics/equity-curve').then(r => r.json()),
      fetch('/api/analytics/calendar').then(r => r.json()),
      fetch('/api/analytics?limit=50').then(r => r.json()),
    ]).then(([p, e, c, a]) => {
      setPerf(p.data)
      setEquity(e.data ?? [])
      setCalendar(c.data ?? [])
      setAnalytics(a.data ?? [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="text-[11px] font-bold" style={{ color: 'var(--amber)' }}>PERFORMANCE ANALYTICS</span>
        <div className="flex items-center gap-1 ml-4">
          {(['overview', 'exit', 'calendar'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className="px-2 py-0.5 text-[9px] font-bold rounded transition-colors"
              style={{
                color: tab === t ? 'var(--amber)' : 'var(--text-3)',
                background: tab === t ? 'var(--bg-2)' : 'transparent',
              }}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {perf && (
          <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>
            {perf.total_trades} trades | {perf.win_rate?.toFixed(0)}% WR | PF {perf.profit_factor?.toFixed(2)}
          </span>
        )}
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-[10px]" style={{ color: 'var(--text-3)' }}>Loading analytics...</div>}

      {!loading && tab === 'overview' && (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-px overflow-auto" style={{ background: 'var(--border)' }}>
          {/* Metrics */}
          <div className="lg:col-span-3" style={{ background: 'var(--bg-1)' }}>
            <PerformanceMetrics data={perf} />
          </div>

          {/* Equity curve */}
          <div className="lg:col-span-2 flex flex-col" style={{ background: 'var(--bg-1)' }}>
            <div className="px-3 py-1.5 text-[9px] font-bold" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>EQUITY CURVE</div>
            <div className="flex-1 min-h-[250px]">
              <EquityCurve data={equity} />
            </div>
          </div>

          {/* Weaknesses & Strengths */}
          <div className="flex flex-col gap-px" style={{ background: 'var(--border)' }}>
            <div className="p-3" style={{ background: 'var(--bg-1)' }}>
              <div className="text-[9px] font-bold mb-2" style={{ color: 'var(--green)' }}>STRENGTHS</div>
              {(perf?.strengths ?? []).map((s: string, i: number) => (
                <div key={i} className="text-[9px] py-0.5 flex gap-1" style={{ color: 'var(--text-1)' }}>
                  <span style={{ color: 'var(--green)' }}>+</span> {s}
                </div>
              ))}
              {!(perf?.strengths?.length) && <div className="text-[8px]" style={{ color: 'var(--text-3)' }}>Not enough data yet</div>}
            </div>
            <div className="p-3" style={{ background: 'var(--bg-1)' }}>
              <div className="text-[9px] font-bold mb-2" style={{ color: 'var(--red)' }}>WEAKNESSES</div>
              {(perf?.weaknesses ?? []).map((w: string, i: number) => (
                <div key={i} className="text-[9px] py-0.5 flex gap-1" style={{ color: 'var(--text-1)' }}>
                  <span style={{ color: 'var(--red)' }}>!</span> {w}
                </div>
              ))}
              {!(perf?.weaknesses?.length) && <div className="text-[8px]" style={{ color: 'var(--text-3)' }}>No weaknesses detected</div>}
            </div>
          </div>
        </div>
      )}

      {!loading && tab === 'exit' && (
        <div className="flex-1 min-h-0 overflow-auto" style={{ background: 'var(--bg-1)' }}>
          <ExitAnalysis data={analytics} />
        </div>
      )}

      {!loading && tab === 'calendar' && (
        <div className="flex-1 min-h-0" style={{ background: 'var(--bg-1)' }}>
          <TradeCalendar data={calendar} />
        </div>
      )}
    </div>
  )
}
