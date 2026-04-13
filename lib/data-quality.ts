import type { OHLCV } from '@/types'

export interface DataQualityReport {
  valid: boolean
  totalCandles: number
  missingCandles: number
  staleData: boolean
  staleDurationMin: number
  suspiciousVolume: boolean
  outlierCandles: number
  issues: string[]
}

export function validateOHLCV(candles: OHLCV[], instrument: string): DataQualityReport {
  const issues: string[] = []
  let missingCandles = 0
  let outlierCandles = 0

  if (candles.length === 0) {
    return { valid: false, totalCandles: 0, missingCandles: 0, staleData: true, staleDurationMin: 999, suspiciousVolume: false, outlierCandles: 0, issues: ['No candle data'] }
  }

  // Check for stale data
  const lastCandle = candles[candles.length - 1]
  const staleDurationMin = (Date.now() - lastCandle.timestamp) / 60_000
  const staleData = staleDurationMin > 120 // 2 hours old

  if (staleData) {
    issues.push(`Stale data: last candle ${Math.round(staleDurationMin)}min ago`)
  }

  // Check for gaps (missing candles in 1h data)
  for (let i = 1; i < candles.length; i++) {
    const gap = (candles[i].timestamp - candles[i - 1].timestamp) / 3600_000
    if (gap > 1.5) { // More than 1.5 hours between 1h candles
      missingCandles += Math.floor(gap) - 1
    }
  }

  if (missingCandles > 0) {
    issues.push(`${missingCandles} missing candles detected (gaps in data)`)
  }

  // Check for suspicious volume (all zeros or extreme spikes)
  const volumes = candles.map(c => c.volume)
  const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length
  const zeroVols = volumes.filter(v => v === 0).length
  const suspiciousVolume = zeroVols > candles.length * 0.3 // >30% zero volume

  if (suspiciousVolume) {
    issues.push(`Suspicious volume: ${zeroVols}/${candles.length} candles have zero volume`)
  }

  // Check for outlier candles (price moves > 10% in single candle)
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close
    const move = Math.abs(candles[i].close - prevClose) / prevClose
    if (move > 0.10) {
      outlierCandles++
    }
  }

  if (outlierCandles > 3) {
    issues.push(`${outlierCandles} outlier candles (>10% move) — possible bad data`)
  }

  // Check OHLC integrity
  for (const c of candles) {
    if (c.high < c.low || c.open <= 0 || c.close <= 0 || isNaN(c.close)) {
      issues.push('OHLC integrity violation: high < low, zero or NaN prices')
      break
    }
  }

  const valid = !staleData && missingCandles < 5 && !suspiciousVolume && outlierCandles < 5 && issues.length <= 1

  return {
    valid,
    totalCandles: candles.length,
    missingCandles,
    staleData,
    staleDurationMin: Math.round(staleDurationMin),
    suspiciousVolume,
    outlierCandles,
    issues,
  }
}
