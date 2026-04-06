import type {
  IExchange, ExchangeConfig, ExchangeBalance, ExchangeTicker,
  ExchangeOHLCV, ExchangeOrder, KlineInterval, ExchangeCredentials,
} from './types'
import { EXCHANGE_CONFIGS } from './types'

const SYMBOL_MAP: Record<string, string> = {
  'BTC/USD': 'BTC-USDT', 'ETH/USD': 'ETH-USDT', 'SOL/USD': 'SOL-USDT',
  'BNB/USD': 'BNB-USDT', 'DOGE/USD': 'DOGE-USDT', 'AVAX/USD': 'AVAX-USDT',
  'LINK/USD': 'LINK-USDT', 'ADA/USD': 'ADA-USDT', 'XRP/USD': 'XRP-USDT',
  'DOT/USD': 'DOT-USDT', 'MATIC/USD': 'MATIC-USDT',
}

const INTERVAL_MAP: Record<string, string> = {
  '1m': '1min', '5m': '5min', '15m': '15min', '1h': '1hour', '4h': '4hour', '1d': '1day',
}

export class KuCoinExchange implements IExchange {
  readonly config: ExchangeConfig
  private apiKey: string
  private secret: string
  private passphrase: string

  constructor(creds?: ExchangeCredentials) {
    this.config = { ...EXCHANGE_CONFIGS.kucoin, symbolMap: SYMBOL_MAP }
    this.apiKey = creds?.apiKey || process.env.KUCOIN_API_KEY || ''
    this.secret = creds?.secretKey || process.env.KUCOIN_SECRET_KEY || ''
    this.passphrase = creds?.passphrase || process.env.KUCOIN_PASSPHRASE || ''
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.secret && this.passphrase)
  }

  private async hmacSign(payload: string): Promise<string> {
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey('raw', enc.encode(this.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
    return btoa(String.fromCharCode(...new Uint8Array(sig)))
  }

  private async signPassphrase(): Promise<string> {
    return this.hmacSign(this.passphrase)
  }

  private async request(method: 'GET' | 'POST' | 'DELETE', path: string, params?: Record<string, string>, body?: Record<string, unknown>) {
    const timestamp = Date.now().toString()
    let fullPath = path
    if (params && method === 'GET') {
      const qs = new URLSearchParams(params).toString()
      if (qs) fullPath = `${path}?${qs}`
    }
    const bodyStr = body ? JSON.stringify(body) : ''
    const signPayload = `${timestamp}${method}${fullPath}${bodyStr}`
    const signature = await this.hmacSign(signPayload)
    const passphraseSign = await this.signPassphrase()

    const res = await fetch(`${this.config.apiBase}${fullPath}`, {
      method,
      headers: {
        'KC-API-KEY': this.apiKey,
        'KC-API-SIGN': signature,
        'KC-API-TIMESTAMP': timestamp,
        'KC-API-PASSPHRASE': passphraseSign,
        'KC-API-KEY-VERSION': '2',
        'Content-Type': 'application/json',
      },
      body: bodyStr || undefined,
    })
    const data = await res.json()
    if (data.code !== '200000') throw new Error(`KuCoin: ${data.msg}`)
    return data.data
  }

  private mapSymbol(symbol: string): string {
    return this.config.symbolMap[symbol] || symbol.replace('/', '-')
  }

  async getBalances(): Promise<ExchangeBalance[]> {
    const accounts = await this.request('GET', '/api/v1/accounts', { type: 'trade' })
    return (accounts ?? [])
      .map((a: { currency: string; available: string; holds: string; balance: string }) => ({
        asset: a.currency,
        free: parseFloat(a.available),
        locked: parseFloat(a.holds),
        total: parseFloat(a.balance),
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
      const res = await fetch(`${this.config.apiBase}/api/v1/market/stats?symbol=${mapped}`, { next: { revalidate: 30 } })
      const data = await res.json()
      if (data.code !== '200000') return null
      const t = data.data
      const price = parseFloat(t.last)
      const open = parseFloat(t.open)
      return {
        symbol, price,
        change24h: price - open,
        changePct24h: parseFloat(t.changeRate) * 100,
        volume24h: parseFloat(t.volValue),
        high24h: parseFloat(t.high),
        low24h: parseFloat(t.low),
        open24h: open,
      }
    } catch { return null }
  }

  async getKlines(symbol: string, interval: KlineInterval, limit = 200): Promise<ExchangeOHLCV[]> {
    const mapped = this.mapSymbol(symbol)
    const kType = INTERVAL_MAP[interval] || '1hour'
    try {
      const res = await fetch(
        `${this.config.apiBase}/api/v1/market/candles?type=${kType}&symbol=${mapped}`,
        { next: { revalidate: 60 } }
      )
      const data = await res.json()
      if (data.code !== '200000') return []
      return (data.data ?? []).reverse().slice(-limit).map((k: string[]) => ({
        timestamp: parseInt(k[0]) * 1000,
        open: parseFloat(k[1]),
        high: parseFloat(k[3]),
        low: parseFloat(k[4]),
        close: parseFloat(k[2]),
        volume: parseFloat(k[5]),
      }))
    } catch { return [] }
  }

  async marketBuy(symbol: string, notionalUsd: number): Promise<ExchangeOrder | null> {
    const mapped = this.mapSymbol(symbol)
    const clientOid = crypto.randomUUID()
    const result = await this.request('POST', '/api/v1/orders', undefined, {
      clientOid, side: 'buy', symbol: mapped, type: 'market', funds: notionalUsd.toFixed(2),
    })

    const ticker = await this.getTicker(symbol)
    const qty = ticker ? notionalUsd / ticker.price : 0

    return {
      orderId: result?.orderId ?? '',
      symbol, side: 'BUY', type: 'MARKET',
      executedQty: qty, avgPrice: ticker?.price ?? 0,
      status: 'FILLED',
    }
  }

  async marketSell(symbol: string, quantity: number): Promise<ExchangeOrder | null> {
    const mapped = this.mapSymbol(symbol)
    const clientOid = crypto.randomUUID()
    const result = await this.request('POST', '/api/v1/orders', undefined, {
      clientOid, side: 'sell', symbol: mapped, type: 'market', size: quantity.toFixed(6),
    })

    return {
      orderId: result?.orderId ?? '',
      symbol, side: 'SELL', type: 'MARKET',
      executedQty: quantity, avgPrice: 0,
      status: 'FILLED',
    }
  }

  async setStopLoss(symbol: string, quantity: number, stopPrice: number): Promise<boolean> {
    const mapped = this.mapSymbol(symbol)
    try {
      await this.request('POST', '/api/v1/stop-order', undefined, {
        clientOid: crypto.randomUUID(), side: 'sell', symbol: mapped,
        type: 'market', size: quantity.toFixed(6),
        stopPrice: stopPrice.toFixed(2), stop: 'loss',
      })
      return true
    } catch { return false }
  }

  async setTakeProfit(symbol: string, quantity: number, price: number): Promise<boolean> {
    const mapped = this.mapSymbol(symbol)
    try {
      await this.request('POST', '/api/v1/stop-order', undefined, {
        clientOid: crypto.randomUUID(), side: 'sell', symbol: mapped,
        type: 'market', size: quantity.toFixed(6),
        stopPrice: price.toFixed(2), stop: 'entry',
      })
      return true
    } catch { return false }
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    const mapped = this.mapSymbol(symbol)
    try {
      await this.request('DELETE', `/api/v1/orders?symbol=${mapped}`)
      await this.request('DELETE', `/api/v1/stop-order/cancel?symbol=${mapped}`)
    } catch { /* ok */ }
  }

  async testConnection() {
    try {
      const accounts = await this.request('GET', '/api/v1/accounts', { type: 'trade' })
      const usdt = (accounts ?? []).find((a: { currency: string }) => a.currency === 'USDT')
      return {
        success: true, canTrade: true, canWithdraw: false,
        quoteBalance: usdt ? parseFloat(usdt.available) : 0,
      }
    } catch (err) {
      return { success: false, canTrade: false, canWithdraw: false, quoteBalance: 0, error: String(err) }
    }
  }
}
