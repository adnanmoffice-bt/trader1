// ─────────────────────────────────────────────────────────────────────────────
// PHASE D — MICROSTRUCTURE & SMART-MONEY-CONCEPT TRIGGERS (scaffold)
//
// The 180-day backtest verdict is unambiguous: indicator-based triggers
// (EMA cross, MACD, RSI extreme, BB squeeze, EMA50 break, volume spike) are
// edge-NEGATIVE on the current instrument set. Layering more gates on top of
// them keeps producing better-looking win rates with the same underlying
// expectancy problem.
//
// This file implements deterministic trigger primitives drawn from the SMC /
// ICT (Inner Circle Trader) literature and from market-microstructure
// research. They are NOT wired into agents/war-room.ts yet — operator should
// run scripts/explore-microstructure.mjs first against historical data and
// only promote the ones that show >0.20 R expectancy on a clean walk-forward
// split.
//
// Implemented:
//   - detectFairValueGap(): 3-candle gap pattern (high-probability draw on
//     liquidity, often filled within 24-48h)
//   - detectOrderBlocks(): last opposite candle before a displacement move
//     — zone often acts as support/resistance on retest
//   - computeVolumeProfile(): VPVR-style point-of-control + value area
//   - detectLiquiditySweep(): false break of recent swing high/low
//   - detectBreakOfStructure(): higher-high or lower-low confirmation
//   - detectChangeOfCharacter(): trend-flip break of last impulsive leg
//
// All functions are pure (input -> output, no I/O), fully synchronous, and
// fail-open in their gate forms (a malformed input returns "no signal").
// ─────────────────────────────────────────────────────────────────────────────

import type { OHLCV } from '@/types'

// ── FAIR VALUE GAP (FVG) ────────────────────────────────────────────────────
// Three-candle imbalance left by displacement. Often acts as a magnet — price
// tends to return and "fill" the gap before continuing.
//
// Bullish FVG: candle[i+2].low > candle[i].high  (gap between candle 1 high
//   and candle 3 low). Active until candle[j].low <= candle[i].high.
// Bearish FVG: candle[i+2].high < candle[i].low

export interface FairValueGap {
  type: 'bullish' | 'bearish'
  startIdx: number      // index of candle[i] (the candle whose wick defines one boundary)
  zoneTop: number       // upper boundary of the gap
  zoneBottom: number    // lower boundary of the gap
  size: number          // zoneTop - zoneBottom (in price)
  sizePct: number       // size / midPrice * 100
  filled: boolean       // any subsequent candle traded back into the gap?
  filledAtIdx: number | null
  ageBars: number       // bars elapsed since gap formed (current end of array - startIdx - 2)
}

export function detectFairValueGaps(ohlcv: OHLCV[], lookback = 100): FairValueGap[] {
  const out: FairValueGap[] = []
  if (ohlcv.length < 3) return out
  const start = Math.max(0, ohlcv.length - lookback)
  for (let i = start; i < ohlcv.length - 2; i++) {
    const a = ohlcv[i], c = ohlcv[i + 2]
    // Bullish FVG: a.high < c.low
    if (a.high < c.low) {
      const zoneTop = c.low
      const zoneBottom = a.high
      const size = zoneTop - zoneBottom
      const mid = (zoneTop + zoneBottom) / 2
      let filled = false
      let filledAt: number | null = null
      for (let j = i + 3; j < ohlcv.length; j++) {
        if (ohlcv[j].low <= zoneBottom) { filled = true; filledAt = j; break }
      }
      out.push({
        type: 'bullish', startIdx: i, zoneTop, zoneBottom, size,
        sizePct: (size / mid) * 100, filled, filledAtIdx: filledAt,
        ageBars: ohlcv.length - 1 - (i + 2),
      })
    }
    // Bearish FVG: a.low > c.high
    if (a.low > c.high) {
      const zoneTop = a.low
      const zoneBottom = c.high
      const size = zoneTop - zoneBottom
      const mid = (zoneTop + zoneBottom) / 2
      let filled = false
      let filledAt: number | null = null
      for (let j = i + 3; j < ohlcv.length; j++) {
        if (ohlcv[j].high >= zoneTop) { filled = true; filledAt = j; break }
      }
      out.push({
        type: 'bearish', startIdx: i, zoneTop, zoneBottom, size,
        sizePct: (size / mid) * 100, filled, filledAtIdx: filledAt,
        ageBars: ohlcv.length - 1 - (i + 2),
      })
    }
  }
  return out
}

// Convenience: list the still-open (unfilled) FVGs near current price.
// Returns the closest 3 above and 3 below — these are the highest-probability
// magnets for the next 24-48h leg.
export function findNearestUnfilledFVGs(ohlcv: OHLCV[], n = 3): { above: FairValueGap[]; below: FairValueGap[] } {
  const all = detectFairValueGaps(ohlcv, 200).filter(g => !g.filled)
  const last = ohlcv[ohlcv.length - 1].close
  const above = all.filter(g => g.zoneBottom >= last).sort((a, b) => a.zoneBottom - b.zoneBottom).slice(0, n)
  const below = all.filter(g => g.zoneTop <= last).sort((a, b) => b.zoneTop - a.zoneTop).slice(0, n)
  return { above, below }
}

// ── ORDER BLOCKS (OB) ───────────────────────────────────────────────────────
// Bullish order block = last bearish (down-close) candle before a strong
// up-move that breaks recent structure. The body is the OB zone; future
// retest of that zone is a high-probability long.
//
// Bearish order block = last bullish (up-close) candle before a strong
// down-move that breaks recent structure.
//
// Heuristic for "strong move":
//   - Net move from candle close to high/low of next 5 candles >= 1.5x ATR(14)
// Heuristic for "breaks structure":
//   - The 5-candle high (for bullish OB) exceeds the highest high of the
//     prior 10 candles. Symmetrical for bearish.

export interface OrderBlock {
  type: 'bullish' | 'bearish'
  idx: number
  zoneTop: number
  zoneBottom: number
  sizePct: number
  ageBars: number
  mitigated: boolean    // has price returned to the zone since formation?
  mitigatedAtIdx: number | null
}

function atr(ohlcv: OHLCV[], period = 14): number[] {
  const trueRanges: number[] = []
  for (let i = 0; i < ohlcv.length; i++) {
    if (i === 0) { trueRanges.push(ohlcv[i].high - ohlcv[i].low); continue }
    const tr = Math.max(
      ohlcv[i].high - ohlcv[i].low,
      Math.abs(ohlcv[i].high - ohlcv[i - 1].close),
      Math.abs(ohlcv[i].low - ohlcv[i - 1].close),
    )
    trueRanges.push(tr)
  }
  const out: number[] = new Array(ohlcv.length).fill(0)
  let sum = 0
  for (let i = 0; i < ohlcv.length; i++) {
    sum += trueRanges[i]
    if (i >= period) sum -= trueRanges[i - period]
    out[i] = i < period - 1 ? trueRanges[i] : sum / period
  }
  return out
}

export function detectOrderBlocks(ohlcv: OHLCV[], lookback = 100): OrderBlock[] {
  const out: OrderBlock[] = []
  if (ohlcv.length < 30) return out
  const atrSeries = atr(ohlcv, 14)
  const start = Math.max(15, ohlcv.length - lookback)
  for (let i = start; i < ohlcv.length - 6; i++) {
    const c = ohlcv[i]
    const a = atrSeries[i]
    if (!a) continue
    // Look ahead 5 candles for displacement
    const fwdHigh = Math.max(...ohlcv.slice(i + 1, i + 6).map(x => x.high))
    const fwdLow = Math.min(...ohlcv.slice(i + 1, i + 6).map(x => x.low))
    const upMove = fwdHigh - c.close
    const downMove = c.close - fwdLow
    // Look back 10 candles for prior structure
    const priorHigh = Math.max(...ohlcv.slice(Math.max(0, i - 10), i).map(x => x.high))
    const priorLow = Math.min(...ohlcv.slice(Math.max(0, i - 10), i).map(x => x.low))

    const isBearishCandle = c.close < c.open
    const isBullishCandle = c.close > c.open

    // Bullish OB: bearish candle, then 1.5+ ATR up-move that breaks prior high.
    if (isBearishCandle && upMove >= 1.5 * a && fwdHigh > priorHigh) {
      const zoneTop = c.open
      const zoneBottom = c.low
      const mid = (zoneTop + zoneBottom) / 2
      let mitigated = false
      let mitAt: number | null = null
      for (let j = i + 6; j < ohlcv.length; j++) {
        if (ohlcv[j].low <= zoneTop && ohlcv[j].high >= zoneBottom) { mitigated = true; mitAt = j; break }
      }
      out.push({ type: 'bullish', idx: i, zoneTop, zoneBottom, sizePct: ((zoneTop - zoneBottom) / mid) * 100, ageBars: ohlcv.length - 1 - i, mitigated, mitigatedAtIdx: mitAt })
    }
    // Bearish OB: bullish candle, then 1.5+ ATR down-move that breaks prior low.
    if (isBullishCandle && downMove >= 1.5 * a && fwdLow < priorLow) {
      const zoneTop = c.high
      const zoneBottom = c.open
      const mid = (zoneTop + zoneBottom) / 2
      let mitigated = false
      let mitAt: number | null = null
      for (let j = i + 6; j < ohlcv.length; j++) {
        if (ohlcv[j].low <= zoneTop && ohlcv[j].high >= zoneBottom) { mitigated = true; mitAt = j; break }
      }
      out.push({ type: 'bearish', idx: i, zoneTop, zoneBottom, sizePct: ((zoneTop - zoneBottom) / mid) * 100, ageBars: ohlcv.length - 1 - i, mitigated, mitigatedAtIdx: mitAt })
    }
  }
  return out
}

// ── VOLUME PROFILE (VPVR) ───────────────────────────────────────────────────
// Bins price into N levels, sums volume per bin. POC = bin with max volume.
// Value area = consecutive bins around POC totaling 70% of session volume.
// Edges of value area (VAH / VAL) often act as support/resistance.

export interface VolumeProfile {
  bins: { priceLow: number; priceHigh: number; volume: number }[]
  poc: number               // price at point of control
  vah: number               // value area high
  val: number               // value area low
  totalVolume: number
  binCount: number
}

export function computeVolumeProfile(ohlcv: OHLCV[], binCount = 30): VolumeProfile {
  if (!ohlcv.length) return { bins: [], poc: 0, vah: 0, val: 0, totalVolume: 0, binCount }
  let lo = Infinity, hi = -Infinity
  for (const c of ohlcv) { if (c.low < lo) lo = c.low; if (c.high > hi) hi = c.high }
  const binSize = (hi - lo) / binCount
  if (binSize <= 0) return { bins: [], poc: ohlcv[ohlcv.length - 1].close, vah: 0, val: 0, totalVolume: 0, binCount }

  const bins = Array.from({ length: binCount }, (_, i) => ({
    priceLow: lo + i * binSize,
    priceHigh: lo + (i + 1) * binSize,
    volume: 0,
  }))
  let total = 0
  for (const c of ohlcv) {
    // Distribute candle volume uniformly across all bins it overlapped.
    // (POC mode = TPO would be more accurate but this is the standard
    // 'classic' approximation and works fine for crypto 1H bars.)
    const candleLow = c.low
    const candleHigh = c.high
    const span = Math.max(candleHigh - candleLow, 1e-9)
    for (const b of bins) {
      const overlapLow = Math.max(candleLow, b.priceLow)
      const overlapHigh = Math.min(candleHigh, b.priceHigh)
      if (overlapHigh > overlapLow) {
        const frac = (overlapHigh - overlapLow) / span
        b.volume += c.volume * frac
      }
    }
    total += c.volume
  }
  // POC
  let pocIdx = 0
  for (let i = 1; i < bins.length; i++) if (bins[i].volume > bins[pocIdx].volume) pocIdx = i
  const poc = (bins[pocIdx].priceLow + bins[pocIdx].priceHigh) / 2

  // Value area: expand around POC until 70% of total volume captured.
  const targetVol = total * 0.70
  let captured = bins[pocIdx].volume
  let lo_ = pocIdx, hi_ = pocIdx
  while (captured < targetVol && (lo_ > 0 || hi_ < bins.length - 1)) {
    const upVol = hi_ < bins.length - 1 ? bins[hi_ + 1].volume : -1
    const dnVol = lo_ > 0 ? bins[lo_ - 1].volume : -1
    if (upVol >= dnVol && hi_ < bins.length - 1) { hi_++; captured += bins[hi_].volume }
    else if (lo_ > 0) { lo_--; captured += bins[lo_].volume }
    else break
  }
  const vah = bins[hi_].priceHigh
  const val = bins[lo_].priceLow
  return { bins, poc, vah, val, totalVolume: total, binCount }
}

// ── LIQUIDITY SWEEP ─────────────────────────────────────────────────────────
// "Stop-hunt" pattern. Price exceeds a recent swing high/low by some margin
// then closes back inside the prior range. High-probability mean-reversion
// trigger when caught on a higher-timeframe support or resistance.

export interface LiquiditySweep {
  type: 'high' | 'low'   // 'high' = sweep of recent high (likely short setup), 'low' = sweep of recent low (long setup)
  idx: number            // candle that swept
  sweptLevel: number     // the level that was swept
  reentryPrice: number   // where the sweeping candle closed
  excursionPct: number   // how far past the level price went, in % of price
}

export function detectLiquiditySweep(ohlcv: OHLCV[], lookback = 20): LiquiditySweep | null {
  if (ohlcv.length < lookback + 2) return null
  const last = ohlcv[ohlcv.length - 1]
  const prior = ohlcv.slice(-lookback - 1, -1)
  const recentHigh = Math.max(...prior.map(c => c.high))
  const recentLow = Math.min(...prior.map(c => c.low))
  // Sweep of high: last candle high > recentHigh BUT close back below recentHigh
  if (last.high > recentHigh && last.close < recentHigh) {
    return { type: 'high', idx: ohlcv.length - 1, sweptLevel: recentHigh, reentryPrice: last.close, excursionPct: ((last.high - recentHigh) / recentHigh) * 100 }
  }
  // Sweep of low: last candle low < recentLow BUT close back above recentLow
  if (last.low < recentLow && last.close > recentLow) {
    return { type: 'low', idx: ohlcv.length - 1, sweptLevel: recentLow, reentryPrice: last.close, excursionPct: ((recentLow - last.low) / recentLow) * 100 }
  }
  return null
}

// ── STRUCTURE HELPERS ───────────────────────────────────────────────────────
// Break of Structure (BOS) = continuation. Higher-high in uptrend or
// lower-low in downtrend confirms the prevailing direction.
// Change of Character (CHOCH) = first time the trend flips. Lower-low after
// a series of higher-highs, or vice versa.

interface SwingPoint { idx: number; price: number; type: 'high' | 'low' }

function findSwings(ohlcv: OHLCV[], k = 3): SwingPoint[] {
  const out: SwingPoint[] = []
  for (let i = k; i < ohlcv.length - k; i++) {
    const window = ohlcv.slice(i - k, i + k + 1)
    const isHigh = window.every(c => c.high <= ohlcv[i].high) && window.some(c => c.high < ohlcv[i].high)
    const isLow = window.every(c => c.low >= ohlcv[i].low) && window.some(c => c.low > ohlcv[i].low)
    if (isHigh) out.push({ idx: i, price: ohlcv[i].high, type: 'high' })
    if (isLow) out.push({ idx: i, price: ohlcv[i].low, type: 'low' })
  }
  return out
}

export interface StructureSignal {
  bos: 'up' | 'down' | null   // continuation
  choch: 'up' | 'down' | null // trend flip
  lastSwingHigh: number | null
  lastSwingLow: number | null
}

export function detectStructure(ohlcv: OHLCV[]): StructureSignal {
  const swings = findSwings(ohlcv, 3)
  if (swings.length < 4) return { bos: null, choch: null, lastSwingHigh: null, lastSwingLow: null }
  const highs = swings.filter(s => s.type === 'high').slice(-3)
  const lows = swings.filter(s => s.type === 'low').slice(-3)
  const lastSwingHigh = highs.length ? highs[highs.length - 1].price : null
  const lastSwingLow = lows.length ? lows[lows.length - 1].price : null
  const last = ohlcv[ohlcv.length - 1].close

  let bos: 'up' | 'down' | null = null
  if (highs.length >= 2 && highs[highs.length - 1].price > highs[highs.length - 2].price && last > highs[highs.length - 2].price) bos = 'up'
  if (lows.length >= 2 && lows[lows.length - 1].price < lows[lows.length - 2].price && last < lows[lows.length - 2].price) bos = 'down'

  // CHOCH: most recent swing in opposite direction broke the prior structure.
  let choch: 'up' | 'down' | null = null
  if (swings.length >= 4) {
    const recent = swings.slice(-4)
    const directions = recent.map(s => s.type)
    if (directions[0] === 'high' && directions[1] === 'low' && directions[2] === 'high' && directions[3] === 'low') {
      // descending sequence: high-low-high-low, bearish
      if (recent[3].price < recent[1].price) choch = 'down'
    }
    if (directions[0] === 'low' && directions[1] === 'high' && directions[2] === 'low' && directions[3] === 'high') {
      if (recent[3].price > recent[1].price) choch = 'up'
    }
  }
  return { bos, choch, lastSwingHigh, lastSwingLow }
}

// ── CONFLUENCE SCORE (composite trigger) ────────────────────────────────────
// Wraps everything above into a single 0-100 microstructure score for use as
// a soft trigger inside the war-room. NOT yet wired in. Run the explore
// script first to validate.

export interface MicrostructureScore {
  score: number               // 0-100 (50 = neutral)
  direction: 'long' | 'short' | 'neutral'
  signals: string[]           // human-readable contributors
  fvgs: { above: FairValueGap[]; below: FairValueGap[] }
  obs: OrderBlock[]
  vp: VolumeProfile
  sweep: LiquiditySweep | null
  structure: StructureSignal
}

export function computeMicrostructureScore(ohlcv: OHLCV[]): MicrostructureScore {
  const fvgs = findNearestUnfilledFVGs(ohlcv, 3)
  const obs = detectOrderBlocks(ohlcv, 80).filter(o => !o.mitigated)
  const vp = computeVolumeProfile(ohlcv, 30)
  const sweep = detectLiquiditySweep(ohlcv, 20)
  const structure = detectStructure(ohlcv)
  const last = ohlcv[ohlcv.length - 1].close

  let score = 50
  const signals: string[] = []

  // Long boosts
  if (sweep?.type === 'low') { score += 10; signals.push(`Liquidity sweep of low @ ${sweep.sweptLevel.toFixed(2)} (${sweep.excursionPct.toFixed(2)}% excursion)`) }
  if (structure.choch === 'up') { score += 10; signals.push('CHOCH up') }
  if (structure.bos === 'up') { score += 5; signals.push('BOS up') }
  const nearBullishOB = obs.find(o => o.type === 'bullish' && Math.abs(last - o.zoneTop) / last < 0.01)
  if (nearBullishOB) { score += 8; signals.push(`Near unmitigated bullish OB @ ${nearBullishOB.zoneTop.toFixed(2)}`) }
  if (vp.val > 0 && Math.abs(last - vp.val) / last < 0.005) { score += 5; signals.push(`At Value Area Low ${vp.val.toFixed(2)}`) }
  if (fvgs.above.length > 0 && fvgs.above[0].sizePct > 0.5) { score += 3; signals.push(`Unfilled bullish FVG draw above @ ${fvgs.above[0].zoneBottom.toFixed(2)}`) }

  // Short boosts (subtract from long-bias score)
  if (sweep?.type === 'high') { score -= 10; signals.push(`Liquidity sweep of high @ ${sweep.sweptLevel.toFixed(2)}`) }
  if (structure.choch === 'down') { score -= 10; signals.push('CHOCH down') }
  if (structure.bos === 'down') { score -= 5; signals.push('BOS down') }
  const nearBearishOB = obs.find(o => o.type === 'bearish' && Math.abs(last - o.zoneBottom) / last < 0.01)
  if (nearBearishOB) { score -= 8; signals.push(`Near unmitigated bearish OB @ ${nearBearishOB.zoneBottom.toFixed(2)}`) }
  if (vp.vah > 0 && Math.abs(last - vp.vah) / last < 0.005) { score -= 5; signals.push(`At Value Area High ${vp.vah.toFixed(2)}`) }

  score = Math.max(0, Math.min(100, score))
  const direction: 'long' | 'short' | 'neutral' =
    score >= 65 ? 'long' : score <= 35 ? 'short' : 'neutral'
  return { score, direction, signals, fvgs, obs, vp, sweep, structure }
}
