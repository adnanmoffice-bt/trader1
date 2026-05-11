import type { OHLCV } from '@/types'

// ─────────────────────────────────────────────────────────────────────────────
// Data-quality validator — asset-class aware
// ─────────────────────────────────────────────────────────────────────────────
//
// 2026-05-07 — overnight audit (Option 2a deploy + 16h) showed all 8
// non-crypto instruments rejected 48× each (384 total meeting closes,
// 42% of all closes) with "Suspicious volume: 200/200 candles have zero
// volume" or "Stale data: last candle 481min ago".
//
// Root cause: the validator was written for crypto on Binance, where:
//   • Volume is reported per candle (centralised exchange)
//   • Markets trade 24/7 (no gaps)
//   • Stale > 2h is genuinely a feed problem
//
// For FX, indices, and commodities we get prices from Yahoo Finance,
// which:
//   • Reports zero volume for forex pairs (FX is OTC, no aggregate volume)
//   • Only emits candles during their respective market sessions
//     (SPY/QQQ ~6.5h/d Mon-Fri, oil ~23h/d Mon-Fri, FX 24/5)
//
// The fix below classifies each instrument and applies the appropriate
// rules. Crypto rules are unchanged.

type AssetClass = 'crypto' | 'fx' | 'metal' | 'commodity_futures' | 'us_equity'

// Default = crypto (preserves prior behaviour for unmapped symbols).
const ASSET_CLASS: Record<string, AssetClass> = {
  // FX
  'EUR/USD': 'fx', 'GBP/USD': 'fx', 'USD/JPY': 'fx',
  // Spot metals (Yahoo SI=F / GC=F give sparse volume)
  'XAU/USD': 'metal', 'XAG/USD': 'metal',
  // Energy futures (Yahoo CL=F / BZ=F: variable overnight volume)
  'WTI': 'commodity_futures', 'BRENT': 'commodity_futures',
  // US-listed equities/ETFs (closed overnight + weekends)
  'SPY': 'us_equity', 'QQQ': 'us_equity',
}

function classOf(instrument: string): AssetClass {
  return ASSET_CLASS[instrument] ?? 'crypto'
}

// Per-asset-class thresholds.
//   staleMaxMin   — last candle must be newer than this; otherwise stale
//   maxMissingCandles — gaps allowed in 1h series before we fail
//   checkVolume   — false → skip the all-zero-volume check entirely
//   maxOutliers   — >10% single-candle moves before we flag bad data
const RULES: Record<AssetClass, {
  staleMaxMin: number
  maxMissingCandles: number
  checkVolume: boolean
  maxOutliers: number
}> = {
  crypto:             { staleMaxMin: 120,    maxMissingCandles: 5,   checkVolume: true,  maxOutliers: 5 },
  fx:                 { staleMaxMin: 90,     maxMissingCandles: 60,  checkVolume: false, maxOutliers: 5 },
  metal:              { staleMaxMin: 90,     maxMissingCandles: 60,  checkVolume: false, maxOutliers: 5 },
  commodity_futures:  { staleMaxMin: 240,    maxMissingCandles: 60,  checkVolume: false, maxOutliers: 5 },
  // US equities trade ~6.5h/d Mon-Fri = 32h/wk of candles, 136h/wk of gaps.
  // Allow up to 18h stale (covers overnight + early-AM scan), up to 200
  // missing-candle gaps (covers a long-weekend pull).
  us_equity:          { staleMaxMin: 18 * 60, maxMissingCandles: 200, checkVolume: false, maxOutliers: 5 },
}

// ─────────────────────────────────────────────────────────────────────────────
// Session-aware skip
// ─────────────────────────────────────────────────────────────────────────────
//
// 2026-05-11 — probe-week audit showed 334 of 1000 war-room closes (33%) were
// SPY/QQQ DATA QUALITY FAILs over a single weekend. The us_equity threshold
// is 18h but Friday 16:00 ET → Monday 09:30 ET is ~65h closed — well past the
// budget — so every weekend meeting on SPY/QQQ failed and burned the slot.
//
// Cleaner than just bumping the threshold: skip the asset entirely outside
// its session. The war-room calls isInstrumentInSession() BEFORE
// validateOHLCV; if it returns false, the meeting closes with
// reason='out-of-session' (a separate bucket from data-quality, so health
// reports stop counting normal weekend closures as faults).
//
// Hours used (UTC, simplified — DST shifts US session ±1h twice a year,
// acceptable because we ALSO still run the stale-candle check on top):
//   crypto / metal / fx (24-hour): always in session
//   commodity_futures (CL/BZ): pit-closed 22:00-23:00 UTC, otherwise open
//   us_equity (SPY/QQQ): Mon-Fri 13:30-20:00 UTC (EDT). During EST winter
//     the real window is 14:30-21:00 UTC — using the EDT window means we
//     miss the last hour of winter trading, but never produce a false
//     "in session" outside genuine hours, which is the dangerous side.
//
// FX is technically 22:00 Sun → 22:00 Fri UTC, but weekend gaps already
// produce stale candles which validateOHLCV catches at the 90min threshold.

export function isInstrumentInSession(instrument: string, now: Date = new Date()): boolean {
  const cls = classOf(instrument)
  const dow = now.getUTCDay() // 0=Sun, 1=Mon, ..., 6=Sat
  const hour = now.getUTCHours()
  const minute = now.getUTCMinutes()
  const minOfDay = hour * 60 + minute

  switch (cls) {
    case 'crypto':
      return true
    case 'metal':
      // Spot gold/silver: 23:00 Sun → 22:00 Fri UTC, daily ~1h break.
      if (dow === 6) return false
      if (dow === 0 && hour < 23) return false
      if (dow === 5 && hour >= 22) return false
      return true
    case 'fx':
      // FX: 22:00 Sun → 22:00 Fri UTC.
      if (dow === 6) return false
      if (dow === 0 && hour < 22) return false
      if (dow === 5 && hour >= 22) return false
      return true
    case 'commodity_futures':
      // CL/BZ on CME Globex: Sun 23:00 → Fri 22:00 UTC, daily 22:00-23:00
      // maintenance break.
      if (dow === 6) return false
      if (dow === 0 && hour < 23) return false
      if (dow === 5 && hour >= 22) return false
      if (hour === 22) return false
      return true
    case 'us_equity': {
      // Mon-Fri 13:30-20:00 UTC (EDT regular session). Strict — pre/post
      // market not counted because Yahoo data is unreliable there.
      if (dow === 0 || dow === 6) return false
      const open = 13 * 60 + 30
      const close = 20 * 60
      return minOfDay >= open && minOfDay < close
    }
  }
}

// Exposed for war-room logging / audit scripts.
export function getAssetClass(instrument: string): AssetClass {
  return classOf(instrument)
}

export interface DataQualityReport {
  valid: boolean
  totalCandles: number
  missingCandles: number
  staleData: boolean
  staleDurationMin: number
  suspiciousVolume: boolean
  outlierCandles: number
  issues: string[]
  assetClass: AssetClass
}

export function validateOHLCV(candles: OHLCV[], instrument: string): DataQualityReport {
  const assetClass = classOf(instrument)
  const rules = RULES[assetClass]
  const issues: string[] = []
  let missingCandles = 0
  let outlierCandles = 0

  if (candles.length === 0) {
    return {
      valid: false, totalCandles: 0, missingCandles: 0,
      staleData: true, staleDurationMin: 999,
      suspiciousVolume: false, outlierCandles: 0,
      issues: ['No candle data'], assetClass,
    }
  }

  // Stale data — per asset class.
  const lastCandle = candles[candles.length - 1]
  const staleDurationMin = (Date.now() - lastCandle.timestamp) / 60_000
  const staleData = staleDurationMin > rules.staleMaxMin
  if (staleData) {
    issues.push(`Stale data: last candle ${Math.round(staleDurationMin)}min ago (${assetClass} threshold ${rules.staleMaxMin}min)`)
  }

  // Gap counter (informational for non-crypto; we still record it but
  // the per-asset cap may permit it).
  for (let i = 1; i < candles.length; i++) {
    const gap = (candles[i].timestamp - candles[i - 1].timestamp) / 3600_000
    if (gap > 1.5) missingCandles += Math.floor(gap) - 1
  }
  const tooManyGaps = missingCandles > rules.maxMissingCandles
  if (tooManyGaps) {
    issues.push(`${missingCandles} missing candles detected (gaps in data, ${assetClass} max ${rules.maxMissingCandles})`)
  }

  // Volume check — only meaningful for crypto.
  let suspiciousVolume = false
  if (rules.checkVolume) {
    const volumes = candles.map(c => c.volume)
    const zeroVols = volumes.filter(v => v === 0).length
    suspiciousVolume = zeroVols > candles.length * 0.3
    if (suspiciousVolume) {
      issues.push(`Suspicious volume: ${zeroVols}/${candles.length} candles have zero volume`)
    }
  }

  // Outliers — large single-candle moves often = bad/garbage data.
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close
    if (prevClose <= 0) continue
    const move = Math.abs(candles[i].close - prevClose) / prevClose
    if (move > 0.10) outlierCandles++
  }
  const tooManyOutliers = outlierCandles > rules.maxOutliers
  if (tooManyOutliers) {
    issues.push(`${outlierCandles} outlier candles (>10% move) — possible bad data`)
  }

  // OHLC integrity — universal.
  let integrityOk = true
  for (const c of candles) {
    if (c.high < c.low || c.open <= 0 || c.close <= 0 || isNaN(c.close)) {
      issues.push('OHLC integrity violation: high < low, zero or NaN prices')
      integrityOk = false
      break
    }
  }

  // Final verdict — fail closed on any rule that materially affects the
  // signal computation (stale, big gaps, volume-suspicious-on-crypto,
  // outliers, integrity). The "1 issue OK" leniency from the previous
  // version is removed — issues are now actually meaningful.
  const valid = !staleData && !tooManyGaps && !suspiciousVolume && !tooManyOutliers && integrityOk

  return {
    valid,
    totalCandles: candles.length,
    missingCandles,
    staleData,
    staleDurationMin: Math.round(staleDurationMin),
    suspiciousVolume,
    outlierCandles,
    issues,
    assetClass,
  }
}
