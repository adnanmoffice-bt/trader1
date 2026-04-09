'use client'
import { useEffect, useRef } from 'react'
import { createChart, LineSeries, ColorType, LineStyle, type IChartApi } from 'lightweight-charts'

interface TradeAnalytic {
  trade_id: string
  instrument: string
  direction: string
  mfe_pct: number
  mae_pct: number
  exit_efficiency_pct: number
  r_value: number
  holding_duration_mins: number
  entry_hour: number
}

export function ExitAnalysis({ data }: { data: TradeAnalytic[] }) {
  if (!data.length) return <div className="p-3 text-[9px] text-center" style={{ color: 'var(--text-3)' }}>No trade analytics data yet</div>

  const avgEE = data.reduce((s, d) => s + +d.exit_efficiency_pct, 0) / data.length
  const underperformers = data.filter(d => +d.exit_efficiency_pct < 40).length
  const overperformers = data.filter(d => +d.exit_efficiency_pct > 80).length

  const byInstrument: Record<string, { count: number; avgEE: number; avgMFE: number; avgMAE: number }> = {}
  for (const d of data) {
    if (!byInstrument[d.instrument]) byInstrument[d.instrument] = { count: 0, avgEE: 0, avgMFE: 0, avgMAE: 0 }
    byInstrument[d.instrument].count++
    byInstrument[d.instrument].avgEE += +d.exit_efficiency_pct
    byInstrument[d.instrument].avgMFE += +d.mfe_pct
    byInstrument[d.instrument].avgMAE += +d.mae_pct
  }
  for (const v of Object.values(byInstrument)) {
    v.avgEE /= v.count; v.avgMFE /= v.count; v.avgMAE /= v.count
  }

  const byHour: Record<number, { count: number; avgEE: number }> = {}
  for (const d of data) {
    const h = d.entry_hour
    if (!byHour[h]) byHour[h] = { count: 0, avgEE: 0 }
    byHour[h].count++
    byHour[h].avgEE += +d.exit_efficiency_pct
  }
  for (const v of Object.values(byHour)) v.avgEE /= v.count

  return (
    <div className="flex flex-col gap-px" style={{ background: 'var(--border)' }}>
      {/* Summary bar */}
      <div className="p-3 grid grid-cols-3 gap-2" style={{ background: 'var(--bg-1)' }}>
        <div className="text-center p-2 rounded" style={{ background: 'var(--bg-2)' }}>
          <div className="text-[7px] font-bold" style={{ color: 'var(--text-3)' }}>AVG EXIT EFFICIENCY</div>
          <div className="text-[16px] font-black" style={{ color: avgEE >= 60 ? 'var(--green)' : avgEE >= 40 ? 'var(--amber)' : 'var(--red)' }}>{avgEE.toFixed(0)}%</div>
        </div>
        <div className="text-center p-2 rounded" style={{ background: 'var(--bg-2)' }}>
          <div className="text-[7px] font-bold" style={{ color: 'var(--text-3)' }}>CUTTING WINNERS</div>
          <div className="text-[16px] font-black" style={{ color: 'var(--red)' }}>{underperformers}</div>
          <div className="text-[7px]" style={{ color: 'var(--text-3)' }}>trades {'<'}40% eff</div>
        </div>
        <div className="text-center p-2 rounded" style={{ background: 'var(--bg-2)' }}>
          <div className="text-[7px] font-bold" style={{ color: 'var(--text-3)' }}>GOOD EXITS</div>
          <div className="text-[16px] font-black" style={{ color: 'var(--green)' }}>{overperformers}</div>
          <div className="text-[7px]" style={{ color: 'var(--text-3)' }}>trades {'>'}80% eff</div>
        </div>
      </div>

      {/* By instrument */}
      <div className="p-3" style={{ background: 'var(--bg-1)' }}>
        <div className="text-[9px] font-bold mb-2" style={{ color: 'var(--text-3)' }}>BY INSTRUMENT</div>
        <div className="space-y-1">
          {Object.entries(byInstrument).sort((a, b) => b[1].avgEE - a[1].avgEE).map(([inst, v]) => (
            <div key={inst} className="flex items-center gap-2">
              <span className="text-[10px] font-bold w-16" style={{ color: 'var(--text-0)' }}>{inst.replace('/USD', '')}</span>
              <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-3)' }}>
                <div className="h-full rounded-full" style={{
                  width: `${Math.min(Math.max(v.avgEE, 0), 100)}%`,
                  background: v.avgEE >= 60 ? 'var(--green)' : v.avgEE >= 40 ? 'var(--amber)' : 'var(--red)',
                }} />
              </div>
              <span className="text-[9px] font-bold w-10 text-right" style={{ color: v.avgEE >= 60 ? 'var(--green)' : 'var(--red)' }}>
                {v.avgEE.toFixed(0)}%
              </span>
              <span className="text-[8px] w-16 text-right" style={{ color: 'var(--text-3)' }}>
                MFE:{v.avgMFE.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Individual trades scatter-like view */}
      <div className="p-3" style={{ background: 'var(--bg-1)' }}>
        <div className="text-[9px] font-bold mb-2" style={{ color: 'var(--text-3)' }}>RECENT TRADES (exit eff vs R-value)</div>
        <div className="flex flex-wrap gap-1">
          {data.slice(0, 30).map((d, i) => {
            const ee = +d.exit_efficiency_pct
            const r = +d.r_value
            const size = Math.max(12, Math.min(24, Math.abs(r) * 8 + 12))
            const color = r > 0 ? (ee > 60 ? 'var(--green)' : 'var(--amber)') : 'var(--red)'
            return (
              <div key={i} className="rounded-full flex items-center justify-center text-[7px] font-bold"
                style={{ width: size, height: size, background: color + '30', color, border: `1px solid ${color}` }}
                title={`${d.instrument} R:${r.toFixed(2)} EE:${ee.toFixed(0)}%`}>
                {r.toFixed(1)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
