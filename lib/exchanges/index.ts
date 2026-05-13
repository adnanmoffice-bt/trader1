// ══════════════════════════════════════════════════════════════════════════════
// Exchange Factory & Manager — multi-exchange support
// ══════════════════════════════════════════════════════════════════════════════

import type { IExchange, ExchangeId, ExchangeCredentials, ExchangeTicker, ExchangeOHLCV, KlineInterval } from './types'
import { EXCHANGE_CONFIGS } from './types'
import { BinanceExchange } from './binance'
import { BybitExchange } from './bybit'
import { OKXExchange } from './okx'
import { KrakenExchange } from './kraken'
import { KuCoinExchange } from './kucoin'
import { BitgetExchange } from './bitget'
import { GateIOExchange } from './gateio'
import { MEXCExchange } from './mexc'
import { IGExchange } from './ig'

export { EXCHANGE_CONFIGS } from './types'
export type { IExchange, ExchangeId, ExchangeCredentials, ExchangeTicker, ExchangeOHLCV, KlineInterval } from './types'


/**
 * Create an exchange instance by ID
 */
export function createExchange(id: ExchangeId, creds?: ExchangeCredentials): IExchange {
  switch (id) {
    case 'binance': return new BinanceExchange(creds)
    case 'bybit':   return new BybitExchange(creds)
    case 'okx':     return new OKXExchange(creds)
    case 'kraken':  return new KrakenExchange(creds)
    case 'kucoin':  return new KuCoinExchange(creds)
    case 'bitget':  return new BitgetExchange(creds)
    case 'gateio':  return new GateIOExchange(creds)
    case 'mexc':    return new MEXCExchange(creds)
    case 'ig':      return new IGExchange(creds)
    default: throw new Error(`Unknown exchange: ${id}`)
  }
}

/**
 * Per-instrument execution-venue router.
 *
 * Crypto pairs (BTC, ETH, SOL, etc.) → Binance (or whichever crypto venue is
 * configured first). Non-crypto pairs (XAU, XAG, WTI, BRENT) → IG.
 *
 * If the requested venue isn't configured, falls back to getPrimaryExchange()
 * and the caller's `isConfigured()` check + war-room logExec will surface the
 * misconfiguration cleanly.
 */
export const IG_INSTRUMENTS = new Set([
  'XAU/USD', 'XAG/USD', 'WTI', 'BRENT',
  'EUR/USD', 'GBP/USD', 'USD/JPY',
  'SPY', 'QQQ',
])

export function getExchangeForInstrument(instrument: string): IExchange {
  if (IG_INSTRUMENTS.has(instrument)) {
    const ig = new IGExchange()
    if (ig.isConfigured()) return ig
  }
  return getPrimaryExchange()
}

/**
 * Get all configured exchanges (those with API keys set in env)
 */
export function getConfiguredExchanges(): IExchange[] {
  const all: IExchange[] = [
    new BinanceExchange(),
    new BybitExchange(),
    new OKXExchange(),
    new KrakenExchange(),
    new KuCoinExchange(),
    new BitgetExchange(),
    new GateIOExchange(),
    new MEXCExchange(),
    new IGExchange(),
  ]
  return all.filter(ex => ex.isConfigured())
}

/**
 * Get the primary exchange for trading (first configured one, or Binance by default)
 */
export function getPrimaryExchange(): IExchange {
  const configured = getConfiguredExchanges()
  return configured[0] ?? new BinanceExchange()
}

/**
 * Exchange manager — orchestrates multiple exchanges
 */
export class ExchangeManager {
  private exchanges: Map<ExchangeId, IExchange> = new Map()
  private primaryId: ExchangeId = 'binance'

  constructor(primaryId?: ExchangeId) {
    if (primaryId) this.primaryId = primaryId
    const configured = getConfiguredExchanges()
    for (const ex of configured) {
      this.exchanges.set(ex.config.id, ex)
    }
  }

  /** Add or replace an exchange */
  addExchange(id: ExchangeId, creds: ExchangeCredentials): void {
    this.exchanges.set(id, createExchange(id, creds))
  }

  /** Get the primary trading exchange */
  get primary(): IExchange {
    return this.exchanges.get(this.primaryId) ?? createExchange(this.primaryId)
  }

  /** Get a specific exchange */
  get(id: ExchangeId): IExchange | undefined {
    return this.exchanges.get(id)
  }

  /** List all configured exchanges */
  list(): IExchange[] {
    return Array.from(this.exchanges.values())
  }

  /** Check if any exchange is configured */
  hasAny(): boolean {
    return this.exchanges.size > 0
  }

  /** Fetch best ticker across all configured exchanges (lowest spread / most reliable) */
  async getBestTicker(symbol: string): Promise<ExchangeTicker | null> {
    const configured = Array.from(this.exchanges.values())
    if (!configured.length) return null

    const results = await Promise.allSettled(
      configured.map(ex => ex.getTicker(symbol))
    )

    let best: ExchangeTicker | null = null
    let bestVolume = 0

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value && r.value.volume24h > bestVolume) {
        best = r.value
        bestVolume = r.value.volume24h
      }
    }

    return best
  }

  /** Fetch klines from the first available exchange */
  async getKlines(symbol: string, interval: KlineInterval, limit = 200): Promise<ExchangeOHLCV[]> {
    for (const ex of this.exchanges.values()) {
      const klines = await ex.getKlines(symbol, interval, limit)
      if (klines.length > 0) return klines
    }
    return []
  }

  /** Get aggregate balance across all exchanges */
  async getAggregateBalance(): Promise<{ exchange: ExchangeId; quoteBalance: number }[]> {
    const results = await Promise.allSettled(
      Array.from(this.exchanges.entries()).map(async ([id, ex]) => ({
        exchange: id,
        quoteBalance: await ex.getQuoteBalance(),
      }))
    )

    return results
      .filter((r): r is PromiseFulfilledResult<{ exchange: ExchangeId; quoteBalance: number }> => r.status === 'fulfilled')
      .map(r => r.value)
  }

  /** Execute buy on primary exchange */
  async executeBuy(instrument: string, notionalUsd: number, userId: string, signalId: string | null, stopLoss: number | null, takeProfit: number | null) {
    const ex = this.primary
    if (!ex.isConfigured()) throw new Error('Primary exchange not configured')

    const result = await ex.marketBuy(instrument, notionalUsd)
    if (!result) return null

    if (stopLoss) await ex.setStopLoss(instrument, result.executedQty, stopLoss)
    if (takeProfit) await ex.setTakeProfit(instrument, result.executedQty, takeProfit)

    return {
      exchange: ex.config.id,
      orderId: result.orderId,
      executedQty: result.executedQty,
      avgPrice: result.avgPrice,
      signalId,
      userId,
    }
  }

  /** Execute sell on primary exchange */
  async executeSell(instrument: string, quantity: number) {
    const ex = this.primary
    if (!ex.isConfigured()) throw new Error('Primary exchange not configured')
    return ex.marketSell(instrument, quantity)
  }
}

// Backwards compatibility exports (matches old binance-trader.ts API)
export function isConfigured(): boolean {
  return getConfiguredExchanges().length > 0
}

export async function getAccountBalance() {
  return getPrimaryExchange().getBalances()
}

export async function getUsdtBalance(): Promise<number> {
  return getPrimaryExchange().getQuoteBalance()
}

export async function executeBuy(
  instrument: string, notionalUsd: number, userId: string,
  signalId: string | null = null, stopLoss: number | null = null, takeProfit: number | null = null,
) {
  const { createServiceSupabase } = await import('@/lib/supabase')
  const ex = getPrimaryExchange()

  const result = await ex.marketBuy(instrument, notionalUsd)
  if (!result) return null

  const db = createServiceSupabase()
  await db.from('trades').insert({
    signal_id: signalId, user_id: userId, instrument,
    direction: 'long', quantity: result.executedQty,
    entry_price: result.avgPrice, stop_loss: stopLoss, take_profit: takeProfit,
    status: 'open', is_demo: false,
    notes: `${ex.config.name} order ${result.orderId} | risk-sized $${notionalUsd.toFixed(0)}`,
  })

  await db.from('positions').upsert({
    user_id: userId, instrument, direction: 'long',
    quantity: result.executedQty, avg_entry_price: result.avgPrice,
    current_price: result.avgPrice, stop_loss: stopLoss, take_profit: takeProfit, is_demo: false,
  }, { onConflict: 'user_id,instrument,is_demo' })

  await db.from('agent_logs').insert({
    agent: 'orchestrator', level: 'ok',
    message: `AUTO-TRADE [${ex.config.name}]: BUY ${instrument} qty:${result.executedQty.toFixed(6)} @ $${result.avgPrice.toFixed(2)} ($${notionalUsd.toFixed(0)} risk-sized)`,
  })

  return { orderId: result.orderId, executedQty: result.executedQty, avgPrice: result.avgPrice }
}

export async function executeSell(instrument: string, quantity: number) {
  const ex = getPrimaryExchange()
  const result = await ex.marketSell(instrument, quantity)
  if (!result) return null
  return { orderId: result.orderId, avgPrice: result.avgPrice }
}

export async function setStopLossAndTakeProfit(instrument: string, quantity: number, stopPrice: number, takeProfitPrice: number): Promise<boolean> {
  const ex = getPrimaryExchange()
  const [sl, tp] = await Promise.all([
    ex.setStopLoss(instrument, quantity, stopPrice),
    ex.setTakeProfit(instrument, quantity, takeProfitPrice),
  ])
  return sl && tp
}

export async function cancelAllOrders(instrument: string): Promise<void> {
  const ex = getPrimaryExchange()
  await ex.cancelAllOrders(instrument)
}

export function calculatePositionSize(capitalUsd: number, entryPrice: number, stopLoss: number): number {
  const riskPct = 0.05
  const riskAmount = capitalUsd * riskPct
  const riskPerUnit = Math.abs(entryPrice - stopLoss)
  if (riskPerUnit <= 0) return 0
  return riskAmount / riskPerUnit
}

export const MAX_RISK_PCT = 0.05
export const MAX_POSITIONS = 3

/**
 * All supported exchange IDs for iteration
 */
export const ALL_EXCHANGE_IDS: ExchangeId[] = [
  'binance', 'bybit', 'okx', 'kraken', 'kucoin', 'bitget', 'gateio', 'mexc',
]
