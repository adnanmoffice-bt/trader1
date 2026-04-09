'use client'
import { useEffect, useRef } from 'react'
import { createChart, LineSeries, AreaSeries, ColorType, LineStyle, type IChartApi, type Time } from 'lightweight-charts'

interface DataPoint {
  date: string
  equity: number
  cumulative_pnl: number
  daily_pnl: number
}

export function EquityCurve({ data }: { data: DataPoint[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!ref.current || !data.length) return
    ref.current.innerHTML = ''

    const cs = getComputedStyle(document.documentElement)
    const bgColor = cs.getPropertyValue('--bg-1').trim() || '#111827'
    const textColor = cs.getPropertyValue('--text-2').trim() || '#6b7a99'
    const borderColor = cs.getPropertyValue('--border').trim() || '#1e293b'
    const greenColor = cs.getPropertyValue('--green').trim() || '#22c55e'

    const chart = createChart(ref.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: bgColor }, textColor, fontFamily: "'JetBrains Mono', monospace", fontSize: 10 },
      grid: { vertLines: { color: borderColor, style: LineStyle.Dotted }, horzLines: { color: borderColor, style: LineStyle.Dotted } },
      rightPriceScale: { borderColor },
      timeScale: { borderColor, timeVisible: false },
    })
    chartRef.current = chart

    const areaSeries = chart.addSeries(AreaSeries, {
      topColor: greenColor + '40',
      bottomColor: greenColor + '05',
      lineColor: greenColor,
      lineWidth: 2,
      priceLineVisible: false,
    })

    areaSeries.setData(data.map(d => ({
      time: d.date as Time,
      value: d.equity,
    })))

    chart.timeScale().fitContent()
    return () => { chart.remove() }
  }, [data])

  if (!data.length) return <div className="flex items-center justify-center h-full text-[10px]" style={{ color: 'var(--text-3)' }}>No equity data yet</div>

  return <div ref={ref} className="w-full h-full" />
}
