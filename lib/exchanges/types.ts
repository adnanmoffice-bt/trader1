// ══════════════════════════════════════════════════════════════════════════════
// Multi-Exchange Abstraction Layer — Type Definitions
// ══════════════════════════════════════════════════════════════════════════════

export type ExchangeId =
  | 'binance'
  | 'bybit'
  | 'okx'
  | 'kraken'
  | 'kucoin'
  | 'bitget'
  | 'gateio'
  | 'mexc'

export interface ExchangeCredentials {
  apiKey: string
  secretKey: string
  passphrase?: string // OKX, KuCoin, Bitget require this
}

export interface ExchangeBalance {
  asset: string
  free: number
  locked: number
  total: number
}

export interface ExchangeTicker {
  symbol: string
  price: number
  change24h: number
  changePct24h: number
  volume24h: number
  high24h: number
  low24h: number
  open24h: number
}

export interface ExchangeOrder {
  orderId: string
  symbol: string
  side: 'BUY' | 'SELL'
  type: 'MARKET' | 'LIMIT' | 'STOP_LOSS_LIMIT' | 'TAKE_PROFIT_LIMIT'
  executedQty: number
  avgPrice: number
  status: string
}

export interface ExchangeOHLCV {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type KlineInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d'

export interface ExchangeConfig {
  id: ExchangeId
  name: string
  logo: string
  website: string
  apiBase: string
  testnetBase?: string
  supportedFeatures: {
    spotTrading: boolean
    futuresTrading: boolean
    marginTrading: boolean
    stopLoss: boolean
    takeProfit: boolean
    oco: boolean // one-cancels-other
  }
  symbolMap: Record<string, string>
  quoteAsset: string // USDT, USD, etc.
  minOrderSize: number // minimum order in USD
  makerFee: number
  takerFee: number
}

/**
 * Unified exchange interface — all exchanges implement this
 */
export interface IExchange {
  readonly config: ExchangeConfig

  isConfigured(): boolean

  // Account
  getBalances(): Promise<ExchangeBalance[]>
  getQuoteBalance(): Promise<number> // USDT/USD available

  // Market Data
  getTicker(symbol: string): Promise<ExchangeTicker | null>
  getKlines(symbol: string, interval: KlineInterval, limit?: number): Promise<ExchangeOHLCV[]>

  // Trading
  marketBuy(symbol: string, notionalUsd: number): Promise<ExchangeOrder | null>
  marketSell(symbol: string, quantity: number): Promise<ExchangeOrder | null>
  setStopLoss(symbol: string, quantity: number, stopPrice: number): Promise<boolean>
  setTakeProfit(symbol: string, quantity: number, price: number): Promise<boolean>
  cancelAllOrders(symbol: string): Promise<void>

  // Connectivity test
  testConnection(): Promise<{ success: boolean; canTrade: boolean; canWithdraw: boolean; quoteBalance: number; error?: string }>
}

export const EXCHANGE_CONFIGS: Record<ExchangeId, Omit<ExchangeConfig, 'symbolMap'>> = {
  binance: {
    id: 'binance',
    name: 'Binance',
    logo: '🟡',
    website: 'binance.com',
    apiBase: 'https://api.binance.com',
    testnetBase: 'https://testnet.binance.vision',
    supportedFeatures: { spotTrading: true, futuresTrading: true, marginTrading: true, stopLoss: true, takeProfit: true, oco: true },
    quoteAsset: 'USDT',
    minOrderSize: 10,
    makerFee: 0.001,
    takerFee: 0.001,
  },
  bybit: {
    id: 'bybit',
    name: 'Bybit',
    logo: '🔶',
    website: 'bybit.com',
    apiBase: 'https://api.bybit.com',
    testnetBase: 'https://api-testnet.bybit.com',
    supportedFeatures: { spotTrading: true, futuresTrading: true, marginTrading: true, stopLoss: true, takeProfit: true, oco: false },
    quoteAsset: 'USDT',
    minOrderSize: 1,
    makerFee: 0.001,
    takerFee: 0.001,
  },
  okx: {
    id: 'okx',
    name: 'OKX',
    logo: '⚫',
    website: 'okx.com',
    apiBase: 'https://www.okx.com',
    supportedFeatures: { spotTrading: true, futuresTrading: true, marginTrading: true, stopLoss: true, takeProfit: true, oco: true },
    quoteAsset: 'USDT',
    minOrderSize: 1,
    makerFee: 0.001,
    takerFee: 0.0015,
  },
  kraken: {
    id: 'kraken',
    name: 'Kraken',
    logo: '🟣',
    website: 'kraken.com',
    apiBase: 'https://api.kraken.com',
    supportedFeatures: { spotTrading: true, futuresTrading: false, marginTrading: true, stopLoss: true, takeProfit: true, oco: false },
    quoteAsset: 'USD',
    minOrderSize: 10,
    makerFee: 0.0016,
    takerFee: 0.0026,
  },
  kucoin: {
    id: 'kucoin',
    name: 'KuCoin',
    logo: '🟢',
    website: 'kucoin.com',
    apiBase: 'https://api.kucoin.com',
    supportedFeatures: { spotTrading: true, futuresTrading: true, marginTrading: true, stopLoss: true, takeProfit: true, oco: false },
    quoteAsset: 'USDT',
    minOrderSize: 0.1,
    makerFee: 0.001,
    takerFee: 0.001,
  },
  bitget: {
    id: 'bitget',
    name: 'Bitget',
    logo: '🔵',
    website: 'bitget.com',
    apiBase: 'https://api.bitget.com',
    supportedFeatures: { spotTrading: true, futuresTrading: true, marginTrading: false, stopLoss: true, takeProfit: true, oco: false },
    quoteAsset: 'USDT',
    minOrderSize: 1,
    makerFee: 0.001,
    takerFee: 0.001,
  },
  gateio: {
    id: 'gateio',
    name: 'Gate.io',
    logo: '🔷',
    website: 'gate.io',
    apiBase: 'https://api.gateio.ws',
    supportedFeatures: { spotTrading: true, futuresTrading: true, marginTrading: true, stopLoss: true, takeProfit: true, oco: false },
    quoteAsset: 'USDT',
    minOrderSize: 1,
    makerFee: 0.002,
    takerFee: 0.002,
  },
  mexc: {
    id: 'mexc',
    name: 'MEXC',
    logo: '🟦',
    website: 'mexc.com',
    apiBase: 'https://api.mexc.com',
    supportedFeatures: { spotTrading: true, futuresTrading: true, marginTrading: true, stopLoss: true, takeProfit: true, oco: false },
    quoteAsset: 'USDT',
    minOrderSize: 5,
    makerFee: 0,
    takerFee: 0.001,
  },
}
