/**
 * Pre-execution Spot order-book health check.
 *
 * Goal: prevent the "got filled, instant SL" pattern (3 of 13 stop-outs in
 * the 10-day audit closed within 30 minutes — a noise-stop signature
 * consistent with filling into a thin book that snaps back).
 *
 * Public Spot endpoint (no auth): GET /api/v3/depth?symbol=X&limit=20
 *
 * Heuristics applied:
 *   - reject if mid-price spread > thresholdBps
 *   - reject if cumulative size on the side we're trading (asks for LONG buy)
 *     within the first 3 levels is < depthMultiple × notional
 *
 * Fails open. Any HTTP error returns allowed:true.
 */

import type { Instrument } from '@/types'

const SPOT_API = 'https://api.binance.com'

const BINANCE_SPOT_SYMBOL: Partial<Record<Instrument, string>> = {
  'BTC/USD': 'BTCUSDT',
  'ETH/USD': 'ETHUSDT',
  'DOGE/USD': 'DOGEUSDT',
  'AVAX/USD': 'AVAXUSDT',
  'LINK/USD': 'LINKUSDT',
  'ADA/USD': 'ADAUSDT',
  'DOT/USD': 'DOTUSDT',
  'MATIC/USD': 'POLUSDT',
  'NEAR/USD': 'NEARUSDT',
  'APT/USD': 'APTUSDT',
}

const MAJOR_SET = new Set<Instrument>(['BTC/USD', 'ETH/USD'])

export interface OrderBookHealth {
  allowed: boolean
  reason: string
  spreadBps: number | null
  topAskUsd: number | null
  topBidUsd: number | null
  midPrice: number | null
}

/**
 * Check whether the current spot order book is healthy enough for a market
 * buy of `notionalUsd`. For non-Binance spot instruments (XAU/USD), returns
 * allowed:true (no book to inspect).
 */
export async function checkOrderBookHealth(
  instrument: Instrument,
  notionalUsd: number,
  side: 'long' | 'short' = 'long',
): Promise<OrderBookHealth> {
  const sym = BINANCE_SPOT_SYMBOL[instrument]
  if (!sym) {
    return { allowed: true, reason: 'no spot book to check (non-Binance instrument)', spreadBps: null, topAskUsd: null, topBidUsd: null, midPrice: null }
  }

  try {
    const res = await fetch(`${SPOT_API}/api/v3/depth?symbol=${sym}&limit=20`, {
      next: { revalidate: 30 },
      headers: { 'User-Agent': 'apex-trading/1.0' },
    })
    if (!res.ok) {
      return { allowed: true, reason: `depth fetch ${res.status} — fail open`, spreadBps: null, topAskUsd: null, topBidUsd: null, midPrice: null }
    }
    const json = await res.json() as { bids: [string, string][]; asks: [string, string][] }
    const bids = (json.bids ?? []).map(b => ({ price: parseFloat(b[0]), qty: parseFloat(b[1]) }))
    const asks = (json.asks ?? []).map(a => ({ price: parseFloat(a[0]), qty: parseFloat(a[1]) }))

    if (bids.length === 0 || asks.length === 0) {
      return { allowed: true, reason: 'empty book — fail open', spreadBps: null, topAskUsd: null, topBidUsd: null, midPrice: null }
    }

    const bestBid = bids[0].price
    const bestAsk = asks[0].price
    const mid = (bestBid + bestAsk) / 2
    const spreadBps = mid > 0 ? ((bestAsk - bestBid) / mid) * 10_000 : 0

    // Spread thresholds: tighter on majors, looser on alts.
    const maxSpreadBps = MAJOR_SET.has(instrument) ? 5 : 20
    if (spreadBps > maxSpreadBps) {
      return {
        allowed: false,
        reason: `spread ${spreadBps.toFixed(1)}bps > max ${maxSpreadBps}bps`,
        spreadBps, topAskUsd: bestAsk * asks[0].qty, topBidUsd: bestBid * bids[0].qty, midPrice: mid,
      }
    }

    // Same-side depth check: for LONG we'll buy → consume ask side.
    // Top 3 levels should hold at least 20× our notional in resting liquidity.
    const sideBook = side === 'long' ? asks : bids
    const top3UsdNotional = sideBook.slice(0, 3).reduce((s, lv) => s + lv.price * lv.qty, 0)
    const minDepth = notionalUsd * 20

    if (top3UsdNotional < minDepth) {
      return {
        allowed: false,
        reason: `top-3 ${side === 'long' ? 'ask' : 'bid'} depth $${top3UsdNotional.toFixed(0)} < required $${minDepth.toFixed(0)} (20× notional)`,
        spreadBps, topAskUsd: asks[0].price * asks[0].qty, topBidUsd: bids[0].price * bids[0].qty, midPrice: mid,
      }
    }

    return {
      allowed: true,
      reason: `book OK — spread ${spreadBps.toFixed(1)}bps, top-3 ${side} $${(top3UsdNotional / 1000).toFixed(1)}k`,
      spreadBps,
      topAskUsd: asks[0].price * asks[0].qty,
      topBidUsd: bids[0].price * bids[0].qty,
      midPrice: mid,
    }
  } catch (e) {
    return { allowed: true, reason: `depth fetch err: ${String(e).slice(0, 60)} — fail open`, spreadBps: null, topAskUsd: null, topBidUsd: null, midPrice: null }
  }
}
