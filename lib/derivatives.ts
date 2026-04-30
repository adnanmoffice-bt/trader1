/**
 * Binance USDT-M perpetual derivatives data.
 *
 * Even though APEX trades Spot, perp-futures data is the cleanest live
 * "smart money positioning" signal that exists for crypto:
 *
 *   - Funding rate: when persistent and positive, longs are paying shorts
 *     to keep their position open → over-crowded long → flush risk peaks.
 *   - Open Interest delta: rising OI on rising price = healthy trend.
 *     Rising OI on falling price = trend continuation lower.
 *   - Top trader long/short ratio: institutional positioning.
 *   - Retail (global account) long/short ratio: extreme retail-long is
 *     where liquidation cascades start.
 *
 * All endpoints are unauthenticated public APIs on `fapi.binance.com`.
 * This module FAILS OPEN: any HTTP error returns null and the war-room
 * gate that consumes it must treat null as "no veto, no boost".
 *
 * Cache TTL: 5 minutes per instrument (Vercel `next.revalidate`).
 */

import type { Instrument } from '@/types'

const FAPI = 'https://fapi.binance.com'

/**
 * Map our Instrument labels to Binance USDT-M perp symbols.
 * Returns null for instruments that have no liquid perp (gold, blacklisted alts).
 */
function toPerpSymbol(instrument: Instrument): string | null {
  const map: Partial<Record<Instrument, string>> = {
    'BTC/USD': 'BTCUSDT',
    'ETH/USD': 'ETHUSDT',
    'DOGE/USD': 'DOGEUSDT',
    'AVAX/USD': 'AVAXUSDT',
    'LINK/USD': 'LINKUSDT',
    'ADA/USD': 'ADAUSDT',
    'DOT/USD': 'DOTUSDT',
    'MATIC/USD': 'POLUSDT',  // POL = renamed MATIC perp on Binance
    'NEAR/USD': 'NEARUSDT',
    'APT/USD': 'APTUSDT',
  }
  return map[instrument] ?? null
}

export interface DerivativesSnapshot {
  symbol: string
  fundingRate8h: number       // last settled 8h funding rate (e.g. 0.0001 = 0.01%)
  fundingRateAvg7d: number    // mean of last 21 funding rates ≈ 7 days
  openInterestUsd: number     // current OI in USD
  openInterestDeltaPct4h: number | null  // % change in OI over last ~4h
  /** retail long/short account ratio. >1 = more retail accounts long than short. */
  retailLongShortRatio: number | null
  /** top trader long/short position ratio. <1 = top traders net short. */
  topTraderLongShortRatio: number | null
  /** ISO timestamp of the snapshot fetch */
  fetchedAt: string
}

async function safeJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      next: { revalidate: 300 },
      headers: { 'User-Agent': 'apex-trading/1.0' },
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch { return null }
}

/**
 * Fetch a derivatives snapshot for the given instrument. Returns null if the
 * instrument has no perp symbol or all sub-fetches fail.
 */
export async function getDerivativesSnapshot(instrument: Instrument): Promise<DerivativesSnapshot | null> {
  const sym = toPerpSymbol(instrument)
  if (!sym) return null

  const [premium, fundingHist, oiHist, lsRetail, lsTopTrader] = await Promise.all([
    safeJson<{ symbol: string; markPrice: string; lastFundingRate: string }>(
      `${FAPI}/fapi/v1/premiumIndex?symbol=${sym}`,
    ),
    safeJson<Array<{ symbol: string; fundingRate: string; fundingTime: number }>>(
      `${FAPI}/fapi/v1/fundingRate?symbol=${sym}&limit=21`,
    ),
    // 4 hourly OI samples gives us a 4h delta
    safeJson<Array<{ symbol: string; sumOpenInterest: string; sumOpenInterestValue: string; timestamp: number }>>(
      `${FAPI}/futures/data/openInterestHist?symbol=${sym}&period=1h&limit=5`,
    ),
    safeJson<Array<{ symbol: string; longShortRatio: string; longAccount: string; shortAccount: string; timestamp: number }>>(
      `${FAPI}/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=1h&limit=1`,
    ),
    safeJson<Array<{ symbol: string; longShortRatio: string; longAccount: string; shortAccount: string; timestamp: number }>>(
      `${FAPI}/futures/data/topLongShortPositionRatio?symbol=${sym}&period=1h&limit=1`,
    ),
  ])

  if (!premium && !fundingHist) return null

  const lastFunding = premium?.lastFundingRate ? parseFloat(premium.lastFundingRate) : 0
  const fundingArr = (fundingHist ?? []).map(f => parseFloat(f.fundingRate))
  const fundingAvg = fundingArr.length > 0 ? fundingArr.reduce((a, b) => a + b, 0) / fundingArr.length : 0

  let oiNow = 0
  let oiDeltaPct: number | null = null
  if (oiHist && oiHist.length > 0) {
    const newest = oiHist[oiHist.length - 1]
    const oldest = oiHist[0]
    oiNow = parseFloat(newest.sumOpenInterestValue ?? '0')
    const oiOld = parseFloat(oldest.sumOpenInterestValue ?? '0')
    if (oiOld > 0) oiDeltaPct = ((oiNow - oiOld) / oiOld) * 100
  }

  const retail = lsRetail && lsRetail.length > 0 ? parseFloat(lsRetail[0].longShortRatio) : null
  const topTrader = lsTopTrader && lsTopTrader.length > 0 ? parseFloat(lsTopTrader[0].longShortRatio) : null

  return {
    symbol: sym,
    fundingRate8h: lastFunding,
    fundingRateAvg7d: fundingAvg,
    openInterestUsd: oiNow,
    openInterestDeltaPct4h: oiDeltaPct,
    retailLongShortRatio: retail,
    topTraderLongShortRatio: topTrader,
    fetchedAt: new Date().toISOString(),
  }
}

export interface DerivativesGateResult {
  allowed: boolean
  reason: string
  /** Conviction adjustment: +N (bull-favouring) or −N (bear-favouring). 0 means no signal. */
  convictionAdjust: number
}

/**
 * Apply derivative-data heuristics to a LONG entry. Returns:
 *   - hard veto if funding is extreme positive or retail is over-long
 *   - conviction boost (+10) if smart money confluence is positive
 *   - conviction cut (−10..−20) if mixed
 *
 * Fails open: if snap is null, returns allowed:true with 0 adjust.
 */
export function evaluateDerivativesForLong(snap: DerivativesSnapshot | null): DerivativesGateResult {
  if (!snap) return { allowed: true, reason: 'no derivatives data (skip)', convictionAdjust: 0 }

  // Funding rate is reported per 8h. > 0.05% per 8h ≈ 0.15% per day ≈ 55%/yr — clearly over-crowded longs.
  if (snap.fundingRate8h > 0.0005) {
    return {
      allowed: false,
      reason: `funding ${(snap.fundingRate8h * 100).toFixed(3)}%/8h — longs crowded, flush risk`,
      convictionAdjust: -25,
    }
  }

  // Retail very-long: classic liquidation-cascade setup before a flush.
  if (snap.retailLongShortRatio != null && snap.retailLongShortRatio > 2.5) {
    return {
      allowed: false,
      reason: `retail L/S ${snap.retailLongShortRatio.toFixed(2)} — extreme retail long bias, contrarian veto`,
      convictionAdjust: -20,
    }
  }

  let adjust = 0
  const notes: string[] = []

  // Slightly positive funding (0..0.0003) is normal in bull regime — neutral.
  // Negative funding while we want to LONG is FAVOURABLE (shorts paying premium).
  if (snap.fundingRate8h < -0.0001) {
    adjust += 8
    notes.push(`funding ${(snap.fundingRate8h * 100).toFixed(3)}% (shorts paying)`)
  } else if (snap.fundingRate8h > 0.0003) {
    adjust -= 8
    notes.push(`funding ${(snap.fundingRate8h * 100).toFixed(3)}% (longs paying)`)
  }

  // Open Interest direction
  if (snap.openInterestDeltaPct4h != null) {
    if (snap.openInterestDeltaPct4h > 2) {
      adjust += 6
      notes.push(`OI +${snap.openInterestDeltaPct4h.toFixed(1)}% (fresh longs)`)
    } else if (snap.openInterestDeltaPct4h < -2) {
      adjust -= 6
      notes.push(`OI ${snap.openInterestDeltaPct4h.toFixed(1)}% (longs unwinding)`)
    }
  }

  // Top traders short while retail long = fade retail.
  if (
    snap.topTraderLongShortRatio != null &&
    snap.retailLongShortRatio != null &&
    snap.topTraderLongShortRatio < 0.7 &&
    snap.retailLongShortRatio > 1.5
  ) {
    adjust -= 12
    notes.push(`top traders short (${snap.topTraderLongShortRatio.toFixed(2)}) vs retail long (${snap.retailLongShortRatio.toFixed(2)})`)
  } else if (
    snap.topTraderLongShortRatio != null &&
    snap.topTraderLongShortRatio > 1.3
  ) {
    adjust += 5
    notes.push(`top traders long (${snap.topTraderLongShortRatio.toFixed(2)})`)
  }

  return {
    allowed: true,
    reason: notes.length > 0 ? notes.join(', ') : 'derivatives neutral',
    convictionAdjust: adjust,
  }
}
