import type {
  IExchange, ExchangeConfig, ExchangeBalance, ExchangeTicker,
  ExchangeOHLCV, ExchangeOrder, KlineInterval, ExchangeCredentials,
} from './types'
import { EXCHANGE_CONFIGS } from './types'

const SYMBOL_MAP: Record<string, string> = {
  'BTC/USD': 'XBTUSD', 'ETH/USD': 'ETHUSD', 'SOL/USD': 'SOLUSD',
  'DOGE/USD': 'XDGUSD', 'AVAX/USD': 'AVAXUSD', 'LINK/USD': 'LINKUSD',
  'ADA/USD': 'ADAUSD', 'XRP/USD': 'XRPUSD', 'DOT/USD': 'DOTUSD',
  'MATIC/USD': 'MATICUSD',
}

const PAIR_MAP: Record<string, string> = {
  'BTC/USD': 'XXBTZUSD', 'ETH/USD': 'XETHZUSD',
}

const INTERVAL_MAP: Record<string, number> = {
  '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440,
}

export class KrakenExchange implements IExchange {
  readonly config: ExchangeConfig
  private apiKey: string
  private secret: string

  constructor(creds?: ExchangeCredentials) {
    this.config = { ...EXCHANGE_CONFIGS.kraken, symbolMap: SYMBOL_MAP }
    this.apiKey = creds?.apiKey || process.env.KRAKEN_API_KEY || ''
    this.secret = creds?.secretKey || process.env.KRAKEN_SECRET_KEY || ''
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.secret)
  }

  private async sign(path: string, postData: string, nonce: string): Promise<string> {
    const enc = new TextEncoder()
    const sha256 = await crypto.subtle.digest('SHA-256', enc.encode(nonce + postData))
    const pathBytes = enc.encode(path)
    const message = new Uint8Array(pathBytes.length + sha256.byteLength)
    message.set(pathBytes)
    message.set(new Uint8Array(sha256), pathBytes.length)

    const secretBytes = Uint8Array.from(atob(this.secret), c => c.charCodeAt(0))
    const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
    const sig = await crypto.subtle.sign('HMAC', key, message)
    return btoa(String.fromCharCode(...new Uint8Array(sig)))
  }

  private async privateRequest(path: string, params: Record<string, string> = {}) {
    const nonce = (Date.now() * 1000).toString()
    params.nonce = nonce
    const postData = new URLSearchParams(params).toString()
    const signature = await this.sign(path, postData, nonce)

    const res = await fetch(`${this.config.apiBase}${path}`, {
      method: 'POST',
      headers: {
        'API-Key': this.apiKey,
        'API-Sign': signature,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: postData,
    })
    const data = await res.json()
    if (data.error?.length) throw new Error(`Kraken: ${data.error.join(', ')}`)
    return data.result
  }

  private mapSymbol(symbol: string): string {
    return this.config.symbolMap[symbol] || symbol.replace('/', '')
  }

  async getBalances(): Promise<ExchangeBalance[]> {
    const result = await this.privateRequest('/0/private/Balance')
    return Object.entries(result ?? {}).map(([asset, amount]) => ({
      asset: asset.replace(/^[XZ]/, '').replace('XBT', 'BTC'),
      free: parseFloat(amount as string),
      locked: 0,
      total: parseFloat(amount as string),
    })).filter(b => b.total > 0)
  }

  async getQuoteBalance(): Promise<number> {
    const balances = await this.getBalances()
    const usd = balances.find(b => b.asset === 'USD' || b.asset === 'USDT')
    return usd?.free ?? 0
  }

  async getTicker(symbol: string): Promise<ExchangeTicker | null> {
    const mapped = this.mapSymbol(symbol)
    try {
      const res = await fetch(`${this.config.apiBase}/0/public/Ticker?pair=${mapped}`, { next: { revalidate: 30 } })
      const data = await res.json()
      if (data.error?.length) return null
      const key = Object.keys(data.result ?? {})[0]
      if (!key) return null
      const t = data.result[key]
      const price = parseFloat(t.c[0])
      const open = parseFloat(t.o)
      return {
        symbol, price,
        change24h: price - open,
        changePct24h: open > 0 ? ((price - open) / open) * 100 : 0,
        volume24h: parseFloat(t.v[1]) * price,
        high24h: parseFloat(t.h[1]),
        low24h: parseFloat(t.l[1]),
        open24h: open,
      }
    } catch { return null }
  }

  async getKlines(symbol: string, interval: KlineInterval, limit = 200): Promise<ExchangeOHLCV[]> {
    const mapped = this.mapSymbol(symbol)
    const mins = INTERVAL_MAP[interval] || 60
    try {
      const res = await fetch(
        `${this.config.apiBase}/0/public/OHLC?pair=${mapped}&interval=${mins}`,
        { next: { revalidate: 60 } }
      )
      const data = await res.json()
      if (data.error?.length) return []
      const key = Object.keys(data.result ?? {}).find(k => k !== 'last')
      if (!key) return []
      return (data.result[key] as number[][]).slice(-limit).map(k => ({
        timestamp: (k[0] as number) * 1000,
        open: parseFloat(String(k[1])),
        high: parseFloat(String(k[2])),
        low: parseFloat(String(k[3])),
        close: parseFloat(String(k[4])),
        volume: parseFloat(String(k[6])),
      }))
    } catch { return [] }
  }

  async marketBuy(symbol: string, notionalUsd: number): Promise<ExchangeOrder | null> {
    const mapped = PAIR_MAP[symbol] || this.mapSymbol(symbol)
    const ticker = await this.getTicker(symbol)
    if (!ticker) throw new Error('Cannot get price')
    const volume = (notionalUsd / ticker.price).toFixed(6)

    const result = await this.privateRequest('/0/private/AddOrder', {
      pair: mapped, type: 'buy', ordertype: 'market', volume,
    })

    return {
      orderId: result?.txid?.[0] ?? '',
      symbol, side: 'BUY', type: 'MARKET',
      executedQty: parseFloat(volume),
      avgPrice: ticker.price,
      status: 'FILLED',
    }
  }

  async marketSell(symbol: string, quantity: number): Promise<ExchangeOrder | null> {
    const mapped = PAIR_MAP[symbol] || this.mapSymbol(symbol)
    const result = await this.privateRequest('/0/private/AddOrder', {
      pair: mapped, type: 'sell', ordertype: 'market', volume: quantity.toFixed(6),
    })

    return {
      orderId: result?.txid?.[0] ?? '',
      symbol, side: 'SELL', type: 'MARKET',
      executedQty: quantity, avgPrice: 0,
      status: 'FILLED',
    }
  }

  async setStopLoss(symbol: string, quantity: number, stopPrice: number): Promise<boolean> {
    const mapped = PAIR_MAP[symbol] || this.mapSymbol(symbol)
    try {
      await this.privateRequest('/0/private/AddOrder', {
        pair: mapped, type: 'sell', ordertype: 'stop-loss',
        volume: quantity.toFixed(6), price: stopPrice.toFixed(2),
      })
      return true
    } catch { return false }
  }

  async setTakeProfit(symbol: string, quantity: number, price: number): Promise<boolean> {
    const mapped = PAIR_MAP[symbol] || this.mapSymbol(symbol)
    try {
      await this.privateRequest('/0/private/AddOrder', {
        pair: mapped, type: 'sell', ordertype: 'take-profit',
        volume: quantity.toFixed(6), price: price.toFixed(2),
      })
      return true
    } catch { return false }
  }

  async cancelAllOrders(_symbol: string): Promise<void> {
    try { await this.privateRequest('/0/private/CancelAll') } catch { /* ok */ }
  }

  async testConnection() {
    try {
      const result = await this.privateRequest('/0/private/Balance')
      const entries = Object.entries(result ?? {})
      const usd = entries.find(([k]) => k === 'ZUSD' || k === 'USD')
      return {
        success: true, canTrade: true, canWithdraw: false,
        quoteBalance: usd ? parseFloat(usd[1] as string) : 0,
      }
    } catch (err) {
      return { success: false, canTrade: false, canWithdraw: false, quoteBalance: 0, error: String(err) }
    }
  }
}
