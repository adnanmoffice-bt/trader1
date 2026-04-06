import type {
  IExchange, ExchangeConfig, ExchangeBalance, ExchangeTicker,
  ExchangeOHLCV, ExchangeOrder, KlineInterval, ExchangeCredentials,
} from './types'
import { EXCHANGE_CONFIGS } from './types'

const SYMBOL_MAP: Record<string, string> = {
  'BTC/USD': 'BTC_USDT', 'ETH/USD': 'ETH_USDT', 'SOL/USD': 'SOL_USDT',
  'BNB/USD': 'BNB_USDT', 'DOGE/USD': 'DOGE_USDT', 'AVAX/USD': 'AVAX_USDT',
  'LINK/USD': 'LINK_USDT', 'ADA/USD': 'ADA_USDT', 'XRP/USD': 'XRP_USDT',
  'DOT/USD': 'DOT_USDT', 'MATIC/USD': 'MATIC_USDT',
}

const INTERVAL_MAP: Record<string, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d',
}

export class GateIOExchange implements IExchange {
  readonly config: ExchangeConfig
  private apiKey: string
  private secret: string

  constructor(creds?: ExchangeCredentials) {
    this.config = { ...EXCHANGE_CONFIGS.gateio, symbolMap: SYMBOL_MAP }
    this.apiKey = creds?.apiKey || process.env.GATEIO_API_KEY || ''
    this.secret = creds?.secretKey || process.env.GATEIO_SECRET_KEY || ''
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.secret)
  }

  private async sha512(data: string): Promise<string> {
    const enc = new TextEncoder()
    const hash = await crypto.subtle.digest('SHA-512', enc.encode(data))
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  private async hmacSign(payload: string): Promise<string> {
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey('raw', enc.encode(this.secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  private async request(method: 'GET' | 'POST' | 'DELETE', path: string, params?: Record<string, string>, body?: Record<string, unknown>) {
    const timestamp = Math.floor(Date.now() / 1000).toString()
    let queryString = ''
    if (params && method === 'GET') {
      queryString = new URLSearchParams(params).toString()
    }
    const bodyStr = body ? JSON.stringify(body) : ''
    const bodyHash = await this.sha512(bodyStr)
    const signPayload = `${method}\n/api/v4${path}\n${queryString}\n${bodyHash}\n${timestamp}`
    const signature = await this.hmacSign(signPayload)

    const url = `${this.config.apiBase}/api/v4${path}${queryString ? `?${queryString}` : ''}`
    const res = await fetch(url, {
      method,
      headers: {
        'KEY': this.apiKey,
        'SIGN': signature,
        'Timestamp': timestamp,
        'Content-Type': 'application/json',
      },
      body: bodyStr || undefined,
    })
    return res.json()
  }

  private mapSymbol(symbol: string): string {
    return this.config.symbolMap[symbol] || symbol.replace('/', '_')
  }

  async getBalances(): Promise<ExchangeBalance[]> {
    const data = await this.request('GET', '/spot/accounts')
    if (!Array.isArray(data)) throw new Error(`Gate.io: ${JSON.stringify(data)}`)
    return data
      .map((a: { currency: string; available: string; locked: string }) => ({
        asset: a.currency,
        free: parseFloat(a.available || '0'),
        locked: parseFloat(a.locked || '0'),
        total: parseFloat(a.available || '0') + parseFloat(a.locked || '0'),
      }))
      .filter((b: ExchangeBalance) => b.total > 0)
  }

  async getQuoteBalance(): Promise<number> {
    const balances = await this.getBalances()
    return balances.find(b => b.asset === 'USDT')?.free ?? 0
  }

  async getTicker(symbol: string): Promise<ExchangeTicker | null> {
    const mapped = this.mapSymbol(symbol)
    try {
      const res = await fetch(`${this.config.apiBase}/api/v4/spot/tickers?currency_pair=${mapped}`, { next: { revalidate: 30 } })
      const data = await res.json()
      const t = data?.[0]
      if (!t) return null
      const price = parseFloat(t.last)
      const changePct = parseFloat(t.change_percentage)
      return {
        symbol, price,
        change24h: price * (changePct / 100),
        changePct24h: changePct,
        volume24h: parseFloat(t.quote_volume),
        high24h: parseFloat(t.high_24h),
        low24h: parseFloat(t.low_24h),
        open24h: price / (1 + changePct / 100),
      }
    } catch { return null }
  }

  async getKlines(symbol: string, interval: KlineInterval, limit = 200): Promise<ExchangeOHLCV[]> {
    const mapped = this.mapSymbol(symbol)
    const ivl = INTERVAL_MAP[interval] || '1h'
    try {
      const res = await fetch(
        `${this.config.apiBase}/api/v4/spot/candlesticks?currency_pair=${mapped}&interval=${ivl}&limit=${limit}`,
        { next: { revalidate: 60 } }
      )
      const data = await res.json()
      if (!Array.isArray(data)) return []
      return data.map((k: string[]) => ({
        timestamp: parseInt(k[0]) * 1000,
        open: parseFloat(k[5]),
        high: parseFloat(k[3]),
        low: parseFloat(k[4]),
        close: parseFloat(k[2]),
        volume: parseFloat(k[1]),
      }))
    } catch { return [] }
  }

  async marketBuy(symbol: string, notionalUsd: number): Promise<ExchangeOrder | null> {
    const mapped = this.mapSymbol(symbol)
    const ticker = await this.getTicker(symbol)
    if (!ticker) throw new Error('Cannot get price')
    const amount = (notionalUsd / ticker.price).toFixed(6)

    const data = await this.request('POST', '/spot/orders', undefined, {
      currency_pair: mapped, side: 'buy', type: 'market', amount,
    })

    return {
      orderId: data?.id ?? '',
      symbol, side: 'BUY', type: 'MARKET',
      executedQty: parseFloat(amount), avgPrice: ticker.price,
      status: 'FILLED',
    }
  }

  async marketSell(symbol: string, quantity: number): Promise<ExchangeOrder | null> {
    const mapped = this.mapSymbol(symbol)
    const data = await this.request('POST', '/spot/orders', undefined, {
      currency_pair: mapped, side: 'sell', type: 'market', amount: quantity.toFixed(6),
    })

    return {
      orderId: data?.id ?? '',
      symbol, side: 'SELL', type: 'MARKET',
      executedQty: quantity, avgPrice: 0,
      status: 'FILLED',
    }
  }

  async setStopLoss(symbol: string, quantity: number, stopPrice: number): Promise<boolean> {
    const mapped = this.mapSymbol(symbol)
    try {
      await this.request('POST', '/spot/price_orders', undefined, {
        trigger: { price: stopPrice.toFixed(2), rule: '<=', expiration: 86400 },
        put: { type: 'market', side: 'sell', amount: quantity.toFixed(6) },
        market: mapped,
      })
      return true
    } catch { return false }
  }

  async setTakeProfit(symbol: string, quantity: number, price: number): Promise<boolean> {
    const mapped = this.mapSymbol(symbol)
    try {
      await this.request('POST', '/spot/price_orders', undefined, {
        trigger: { price: price.toFixed(2), rule: '>=', expiration: 86400 },
        put: { type: 'market', side: 'sell', amount: quantity.toFixed(6) },
        market: mapped,
      })
      return true
    } catch { return false }
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    const mapped = this.mapSymbol(symbol)
    try {
      await this.request('DELETE', '/spot/orders', { currency_pair: mapped })
      await this.request('DELETE', '/spot/price_orders', { market: mapped })
    } catch { /* ok */ }
  }

  async testConnection() {
    try {
      const data = await this.request('GET', '/spot/accounts')
      if (!Array.isArray(data)) return { success: false, canTrade: false, canWithdraw: false, quoteBalance: 0, error: JSON.stringify(data) }
      const usdt = data.find((a: { currency: string }) => a.currency === 'USDT')
      return {
        success: true, canTrade: true, canWithdraw: false,
        quoteBalance: usdt ? parseFloat(usdt.available || '0') : 0,
      }
    } catch (err) {
      return { success: false, canTrade: false, canWithdraw: false, quoteBalance: 0, error: String(err) }
    }
  }
}
