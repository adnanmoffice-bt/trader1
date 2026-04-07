/**
 * Quantitative Forecasting Engine
 *
 * Models: AR(p) autoregression, Exponential Smoothing, Monte Carlo (GBM),
 * Seasonality (hour-of-day / day-of-week), Rolling volatility regime detection.
 *
 * All models run on raw OHLCV data — no external ML libraries needed.
 */

import type { OHLCV } from '@/types'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ForecastResult {
  instrument: string
  currentPrice: number
  // Directional probabilities
  upProbability1h: number
  upProbability4h: number
  upProbability24h: number
  // ARIMA-style point forecast
  arimaForecast1h: number
  arimaForecast4h: number
  arimaDirection: 'bullish' | 'bearish' | 'neutral'
  // Monte Carlo percentiles (4h horizon)
  mc10: number
  mc25: number
  mc50: number
  mc75: number
  mc90: number
  mcMaxDrawdown: number
  // Seasonality
  hourBias: number
  dayBias: number
  seasonalDirection: 'bullish' | 'bearish' | 'neutral'
  // Volatility regime
  volRegime: 'low' | 'normal' | 'high' | 'extreme'
  currentVol: number
  avgVol: number
  volRatio: number
  // Exponential smoothing trend
  smoothedTrend: 'up' | 'down' | 'flat'
  smoothedSlope: number
  // Combined forecast
  combinedSignal: number // -100 to +100
  combinedLabel: string
}

// ─── AR(2) Autoregressive Model ──────────────────────────────────────────────

function arimaForecast(closes: number[], stepsAhead: number): number {
  if (closes.length < 20) return closes[closes.length - 1]

  // First difference the series (I in ARIMA)
  const diffs: number[] = []
  for (let i = 1; i < closes.length; i++) {
    diffs.push(closes[i] - closes[i - 1])
  }

  // Fit AR(2): diff[t] = c + a1*diff[t-1] + a2*diff[t-2]
  // Use least squares approximation
  const n = diffs.length
  if (n < 10) return closes[closes.length - 1]

  let sumX1Y = 0, sumX2Y = 0, sumX1X1 = 0, sumX2X2 = 0, sumX1X2 = 0, sumY = 0
  for (let i = 2; i < n; i++) {
    const y = diffs[i]
    const x1 = diffs[i - 1]
    const x2 = diffs[i - 2]
    sumX1Y += x1 * y
    sumX2Y += x2 * y
    sumX1X1 += x1 * x1
    sumX2X2 += x2 * x2
    sumX1X2 += x1 * x2
    sumY += y
  }
  const count = n - 2

  // Solve 2x2 system for a1, a2
  const det = sumX1X1 * sumX2X2 - sumX1X2 * sumX1X2
  if (Math.abs(det) < 1e-10) return closes[closes.length - 1]

  const a1 = (sumX2X2 * sumX1Y - sumX1X2 * sumX2Y) / det
  const a2 = (sumX1X1 * sumX2Y - sumX1X2 * sumX1Y) / det
  const c = sumY / count - a1 * sumX1Y / (count * (sumX1Y / sumY || 1))

  // Clamp coefficients to prevent explosive forecasts
  const ca1 = Math.max(-0.95, Math.min(0.95, a1))
  const ca2 = Math.max(-0.5, Math.min(0.5, a2))

  // Forecast forward
  const forecasted = [...diffs]
  for (let s = 0; s < stepsAhead; s++) {
    const len = forecasted.length
    const next = (c || 0) + ca1 * forecasted[len - 1] + ca2 * forecasted[len - 2]
    forecasted.push(next)
  }

  // Integrate back to price level
  let price = closes[closes.length - 1]
  for (let s = 0; s < stepsAhead; s++) {
    price += forecasted[diffs.length + s]
  }
  return price
}

// ─── Monte Carlo Simulation (Geometric Brownian Motion) ──────────────────────

function monteCarloSimulation(
  closes: number[],
  stepsAhead: number,
  numPaths = 500,
): { percentiles: number[]; maxDrawdown: number; upProb: number } {
  if (closes.length < 30) {
    const last = closes[closes.length - 1]
    return { percentiles: [last, last, last, last, last], maxDrawdown: 0, upProb: 0.5 }
  }

  // Calculate log returns
  const logReturns: number[] = []
  for (let i = 1; i < closes.length; i++) {
    logReturns.push(Math.log(closes[i] / closes[i - 1]))
  }

  const mu = logReturns.reduce((a, b) => a + b, 0) / logReturns.length
  const variance = logReturns.reduce((a, b) => a + (b - mu) ** 2, 0) / logReturns.length
  const sigma = Math.sqrt(variance)

  const S0 = closes[closes.length - 1]
  const finalPrices: number[] = []
  let maxDdSum = 0

  for (let p = 0; p < numPaths; p++) {
    let price = S0
    let peak = S0
    let maxDd = 0

    for (let t = 0; t < stepsAhead; t++) {
      // Box-Muller for normal random
      const u1 = Math.random()
      const u2 = Math.random()
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)

      const drift = (mu - 0.5 * variance)
      const diffusion = sigma * z
      price *= Math.exp(drift + diffusion)

      if (price > peak) peak = price
      const dd = (peak - price) / peak
      if (dd > maxDd) maxDd = dd
    }

    finalPrices.push(price)
    maxDdSum += maxDd
  }

  finalPrices.sort((a, b) => a - b)
  const pct = (p: number) => finalPrices[Math.floor(p * finalPrices.length)]

  const upCount = finalPrices.filter(p => p > S0).length
  return {
    percentiles: [pct(0.10), pct(0.25), pct(0.50), pct(0.75), pct(0.90)],
    maxDrawdown: maxDdSum / numPaths,
    upProb: upCount / numPaths,
  }
}

// ─── Seasonality Analysis ────────────────────────────────────────────────────

function analyzeSeasonality(candles: OHLCV[]): { hourBias: number; dayBias: number } {
  if (candles.length < 48) return { hourBias: 0, dayBias: 0 }

  const currentHour = new Date().getUTCHours()
  const currentDay = new Date().getUTCDay()

  // Hourly returns by hour-of-day
  const hourlyReturns: Record<number, number[]> = {}
  const dailyReturns: Record<number, number[]> = {}

  for (let i = 1; i < candles.length; i++) {
    const ret = (candles[i].close - candles[i - 1].close) / candles[i - 1].close
    const hour = new Date(candles[i].timestamp).getUTCHours()
    const day = new Date(candles[i].timestamp).getUTCDay()

    if (!hourlyReturns[hour]) hourlyReturns[hour] = []
    hourlyReturns[hour].push(ret)

    if (!dailyReturns[day]) dailyReturns[day] = []
    dailyReturns[day].push(ret)
  }

  const hourRets = hourlyReturns[currentHour] ?? []
  const hourBias = hourRets.length >= 5
    ? hourRets.reduce((a, b) => a + b, 0) / hourRets.length * 100
    : 0

  const dayRets = dailyReturns[currentDay] ?? []
  const dayBias = dayRets.length >= 3
    ? dayRets.reduce((a, b) => a + b, 0) / dayRets.length * 100
    : 0

  return { hourBias, dayBias }
}

// ─── Volatility Regime Detection ─────────────────────────────────────────────

function detectVolRegime(closes: number[], window = 20): {
  regime: ForecastResult['volRegime']; current: number; avg: number; ratio: number
} {
  if (closes.length < window * 2) {
    return { regime: 'normal', current: 0, avg: 0, ratio: 1 }
  }

  // Compute rolling standard deviation of returns
  const returns: number[] = []
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1])
  }

  const recentReturns = returns.slice(-window)
  const meanRecent = recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length
  const currentVol = Math.sqrt(recentReturns.reduce((a, b) => a + (b - meanRecent) ** 2, 0) / recentReturns.length)

  const allReturns = returns.slice(-window * 5)
  const meanAll = allReturns.reduce((a, b) => a + b, 0) / allReturns.length
  const avgVol = Math.sqrt(allReturns.reduce((a, b) => a + (b - meanAll) ** 2, 0) / allReturns.length)

  const ratio = avgVol > 0 ? currentVol / avgVol : 1

  let regime: ForecastResult['volRegime'] = 'normal'
  if (ratio > 2.0) regime = 'extreme'
  else if (ratio > 1.5) regime = 'high'
  else if (ratio < 0.6) regime = 'low'

  return { regime, current: currentVol, avg: avgVol, ratio }
}

// ─── Exponential Smoothing (Holt's double exponential for trend) ─────────────

function holtSmoothing(closes: number[], alpha = 0.3, beta = 0.1): {
  trend: 'up' | 'down' | 'flat'; slope: number; forecast: number
} {
  if (closes.length < 10) {
    return { trend: 'flat', slope: 0, forecast: closes[closes.length - 1] }
  }

  let level = closes[0]
  let trend = closes[1] - closes[0]

  for (let i = 1; i < closes.length; i++) {
    const prevLevel = level
    level = alpha * closes[i] + (1 - alpha) * (prevLevel + trend)
    trend = beta * (level - prevLevel) + (1 - beta) * trend
  }

  const slopeNorm = trend / closes[closes.length - 1] * 100
  const direction: 'up' | 'down' | 'flat' =
    slopeNorm > 0.05 ? 'up' : slopeNorm < -0.05 ? 'down' : 'flat'

  return { trend: direction, slope: slopeNorm, forecast: level + trend }
}

// ─── Main Forecast Builder ───────────────────────────────────────────────────

export function generateForecast(instrument: string, candles: OHLCV[]): ForecastResult {
  const closes = candles.map(c => c.close)
  const currentPrice = closes[closes.length - 1]

  // ARIMA forecasts
  const arima1h = arimaForecast(closes, 1)
  const arima4h = arimaForecast(closes, 4)
  const arimaDir: ForecastResult['arimaDirection'] =
    arima4h > currentPrice * 1.001 ? 'bullish' : arima4h < currentPrice * 0.999 ? 'bearish' : 'neutral'

  // Monte Carlo at different horizons
  const mc1h = monteCarloSimulation(closes, 1)
  const mc4h = monteCarloSimulation(closes, 4)
  const mc24h = monteCarloSimulation(closes, 24)

  // Seasonality
  const season = analyzeSeasonality(candles)
  const seasonDir: ForecastResult['seasonalDirection'] =
    (season.hourBias + season.dayBias) > 0.02 ? 'bullish' :
    (season.hourBias + season.dayBias) < -0.02 ? 'bearish' : 'neutral'

  // Volatility regime
  const vol = detectVolRegime(closes)

  // Holt exponential smoothing
  const holt = holtSmoothing(closes)

  // Combined signal: -100 (strong bearish) to +100 (strong bullish)
  let combined = 0

  // ARIMA weight: 25
  const arimaPct = ((arima4h - currentPrice) / currentPrice) * 100
  combined += Math.max(-25, Math.min(25, arimaPct * 50))

  // Monte Carlo weight: 30
  combined += (mc4h.upProb - 0.5) * 60

  // Seasonality weight: 15
  combined += Math.max(-15, Math.min(15, (season.hourBias + season.dayBias) * 100))

  // Holt trend weight: 20
  combined += Math.max(-20, Math.min(20, holt.slope * 40))

  // Volatility dampener: high vol → reduce conviction
  if (vol.regime === 'extreme') combined *= 0.5
  else if (vol.regime === 'high') combined *= 0.75

  combined = Math.max(-100, Math.min(100, Math.round(combined)))

  let label = 'NEUTRAL'
  if (combined >= 40) label = 'STRONG BULLISH'
  else if (combined >= 15) label = 'BULLISH'
  else if (combined <= -40) label = 'STRONG BEARISH'
  else if (combined <= -15) label = 'BEARISH'

  return {
    instrument,
    currentPrice,
    upProbability1h: +mc1h.upProb.toFixed(3),
    upProbability4h: +mc4h.upProb.toFixed(3),
    upProbability24h: +mc24h.upProb.toFixed(3),
    arimaForecast1h: +arima1h.toFixed(2),
    arimaForecast4h: +arima4h.toFixed(2),
    arimaDirection: arimaDir,
    mc10: +mc4h.percentiles[0].toFixed(2),
    mc25: +mc4h.percentiles[1].toFixed(2),
    mc50: +mc4h.percentiles[2].toFixed(2),
    mc75: +mc4h.percentiles[3].toFixed(2),
    mc90: +mc4h.percentiles[4].toFixed(2),
    mcMaxDrawdown: +mc4h.maxDrawdown.toFixed(4),
    hourBias: +season.hourBias.toFixed(4),
    dayBias: +season.dayBias.toFixed(4),
    seasonalDirection: seasonDir,
    volRegime: vol.regime,
    currentVol: +vol.current.toFixed(6),
    avgVol: +vol.avg.toFixed(6),
    volRatio: +vol.ratio.toFixed(2),
    smoothedTrend: holt.trend,
    smoothedSlope: +holt.slope.toFixed(4),
    combinedSignal: combined,
    combinedLabel: label,
  }
}

// ─── Human-readable forecast for agent prompts ───────────────────────────────

export function formatForecast(f: ForecastResult): string {
  const priceFmt = (n: number) =>
    n >= 10000 ? n.toLocaleString('en', { maximumFractionDigits: 0 }) : n >= 1 ? n.toFixed(2) : n.toFixed(4)

  return [
    `══ QUANTITATIVE FORECAST: ${f.instrument} ══`,
    '',
    `Combined Signal:    ${f.combinedSignal > 0 ? '+' : ''}${f.combinedSignal}/100 → ${f.combinedLabel}`,
    '',
    '── ARIMA Autoregression ──',
    `  1h forecast:      $${priceFmt(f.arimaForecast1h)} (${f.arimaForecast1h > f.currentPrice ? '↑' : '↓'} ${((f.arimaForecast1h - f.currentPrice) / f.currentPrice * 100).toFixed(2)}%)`,
    `  4h forecast:      $${priceFmt(f.arimaForecast4h)} (${f.arimaForecast4h > f.currentPrice ? '↑' : '↓'} ${((f.arimaForecast4h - f.currentPrice) / f.currentPrice * 100).toFixed(2)}%)`,
    `  Direction:        ${f.arimaDirection.toUpperCase()}`,
    '',
    '── Monte Carlo (500 paths, 4h) ──',
    `  P(up in 1h):      ${(f.upProbability1h * 100).toFixed(0)}%`,
    `  P(up in 4h):      ${(f.upProbability4h * 100).toFixed(0)}%`,
    `  P(up in 24h):     ${(f.upProbability24h * 100).toFixed(0)}%`,
    `  10th percentile:  $${priceFmt(f.mc10)}`,
    `  25th percentile:  $${priceFmt(f.mc25)}`,
    `  MEDIAN:           $${priceFmt(f.mc50)}`,
    `  75th percentile:  $${priceFmt(f.mc75)}`,
    `  90th percentile:  $${priceFmt(f.mc90)}`,
    `  Avg max drawdown: ${(f.mcMaxDrawdown * 100).toFixed(2)}%`,
    '',
    '── Seasonality ──',
    `  This hour bias:   ${f.hourBias >= 0 ? '+' : ''}${f.hourBias.toFixed(3)}% avg return`,
    `  This day bias:    ${f.dayBias >= 0 ? '+' : ''}${f.dayBias.toFixed(3)}% avg return`,
    `  Seasonal:         ${f.seasonalDirection.toUpperCase()}`,
    '',
    '── Volatility Regime ──',
    `  Current vol:      ${(f.currentVol * 100).toFixed(3)}%`,
    `  Average vol:      ${(f.avgVol * 100).toFixed(3)}%`,
    `  Vol ratio:        ${f.volRatio}x ${f.volRegime === 'extreme' ? '⚠️ EXTREME' : f.volRegime === 'high' ? '⚠️ HIGH' : ''}`,
    `  Regime:           ${f.volRegime.toUpperCase()}`,
    '',
    '── Exponential Smoothing ──',
    `  Trend:            ${f.smoothedTrend.toUpperCase()}`,
    `  Slope:            ${f.smoothedSlope >= 0 ? '+' : ''}${f.smoothedSlope.toFixed(3)}%/candle`,
    '',
  ].join('\n')
}
