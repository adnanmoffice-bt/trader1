'use client'
import { useState, useCallback, useEffect } from 'react'
import { TradingChart, type Timeframe, TIMEFRAMES } from './TradingChart'
import type { OHLCV } from '@/types'

const LAYOUTS = [
  { cols: 1, rows: 1, label: '1x1' },
  { cols: 2, rows: 1, label: '2x1' },
  { cols: 2, rows: 2, label: '2x2' },
  { cols: 3, rows: 1, label: '3x1' },
] as const

const DEFAULT_SYMBOLS = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'BNB/USD']

interface ChartState {
  symbol: string
  timeframe: Timeframe
  candles: OHLCV[]
}

export function MultiChart() {
  const [layoutIdx, setLayoutIdx] = useState(2)
  const layout = LAYOUTS[layoutIdx]
  const total = layout.cols * layout.rows

  const [charts, setCharts] = useState<ChartState[]>(
    DEFAULT_SYMBOLS.map(s => ({ symbol: s, timeframe: '1h' as Timeframe, candles: [] }))
  )

  const fetchCandles = useCallback(async (symbol: string, tf: Timeframe) => {
    try {
      const intervalMap: Record<string, string> = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1D': '1d', '1W': '1w' }
      const res = await fetch(`/api/prices?symbol=${encodeURIComponent(symbol)}&candles=true&interval=${intervalMap[tf] || '1h'}&limit=200`)
      const d = await res.json()
      return d.data || []
    } catch { return [] }
  }, [])

  useEffect(() => {
    charts.slice(0, total).forEach((c, i) => {
      if (!c.candles.length) {
        fetchCandles(c.symbol, c.timeframe).then(candles => {
          setCharts(prev => prev.map((p, j) => j === i ? { ...p, candles } : p))
        })
      }
    })
  }, [total])

  const updateChart = useCallback((index: number, updates: Partial<ChartState>) => {
    setCharts(prev => prev.map((c, i) => i === index ? { ...c, ...updates } : c))
    if (updates.timeframe || updates.symbol) {
      const c = charts[index]
      const sym = updates.symbol || c.symbol
      const tf = updates.timeframe || c.timeframe
      fetchCandles(sym, tf).then(candles => {
        setCharts(prev => prev.map((p, i) => i === index ? { ...p, candles } : p))
      })
    }
  }, [charts, fetchCandles])

  return (
    <div className="flex flex-col h-full">
      {/* Layout selector */}
      <div className="flex items-center gap-2 px-3 py-1.5 flex-shrink-0" style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>
        <span className="text-[9px] font-bold" style={{ color: 'var(--text-3)' }}>LAYOUT</span>
        {LAYOUTS.map((l, i) => (
          <button key={l.label} onClick={() => setLayoutIdx(i)}
            className="px-2 py-0.5 text-[9px] font-bold rounded"
            style={{
              color: layoutIdx === i ? 'var(--amber)' : 'var(--text-3)',
              background: layoutIdx === i ? 'var(--bg-2)' : 'transparent',
            }}>
            {l.label}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>MULTI-CHART VIEW</span>
      </div>

      {/* Charts grid */}
      <div className="flex-1 min-h-0 grid gap-px" style={{
        gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
        gridTemplateRows: `repeat(${layout.rows}, 1fr)`,
        background: 'var(--border)',
      }}>
        {charts.slice(0, total).map((c, i) => (
          <div key={i} className="flex flex-col min-h-0" style={{ background: 'var(--bg-1)' }}>
            {/* Mini symbol selector */}
            <div className="flex items-center gap-1 px-1 py-0.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
              {DEFAULT_SYMBOLS.map(s => (
                <button key={s} onClick={() => updateChart(i, { symbol: s })}
                  className="px-1 text-[8px] font-bold"
                  style={{ color: c.symbol === s ? 'var(--amber)' : 'var(--text-3)' }}>
                  {s.replace('/USD', '')}
                </button>
              ))}
            </div>
            <div className="flex-1 min-h-0">
              <TradingChart
                candles={c.candles}
                symbol={c.symbol}
                timeframe={c.timeframe}
                onTimeframeChange={(tf) => updateChart(i, { timeframe: tf })}
                showVolume={true}
                showEMA={total <= 2}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
