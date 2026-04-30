/**
 * Lightweight on-chain "exchange flow" proxy for BTC and ETH.
 *
 * Uses Blockchain.com & Etherscan free endpoints to estimate net exchange
 * inflow / outflow over the last ~24h. A surge in inflow before a LONG
 * entry is a bearish setup (sell pressure incoming).
 *
 * This is a HEURISTIC, not a true Glassnode signal. It uses publicly known
 * exchange wallet labels and is intentionally simple to keep latency low and
 * external dependencies minimal.
 *
 * Fails open: returns null on error → no veto, no boost.
 */

import type { Instrument } from '@/types'

interface OnchainSnap {
  inflow24hUsd: number
  outflow24hUsd: number
  netFlow24hUsd: number
  source: string
}

/**
 * For now this is a STUB returning null. Wiring to a real free on-chain feed
 * (CryptoQuant free tier, Glassnode free tier, or a custom RPC indexer) is
 * a follow-up. Keeping the interface in place so war-room can call it
 * without a code change later.
 *
 * The simpler heuristic we DO use today is the CryptoCompare 24h volume
 * change ratio — a 3x volume spike with a price drop is often
 * exchange-deposit-driven distribution.
 */
export async function getOnchainFlows(_instrument: Instrument): Promise<OnchainSnap | null> {
  // Intentionally not implemented. See comment.
  return null
}

export interface OnchainGateResult {
  allowed: boolean
  reason: string
  /** −N to penalise LONG, +N to favour. */
  convictionAdjust: number
}

/**
 * Apply on-chain heuristic. With the stub above, this always returns
 * neutral. Kept callable so war-room can wire it now and we upgrade
 * the data source later.
 */
export async function evaluateOnchainForLong(instrument: Instrument): Promise<OnchainGateResult> {
  const snap = await getOnchainFlows(instrument)
  if (!snap) return { allowed: true, reason: 'on-chain feed not configured (skip)', convictionAdjust: 0 }

  // Threshold: net inflow > $50M in 24h on BTC = significant.
  if (snap.netFlow24hUsd > 50_000_000) {
    return {
      allowed: false,
      reason: `on-chain net inflow $${(snap.netFlow24hUsd / 1e6).toFixed(0)}M (${snap.source}) — sell pressure`,
      convictionAdjust: -15,
    }
  }
  if (snap.netFlow24hUsd < -50_000_000) {
    return {
      allowed: true,
      reason: `on-chain net outflow $${Math.abs(snap.netFlow24hUsd / 1e6).toFixed(0)}M — accumulation`,
      convictionAdjust: +8,
    }
  }
  return { allowed: true, reason: 'on-chain neutral', convictionAdjust: 0 }
}
