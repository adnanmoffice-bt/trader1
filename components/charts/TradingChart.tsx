'use client'
import { useEffect, useRef, useCallback, useState } from 'react'
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type Time,
  createSeriesMarkers,
} from 'lightweight-charts'
import type { OHLCV } from '@/types'

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1D', '1W'] as const
type Timeframe = typeof TIMEFRAMES[number]

interface SignalMarker {
  time: number
  direction: 'long' | 'short'
  label: string
  price?: number
}

interface TradeMarker {
  time: number
  type: 'entry' | 'exit'
  direction: 'long' | 'short'
  price: number
  pnl?: number
}

interface TradingChartProps {
  candles: OHLCV[]
  symbol: string
  timeframe?: Timeframe
  onTimeframeChange?: (tf: Timeframe) => void
  signals?: SignalMarker[]
  trades?: TradeMarker[]
  showBB?: boolean
  showEMA?: boolean
  showSMA?: boolean
  showVolume?: boolean
  showRSI?: boolean
  showMACD?: boolean
  height?: number
}

function calcEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const result: number[] = [data[0]]
  for (let i = 1; i < data.length; i++) result.push(data[i] * k + result[i - 1] * (1 - k))
  return result
}

function calcSMA(data: number[], period: number): number[] {
  const result: number[] = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += data[j]
    result.push(sum / period)
  }
  return result
}

function calcRSI(closes: number[], period = 14): number[] {
  const rsi: number[] = Array(period).fill(NaN)
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) avgGain += d; else avgLoss -= d
  }
  avgGain /= period; avgLoss /= period
  rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))
  }
  return rsi
}

function calcMACD(closes: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = calcEMA(closes, fast)
  const emaSlow = calcEMA(closes, slow)
  const macdLine = emaFast.map((v, i) => v - emaSlow[i])
  const signalLine = calcEMA(macdLine, signal)
  const histogram = macdLine.map((v, i) => v - signalLine[i])
  return { macdLine, signalLine, histogram }
}

function calcBB(closes: number[], period = 20, mult = 2) {
  const sma = calcSMA(closes, period)
  const upper: number[] = [], lower: number[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { upper.push(NaN); lower.push(NaN); continue }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += (closes[j] - sma[i]) ** 2
    const std = Math.sqrt(sum / period)
    upper.push(sma[i] + mult * std)
    lower.push(sma[i] - mult * std)
  }
  return { upper, middle: sma, lower }
}

export function TradingChart({
  candles, symbol, timeframe = '1h', onTimeframeChange,
  signals = [], trades = [],
  showBB = false, showEMA = true, showSMA = false, showVolume = true,
  showRSI = false, showMACD = false, height,
}: TradingChartProps) {
  const mainRef = useRef<HTMLDivElement>(null)
  const rsiRef = useRef<HTMLDivElement>(null)
  const macdRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const rsiChartRef = useRef<IChartApi | null>(null)
  const macdChartRef = useRef<IChartApi | null>(null)
  const [activeIndicators, setActiveIndicators] = useState({
    bb: showBB, ema: showEMA, sma: showSMA, vol: showVolume, rsi: showRSI, macd: showMACD,
  })

  const toggleIndicator = useCallback((key: keyof typeof activeIndicators) => {
    setActiveIndicators(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  useEffect(() => {
    if (!mainRef.current || !candles.length) return

    const cs = getComputedStyle(document.documentElement)
    const getVar = (n: string) => cs.getPropertyValue(n).trim()
    const bgColor = getVar('--bg-1') || '#111827'
    const textColor = getVar('--text-2') || '#6b7a99'
    const borderColor = getVar('--border') || '#1e293b'
    const greenColor = getVar('--green') || '#22c55e'
    const redColor = getVar('--red') || '#ef4444'
    const blueColor = getVar('--blue') || '#3b82f6'
    const purpleColor = getVar('--purple') || '#a78bfa'
    const amberColor = getVar('--amber') || '#f59e0b'
    const cyanColor = getVar('--cyan') || '#06b6d4'

    const chartOptions = {
      layout: {
        background: { type: ColorType.Solid as const, color: bgColor },
        textColor,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: borderColor, style: LineStyle.Dotted },
        horzLines: { color: borderColor, style: LineStyle.Dotted },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor,
        scaleMargins: { top: 0.05, bottom: activeIndicators.vol ? 0.2 : 0.05 },
      },
      timeScale: {
        borderColor,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
      },
      handleScroll: true,
      handleScale: true,
    }

    mainRef.current.innerHTML = ''
    const chart = createChart(mainRef.current, { ...chartOptions, autoSize: true })
    chartRef.current = chart

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: greenColor,
      downColor: redColor,
      borderUpColor: greenColor,
      borderDownColor: redColor,
      wickUpColor: greenColor,
      wickDownColor: redColor,
    })

    const candleData: CandlestickData[] = candles.map(c => ({
      time: (c.timestamp / 1000) as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }))
    candleSeries.setData(candleData)

    if (activeIndicators.vol) {
      const volSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'vol',
      })
      chart.priceScale('vol').applyOptions({
        scaleMargins: { top: 0.85, bottom: 0 },
      })
      const volData: HistogramData[] = candles.map(c => ({
        time: (c.timestamp / 1000) as Time,
        value: c.volume,
        color: c.close >= c.open ? greenColor + '40' : redColor + '40',
      }))
      volSeries.setData(volData)
    }

    const closes = candles.map(c => c.close)

    if (activeIndicators.ema) {
      const ema20 = calcEMA(closes, 20)
      const ema50 = calcEMA(closes, 50)
      const ema20Series = chart.addSeries(LineSeries, {
        color: amberColor,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      ema20Series.setData(candles.map((c, i) => ({
        time: (c.timestamp / 1000) as Time,
        value: ema20[i],
      })).filter(d => !isNaN(d.value)))

      const ema50Series = chart.addSeries(LineSeries, {
        color: purpleColor,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      ema50Series.setData(candles.map((c, i) => ({
        time: (c.timestamp / 1000) as Time,
        value: ema50[i],
      })).filter(d => !isNaN(d.value)))
    }

    if (activeIndicators.sma) {
      const sma20 = calcSMA(closes, 20)
      const sma20Series = chart.addSeries(LineSeries, {
        color: cyanColor,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      sma20Series.setData(candles.map((c, i) => ({
        time: (c.timestamp / 1000) as Time,
        value: sma20[i],
      })).filter(d => !isNaN(d.value)))
    }

    if (activeIndicators.bb) {
      const bb = calcBB(closes)
      const bbUpper = chart.addSeries(LineSeries, {
        color: blueColor + '80',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      const bbMiddle = chart.addSeries(LineSeries, {
        color: blueColor + '50',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      const bbLower = chart.addSeries(LineSeries, {
        color: blueColor + '80',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      const valid = (c: OHLCV, v: number) => !isNaN(v) ? { time: (c.timestamp / 1000) as Time, value: v } : null
      bbUpper.setData(candles.map((c, i) => valid(c, bb.upper[i])).filter(Boolean) as LineData[])
      bbMiddle.setData(candles.map((c, i) => valid(c, bb.middle[i])).filter(Boolean) as LineData[])
      bbLower.setData(candles.map((c, i) => valid(c, bb.lower[i])).filter(Boolean) as LineData[])
    }

    const allMarkers = [
      ...signals.map(s => ({
        time: (s.time / 1000) as Time,
        position: (s.direction === 'long' ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
        color: s.direction === 'long' ? greenColor : redColor,
        shape: (s.direction === 'long' ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
        text: s.label,
      })),
      ...trades.map(t => ({
        time: (t.time / 1000) as Time,
        position: (t.type === 'entry'
          ? (t.direction === 'long' ? 'belowBar' : 'aboveBar')
          : (t.direction === 'long' ? 'aboveBar' : 'belowBar')) as 'belowBar' | 'aboveBar',
        color: t.type === 'entry' ? blueColor : (t.pnl && t.pnl >= 0 ? greenColor : redColor),
        shape: (t.type === 'entry' ? 'circle' : 'square') as 'circle' | 'square',
        text: t.type === 'entry'
          ? `${t.direction === 'long' ? 'BUY' : 'SELL'} @${t.price.toFixed(2)}`
          : `EXIT ${t.pnl ? (t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(0) : ''}`,
      })),
    ].sort((a, b) => (a.time as number) - (b.time as number))

    if (allMarkers.length) createSeriesMarkers(candleSeries, allMarkers)

    chart.timeScale().fitContent()

    // RSI sub-chart
    if (activeIndicators.rsi && rsiRef.current) {
      rsiRef.current.innerHTML = ''
      const rsiChart = createChart(rsiRef.current, {
        ...chartOptions,
        autoSize: true,
        rightPriceScale: { ...chartOptions.rightPriceScale, scaleMargins: { top: 0.1, bottom: 0.1 } },
      })
      rsiChartRef.current = rsiChart

      const rsiData = calcRSI(closes)
      const rsiSeries = rsiChart.addSeries(LineSeries, {
        color: purpleColor,
        lineWidth: 1,
        priceLineVisible: false,
      })
      rsiSeries.setData(candles.map((c, i) => ({
        time: (c.timestamp / 1000) as Time,
        value: rsiData[i],
      })).filter(d => !isNaN(d.value)))

      // Overbought/oversold lines
      const ob = rsiChart.addSeries(LineSeries, { color: redColor + '40', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false })
      const os = rsiChart.addSeries(LineSeries, { color: greenColor + '40', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false })
      const mid = rsiChart.addSeries(LineSeries, { color: textColor + '30', lineWidth: 1, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false })
      const constLine = (val: number) => candles.map(c => ({ time: (c.timestamp / 1000) as Time, value: val }))
      ob.setData(constLine(70))
      os.setData(constLine(30))
      mid.setData(constLine(50))

      rsiChart.timeScale().fitContent()

      // Sync time scales
      chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (range) rsiChart.timeScale().setVisibleLogicalRange(range)
      })
      rsiChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (range) chart.timeScale().setVisibleLogicalRange(range)
      })
    }

    // MACD sub-chart
    if (activeIndicators.macd && macdRef.current) {
      macdRef.current.innerHTML = ''
      const macdChart = createChart(macdRef.current, {
        ...chartOptions,
        autoSize: true,
        rightPriceScale: { ...chartOptions.rightPriceScale, scaleMargins: { top: 0.1, bottom: 0.1 } },
      })
      macdChartRef.current = macdChart

      const { macdLine, signalLine, histogram } = calcMACD(closes)

      const histSeries = macdChart.addSeries(HistogramSeries, { priceLineVisible: false })
      histSeries.setData(candles.map((c, i) => ({
        time: (c.timestamp / 1000) as Time,
        value: histogram[i],
        color: histogram[i] >= 0 ? greenColor + '80' : redColor + '80',
      })).filter(d => !isNaN(d.value)))

      const macdSeries = macdChart.addSeries(LineSeries, { color: blueColor, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      macdSeries.setData(candles.map((c, i) => ({ time: (c.timestamp / 1000) as Time, value: macdLine[i] })).filter(d => !isNaN(d.value)))

      const sigSeries = macdChart.addSeries(LineSeries, { color: redColor, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      sigSeries.setData(candles.map((c, i) => ({ time: (c.timestamp / 1000) as Time, value: signalLine[i] })).filter(d => !isNaN(d.value)))

      macdChart.timeScale().fitContent()

      chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (range) macdChart.timeScale().setVisibleLogicalRange(range)
      })
      macdChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (range) chart.timeScale().setVisibleLogicalRange(range)
      })
    }

    return () => {
      chart.remove()
      rsiChartRef.current?.remove()
      macdChartRef.current?.remove()
    }
  }, [candles, activeIndicators, signals, trades])

  const mainHeight = height
    ? height - (activeIndicators.rsi ? 120 : 0) - (activeIndicators.macd ? 120 : 0)
    : undefined

  return (
    <div className="flex flex-col h-full w-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-1)' }}>
        {/* Timeframes */}
        <div className="flex items-center gap-0.5 mr-2">
          {TIMEFRAMES.map(tf => (
            <button key={tf} onClick={() => onTimeframeChange?.(tf)}
              className="px-1.5 py-0.5 text-[9px] font-bold rounded transition-colors"
              style={{
                color: timeframe === tf ? 'var(--amber)' : 'var(--text-3)',
                background: timeframe === tf ? 'var(--bg-2)' : 'transparent',
              }}>
              {tf}
            </button>
          ))}
        </div>

        <div className="w-px h-4" style={{ background: 'var(--border)' }} />

        {/* Indicators */}
        <div className="flex items-center gap-0.5 ml-2">
          {([
            { key: 'ema' as const, label: 'EMA', color: 'var(--amber)' },
            { key: 'sma' as const, label: 'SMA', color: 'var(--cyan)' },
            { key: 'bb' as const, label: 'BB', color: 'var(--blue)' },
            { key: 'vol' as const, label: 'VOL', color: 'var(--text-2)' },
            { key: 'rsi' as const, label: 'RSI', color: 'var(--purple)' },
            { key: 'macd' as const, label: 'MACD', color: 'var(--blue)' },
          ]).map(ind => (
            <button key={ind.key} onClick={() => toggleIndicator(ind.key)}
              className="px-1.5 py-0.5 text-[9px] font-bold rounded transition-colors"
              style={{
                color: activeIndicators[ind.key] ? ind.color : 'var(--text-3)',
                background: activeIndicators[ind.key] ? 'var(--bg-2)' : 'transparent',
                opacity: activeIndicators[ind.key] ? 1 : 0.5,
              }}>
              {ind.label}
            </button>
          ))}
        </div>

        <div className="flex-1" />
        <span className="text-[10px] font-bold" style={{ color: 'var(--text-2)' }}>{symbol}</span>
      </div>

      {/* Main Chart */}
      <div ref={mainRef} className="flex-1 min-h-0" style={{ minHeight: mainHeight || 200 }} />

      {/* RSI Pane */}
      {activeIndicators.rsi && (
        <div className="flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="px-2 py-0.5 text-[8px] font-bold" style={{ color: 'var(--purple)', background: 'var(--bg-1)' }}>RSI(14)</div>
          <div ref={rsiRef} style={{ height: 100 }} />
        </div>
      )}

      {/* MACD Pane */}
      {activeIndicators.macd && (
        <div className="flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="px-2 py-0.5 text-[8px] font-bold" style={{ color: 'var(--blue)', background: 'var(--bg-1)' }}>MACD(12,26,9)</div>
          <div ref={macdRef} style={{ height: 100 }} />
        </div>
      )}
    </div>
  )
}

export { TIMEFRAMES }
export type { Timeframe, SignalMarker, TradeMarker }
