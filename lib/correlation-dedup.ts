/**
 * Correlation deduplication for war-room entries.
 *
 * Audit 2026-04-30 finding: BTC and ETH were co-traded as pairs 3 out of 3
 * times in the 10-day window (26/04 09:15, 26/04 17:00, 27/04 02:45). Each
 * pair both wins together or loses together — i.e., we are doubling a single
 * macro/crypto-risk bet at the same probability with 2x position size and
 * 2x variance.
 *
 * This module returns the list of "paired" instruments for any given symbol
 * and a helper to check if any of those pairs have an open or recently-decided
 * same-direction exposure.
 *
 * Hardcoded correlation buckets (≥0.85 historical 30-day return correlation):
 *   - BTC/USD ↔ ETH/USD                                         (~0.92)
 *   - LINK/USD ↔ AVAX/USD ↔ DOT/USD                              (~0.85)
 *   - MATIC/USD ↔ NEAR/USD ↔ APT/USD                             (~0.80)
 *   - DOGE/USD                                                   (loner — meme; do not dedupe)
 *   - XAU/USD                                                    (loner — gold)
 *
 * BTC and ETH are kept in separate single-element correlation groups for
 * "fanout" but linked via the BTC↔ETH bucket. We use the strongest pair
 * (BTC↔ETH) as a hard dedup, and the alt buckets as soft warning.
 */

import type { Instrument } from '@/types'

const PAIRS: Instrument[][] = [
  ['BTC/USD', 'ETH/USD'],
  ['LINK/USD', 'AVAX/USD', 'DOT/USD'],
  ['MATIC/USD', 'NEAR/USD', 'APT/USD'],
]

export function correlatedPeers(instrument: Instrument): Instrument[] {
  for (const group of PAIRS) {
    if (group.includes(instrument)) {
      return group.filter(g => g !== instrument)
    }
  }
  return []
}

export interface DedupContext {
  /** instruments that have decisions/positions in the recent dedup window */
  recentSameDirInstruments: Set<string>
  /** instruments with currently open real or demo positions */
  openSameDirInstruments: Set<string>
}

export interface DedupResult {
  allowed: boolean
  reason: string
  conflictWith?: Instrument
  /** 'hard' = highly correlated pair (BTC↔ETH), block. 'soft' = alt bucket, warn but allow. */
  severity?: 'hard' | 'soft'
}

const HARD_PAIRS = new Set(['BTC/USD↔ETH/USD', 'ETH/USD↔BTC/USD'])

/**
 * @param instrument         the candidate trade
 * @param ctx                set of instruments with same-direction recent activity
 */
export function checkCorrelationDedup(
  instrument: Instrument,
  ctx: DedupContext,
): DedupResult {
  const peers = correlatedPeers(instrument)
  if (peers.length === 0) {
    return { allowed: true, reason: 'no correlated peers tracked' }
  }

  for (const peer of peers) {
    const pairKey = `${instrument}↔${peer}`
    const inOpen = ctx.openSameDirInstruments.has(peer)
    const inRecent = ctx.recentSameDirInstruments.has(peer)

    if (!inOpen && !inRecent) continue

    const severity: 'hard' | 'soft' = HARD_PAIRS.has(pairKey) ? 'hard' : 'soft'

    if (severity === 'hard') {
      return {
        allowed: false,
        reason: `highly-correlated peer ${peer} ${inOpen ? 'has open same-dir position' : 'just opened same-dir within window'}; doubling-up blocked`,
        conflictWith: peer,
        severity,
      }
    }

    // Soft — currently we only WARN on alt buckets but allow. Could be
    // tightened later if we see paired-loss patterns inside an alt bucket.
    return {
      allowed: true,
      reason: `soft-correlated peer ${peer} active; allowed but flagged`,
      conflictWith: peer,
      severity,
    }
  }

  return { allowed: true, reason: 'no recent same-direction peer activity' }
}
