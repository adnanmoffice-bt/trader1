/**
 * CME BTC Futures gap detection.
 *
 * BTC trades 24/7 on Binance/spot but CME BTC futures (`BTC=F` on Yahoo)
 * close Fri 22:00 UTC and reopen Sun 23:00 UTC. The "gap" between Friday
 * close and Sunday open historically fills ~75% of the time within 1-5 days.
 *
 * If there's an unfilled gap ABOVE current price → LONG bias (price tends
 * to revisit the gap upward).
 * If there's an unfilled gap BELOW current price → LONG caution (price
 * tends to revisit downward first).
 *
 * Only relevant for BTC LONG entries. ETH has no analogous CME gap fill
 * statistic strong enough to act on.
 *
 * Fails open: any error returns null gap → no adjust.
 */

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart'

export interface CmeGapInfo {
  /** Yahoo `regularMarketPrice` for BTC=F at last close */
  cmeClose: number
  /** Spot BTC current price */
  spotPrice: number
  /** Difference in dollars: cmeClose − spotPrice. Positive = CME above spot. */
  gapUsd: number
  /** Percent of spot. */
  gapPct: number
  /** Direction the gap "wants" to fill from spot's POV: 'up' = price needs to rise, 'down' = fall, 'none' = closed. */
  fillDirection: 'up' | 'down' | 'none'
  /** Conviction nudge for a LONG entry: + favourable, − unfavourable. */
  longBias: number
}

export async function getBtcCmeGap(): Promise<CmeGapInfo | null> {
  try {
    const [cmeRes, spotRes] = await Promise.all([
      fetch(`${YAHOO_BASE}/BTC%3DF?interval=1d&range=10d`, {
        next: { revalidate: 1800 },
        headers: { 'User-Agent': 'Mozilla/5.0' },
      }),
      fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', {
        next: { revalidate: 60 },
      }),
    ])
    if (!cmeRes.ok || !spotRes.ok) return null

    const cmeData = await cmeRes.json()
    const spotData = await spotRes.json() as { price: string }

    const closes: (number | null)[] = cmeData?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []
    const validCloses = closes.filter((c): c is number => c != null)
    if (validCloses.length < 2) return null

    const cmeClose = validCloses[validCloses.length - 1]
    const spotPrice = parseFloat(spotData.price)
    if (!Number.isFinite(cmeClose) || !Number.isFinite(spotPrice)) return null

    const gapUsd = cmeClose - spotPrice
    const gapPct = (gapUsd / spotPrice) * 100

    // Threshold: gaps under 0.5% are noise, not statistically significant.
    let fillDirection: CmeGapInfo['fillDirection']
    let longBias: number
    if (Math.abs(gapPct) < 0.5) {
      fillDirection = 'none'
      longBias = 0
    } else if (gapUsd > 0) {
      fillDirection = 'up'  // price needs to rise to fill
      longBias = +5
    } else {
      fillDirection = 'down'
      longBias = -5
    }

    return { cmeClose, spotPrice, gapUsd, gapPct, fillDirection, longBias }
  } catch { return null }
}
