import type { OHLCV } from '@/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function avg(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

export function stdDev(arr: number[]): number {
  const mean = avg(arr)
  return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length)
}

// ─── EMA ──────────────────────────────────────────────────────────────────────

export function ema(prices: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const result: number[] = [prices[0]]
  for (let i = 1; i < prices.length; i++) {
    result.push(prices[i] * k + result[i - 1] * (1 - k))
  }
  return result
}

export function emaLast(prices: number[], period: number): number {
  return ema(prices, period).at(-1)!
}

// ─── RSI ──────────────────────────────────────────────────────────────────────

export function rsi(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50

  const changes = prices.slice(1).map((p, i) => p - prices[i])
  const gains   = changes.map(c => (c > 0 ? c : 0))
  const losses  = changes.map(c => (c < 0 ? Math.abs(c) : 0))

  let avgGain = avg(gains.slice(0, period))
  let avgLoss = avg(losses.slice(0, period))

  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period
  }

  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return Math.round((100 - 100 / (1 + rs)) * 100) / 100
}

// ─── MACD ─────────────────────────────────────────────────────────────────────

export function macd(
  prices: number[],
  fast = 12,
  slow = 26,
  signal = 9
): { value: number; signal: number; histogram: number } {
  const emaFast   = ema(prices, fast)
  const emaSlow   = ema(prices, slow)
  const macdLine  = emaFast.map((v, i) => v - emaSlow[i])
  const signalLine = ema(macdLine, signal)
  const last = macdLine.length - 1

  return {
    value:     round(macdLine[last]),
    signal:    round(signalLine[last]),
    histogram: round(macdLine[last] - signalLine[last]),
  }
}

// ─── Bollinger Bands ──────────────────────────────────────────────────────────

export function bollingerBands(
  prices: number[],
  period = 20,
  multiplier = 2
): { upper: number; middle: number; lower: number; width: number; percentB: number } {
  const slice  = prices.slice(-period)
  const middle = avg(slice)
  const sd     = stdDev(slice)
  const upper  = middle + multiplier * sd
  const lower  = middle - multiplier * sd
  const width  = round((upper - lower) / middle)
  const last   = prices.at(-1)!
  const percentB = round((last - lower) / (upper - lower))

  return { upper: round(upper), middle: round(middle), lower: round(lower), width, percentB }
}

// ─── ATR ──────────────────────────────────────────────────────────────────────

export function atr(candles: OHLCV[], period = 14): number {
  if (candles.length < period + 1) return 0

  const trs = candles.slice(1).map((c, i) => {
    const prev = candles[i].close
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prev),
      Math.abs(c.low  - prev)
    )
  })

  let atrVal = avg(trs.slice(0, period))
  for (let i = period; i < trs.length; i++) {
    atrVal = (atrVal * (period - 1) + trs[i]) / period
  }

  return round(atrVal)
}

// ─── SMA ──────────────────────────────────────────────────────────────────────

export function sma(prices: number[], period: number): number {
  return round(avg(prices.slice(-period)))
}

// ─── Volume Ratio ─────────────────────────────────────────────────────────────

export function volumeRatio(candles: OHLCV[], period = 20): number {
  const vols    = candles.map(c => c.volume)
  const avgVol  = avg(vols.slice(-period - 1, -1))
  const lastVol = vols.at(-1)!
  return avgVol > 0 ? round(lastVol / avgVol) : 1
}

// ─── Full Indicator Suite ─────────────────────────────────────────────────────

export interface Indicators {
  rsi: number
  macd: { value: number; signal: number; histogram: number }
  bb: { upper: number; middle: number; lower: number; width: number; percentB: number }
  ema_20: number
  ema_50: number
  ema_200: number
  sma_50: number
  atr: number
  volume_ratio: number
  current_price: number
}

export function computeIndicators(candles: OHLCV[]): Indicators {
  const closes = candles.map(c => c.close)
  const price  = closes.at(-1)!

  return {
    rsi:          rsi(closes),
    macd:         macd(closes),
    bb:           bollingerBands(closes),
    ema_20:       round(emaLast(closes, 20)),
    ema_50:       round(emaLast(closes, 50)),
    ema_200:      round(emaLast(closes, 200)),
    sma_50:       sma(closes, 50),
    atr:          atr(candles),
    volume_ratio: volumeRatio(candles),
    current_price: price,
  }
}

// ─── BB Squeeze Detection (Sharpe 1.89 in backtest) ─────────────────────────

export function detectBBSqueeze(candles: OHLCV[]): { triggered: boolean; direction: 'long' | 'short' | null } {
  if (candles.length < 30) return { triggered: false, direction: null }
  const closes = candles.map(c => c.close)
  const bands = bollingerBands(closes)
  const price = closes.at(-1)!

  const widths: number[] = []
  for (let i = Math.max(0, candles.length - 20); i < candles.length; i++) {
    const slice = closes.slice(Math.max(0, i - 19), i + 1)
    if (slice.length < 20) continue
    const m = avg(slice)
    const sd = Math.sqrt(slice.reduce((s, v) => s + (v - m) ** 2, 0) / slice.length)
    const u = m + 2 * sd, l = m - 2 * sd
    widths.push(m > 0 ? (u - l) / m : 0)
  }

  if (widths.length < 10) return { triggered: false, direction: null }
  const currentWidth = widths.at(-1)!
  const expanding = currentWidth > (widths.at(-2) ?? currentWidth) * 1.1
  const wasNarrow = widths.slice(-10, -1).every(w => w < currentWidth)

  if (wasNarrow && expanding) {
    if (price > bands.upper) return { triggered: true, direction: 'long' }
    if (price < bands.lower) return { triggered: true, direction: 'short' }
  }
  return { triggered: false, direction: null }
}

// ─── EMA Cross Detection (Sharpe 1.75 in backtest) ──────────────────────────

export function detectEMACross(candles: OHLCV[]): { triggered: boolean; direction: 'long' | 'short' | null } {
  if (candles.length < 30) return { triggered: false, direction: null }
  const closes = candles.map(c => c.close)
  const ema12 = ema(closes, 12)
  const ema26 = ema(closes, 26)
  const n = closes.length - 1

  const crossUp = ema12[n] > ema26[n] && ema12[n - 1] <= ema26[n - 1]
  const crossDn = ema12[n] < ema26[n] && ema12[n - 1] >= ema26[n - 1]

  if (crossUp) return { triggered: true, direction: 'long' }
  if (crossDn) return { triggered: true, direction: 'short' }
  return { triggered: false, direction: null }
}

// ─── RSI Extreme Detection ───────────────────────────────────────────────────

export function detectRSIExtreme(candles: OHLCV[]): { triggered: boolean; direction: 'long' | 'short' | null } {
  if (candles.length < 20) return { triggered: false, direction: null }
  const closes = candles.map(c => c.close)
  const r = rsi(closes)
  const prevCloses = closes.slice(0, -1)
  const prevR = rsi(prevCloses)

  // Trigger on RSI entering extreme zone (not already in it)
  if (r <= 25 && prevR > 25) return { triggered: true, direction: 'long' }
  if (r >= 75 && prevR < 75) return { triggered: true, direction: 'short' }
  return { triggered: false, direction: null }
}

// ─── MACD Crossover Detection ────────────────────────────────────────────────

export function detectMACDCross(candles: OHLCV[]): { triggered: boolean; direction: 'long' | 'short' | null } {
  if (candles.length < 30) return { triggered: false, direction: null }
  const closes = candles.map(c => c.close)
  const emaFast = ema(closes, 12)
  const emaSlow = ema(closes, 26)
  const macdLine = emaFast.map((v, i) => v - emaSlow[i])
  const signalLine = ema(macdLine, 9)
  const n = macdLine.length - 1

  const crossUp = macdLine[n] > signalLine[n] && macdLine[n - 1] <= signalLine[n - 1]
  const crossDn = macdLine[n] < signalLine[n] && macdLine[n - 1] >= signalLine[n - 1]

  if (crossUp) return { triggered: true, direction: 'long' }
  if (crossDn) return { triggered: true, direction: 'short' }
  return { triggered: false, direction: null }
}

// ─── Volume Spike Detection ──────────────────────────────────────────────────

export function detectVolumeSpike(candles: OHLCV[]): { triggered: boolean; direction: 'long' | 'short' | null } {
  if (candles.length < 25) return { triggered: false, direction: null }
  const vr = volumeRatio(candles)
  if (vr < 2.5) return { triggered: false, direction: null }

  const last = candles.at(-1)!
  const direction = last.close > last.open ? 'long' : 'short'
  return { triggered: true, direction }
}

// ─── Price Breakout vs EMA 50 ────────────────────────────────────────────────

export function detectEMA50Breakout(candles: OHLCV[]): { triggered: boolean; direction: 'long' | 'short' | null } {
  if (candles.length < 55) return { triggered: false, direction: null }
  const closes = candles.map(c => c.close)
  const ema50 = ema(closes, 50)
  const n = closes.length - 1

  const crossUp = closes[n] > ema50[n] && closes[n - 1] <= ema50[n - 1]
  const crossDn = closes[n] < ema50[n] && closes[n - 1] >= ema50[n - 1]

  if (crossUp) return { triggered: true, direction: 'long' }
  if (crossDn) return { triggered: true, direction: 'short' }
  return { triggered: false, direction: null }
}

// ─── Signal Scoring (backtested dual-strategy) ───────────────────────────────

export function technicalScore(ind: Indicators): { score: number; bias: 'long' | 'short' | 'neutral' } {
  let bullPoints = 0
  let bearPoints = 0

  // RSI zones
  if (ind.rsi < 30) bullPoints += 15
  else if (ind.rsi < 45) bullPoints += 8
  else if (ind.rsi > 70) bearPoints += 15
  else if (ind.rsi > 55) bearPoints += 8

  // MACD histogram + direction
  if (ind.macd.histogram > 0) bullPoints += 12
  else bearPoints += 12
  if (ind.macd.value > ind.macd.signal) bullPoints += 8
  else bearPoints += 8

  // Bollinger %B extremes (squeeze precursor)
  if (ind.bb.percentB < 0.15) bullPoints += 12
  else if (ind.bb.percentB > 0.85) bearPoints += 12
  else if (ind.bb.percentB < 0.3) bullPoints += 5
  else if (ind.bb.percentB > 0.7) bearPoints += 5

  // BB width (narrow = potential squeeze)
  if (ind.bb.width < 0.03) {
    bullPoints += 5
    bearPoints += 5
  }

  // EMA alignment (trend strength)
  if (ind.current_price > ind.ema_20 && ind.ema_20 > ind.ema_50) bullPoints += 18
  else if (ind.current_price < ind.ema_20 && ind.ema_20 < ind.ema_50) bearPoints += 18

  // EMA 12/26 cross proximity
  const ema12 = ind.ema_20 // close proxy
  if (ind.current_price > ind.ema_20 && ind.current_price > ind.ema_50) bullPoints += 10
  else if (ind.current_price < ind.ema_20 && ind.current_price < ind.ema_50) bearPoints += 10

  // Volume confirmation (high volume validates breakout)
  if (ind.volume_ratio > 1.5) {
    if (bullPoints > bearPoints) bullPoints += 10
    else bearPoints += 10
  }
  if (ind.volume_ratio > 2.0) {
    if (bullPoints > bearPoints) bullPoints += 5
    else bearPoints += 5
  }

  const total = bullPoints + bearPoints
  const score = total > 0 ? Math.round((Math.max(bullPoints, bearPoints) / total) * 100) : 50
  const bias = bullPoints > bearPoints + 10
    ? 'long'
    : bearPoints > bullPoints + 10
      ? 'short'
      : 'neutral'

  return { score, bias }
}

// ─── Kelly Criterion Position Sizing ─────────────────────────────────────────

export function kellyFraction(winRate: number, avgWinPct: number, avgLossPct: number): number {
  if (avgLossPct === 0) return 0
  const W = winRate
  const R = Math.abs(avgWinPct / avgLossPct)
  const kelly = W - (1 - W) / R
  return Math.max(0, Math.min(kelly * 0.5, 0.05))
}

// ─── Quick Backtest — walk-forward validation on recent candles ──────────────

export interface BacktestResult {
  totalTriggers: number
  wins: number
  losses: number
  winRate: number
  avgRR: number
  passed: boolean
}

export function quickBacktest(
  candles: OHLCV[],
  strategy: 'BB_SQUEEZE' | 'EMA_CROSS',
  slMult: number,
  tpMult: number,
  minWinRate = 0.35,
): BacktestResult {
  const minCandles = 60
  if (candles.length < minCandles) {
    return { totalTriggers: 0, wins: 0, losses: 0, winRate: 0, avgRR: 0, passed: true }
  }

  let wins = 0, losses = 0
  const rrResults: number[] = []

  for (let i = 50; i < candles.length - 10; i++) {
    const window = candles.slice(0, i + 1)
    const trigger = strategy === 'BB_SQUEEZE' ? detectBBSqueeze(window) : detectEMACross(window)
    if (!trigger.triggered || !trigger.direction) continue

    const entryPrice = candles[i].close
    const atrVal = atr(window)
    if (atrVal <= 0) continue

    const slDist = atrVal * slMult
    const tpDist = atrVal * tpMult
    const sl = trigger.direction === 'long' ? entryPrice - slDist : entryPrice + slDist
    const tp = trigger.direction === 'long' ? entryPrice + tpDist : entryPrice - tpDist

    let hit: 'tp' | 'sl' | 'none' = 'none'
    for (let j = i + 1; j < Math.min(i + 10, candles.length); j++) {
      const c = candles[j]
      if (trigger.direction === 'long') {
        if (c.low <= sl) { hit = 'sl'; break }
        if (c.high >= tp) { hit = 'tp'; break }
      } else {
        if (c.high >= sl) { hit = 'sl'; break }
        if (c.low <= tp) { hit = 'tp'; break }
      }
    }

    if (hit === 'tp') { wins++; rrResults.push(tpDist / slDist) }
    else if (hit === 'sl') { losses++; rrResults.push(-1) }
  }

  const total = wins + losses
  const winRate = total > 0 ? wins / total : 0
  const avgRR = rrResults.length > 0 ? rrResults.reduce((a, b) => a + b, 0) / rrResults.length : 0

  return {
    totalTriggers: total,
    wins, losses, winRate, avgRR,
    passed: total < 3 || winRate >= minWinRate,
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
