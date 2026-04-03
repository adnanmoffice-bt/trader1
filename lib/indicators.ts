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

// ─── Signal Scoring ───────────────────────────────────────────────────────────

/** Returns a 0–100 technical score and suggested direction */
export function technicalScore(ind: Indicators): { score: number; bias: 'long' | 'short' | 'neutral' } {
  let bullPoints = 0
  let bearPoints = 0

  // RSI
  if (ind.rsi < 30) bullPoints += 20
  else if (ind.rsi < 45) bullPoints += 10
  else if (ind.rsi > 70) bearPoints += 20
  else if (ind.rsi > 55) bearPoints += 10

  // MACD
  if (ind.macd.histogram > 0) bullPoints += 15
  else bearPoints += 15
  if (ind.macd.value > ind.macd.signal) bullPoints += 10
  else bearPoints += 10

  // Bollinger
  if (ind.bb.percentB < 0.2) bullPoints += 15  // oversold
  else if (ind.bb.percentB > 0.8) bearPoints += 15  // overbought

  // EMA trend
  if (ind.current_price > ind.ema_20 && ind.ema_20 > ind.ema_50) bullPoints += 20
  else if (ind.current_price < ind.ema_20 && ind.ema_20 < ind.ema_50) bearPoints += 20

  // Volume confirmation
  if (ind.volume_ratio > 1.5) {
    if (bullPoints > bearPoints) bullPoints += 10
    else bearPoints += 10
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

function round(n: number): number {
  return Math.round(n * 100) / 100
}
