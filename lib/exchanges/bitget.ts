import type {
  IExchange, ExchangeConfig, ExchangeBalance, ExchangeTicker,
  ExchangeOHLCV, ExchangeOrder, KlineInterval, ExchangeCredentials,
} from './types'
import { EXCHANGE_CONFIGS } from './types'

const SYMBOL_MAP: Record<string, string> = {
  'BTC/USD': 'BTCUSDT', 'ETH/USD': 'ETHUSDT', 'SOL/USD': 'SOLUSDT',
  'BNB/USD': 'BNBUSDT', 'DOGE/USD': 'DOGEUSDT', 'AVAX/USD': 'AVAXUSDT',
  'LINK/USD': 'LINKUSDT', 'ADA/USD': 'ADAUSDT', 'XRP/USD': 'XRPUSDT',
  'DOT/USD': 'DOTUSDT', 'MATIC/USD': 'MATICUSDT',
}

const INTERVAL_MAP: Record<string, string> = {
  '1m': '1min', '5m': '5min', '15m': '15min', '1h': '1h', '4h': '4h', '1d': '1day',
}

export class BitgetExchange implements IExchange {
  readonly config: ExchangeConfig
  private apiKey: string
  private secret: string
  private passphrase: string

  constructor(creds?: ExchangeCredentials) {
    this.config = { ...EXCHANGE_CONFIGS.bitget, symbolMap: SYMBOL_MAP }
    this.apiKey = creds?.apiKey || process.env.BITGET_API_KEY || ''
    this.secret = creds?.secretKey || process.env.BITGET_SECRET_KEY || ''
    this.passphrase = creds?.passphrase || process.env.BITGET_PASSPHRASE || ''
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

  private async request(method: 'GET' | 'POST', path: string, params?: Record<string, string>, body?: Record<string, unknown>) {
    const timestamp = Date.now().toString()
    let fullPath = path
    if (params && method === 'GET') {
      const qs = new URLSearchParams(params).toString()
      if (qs) fullPath = `${path}?${qs}`
    }
    const bodyStr = body ? JSON.stringify(body) : ''
    const signPayload = `${timestamp}${method}${fullPath}${bodyStr}`
    const signature = await this.hmacSign(signPayload)

    const res = await fetch(`${this.config.apiBase}${fullPath}`, {
      method,
      headers: {
        'ACCESS-KEY': this.apiKey,
        'ACCESS-SIGN': signature,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': this.passphrase,
        'Content-Type': 'application/json',
        'locale': 'en-US',
      },
      body: bodyStr || undefined,
    })
    const data = await res.json()
    if (data.code !== '00000') throw new Error(`Bitget: ${data.msg}`)
    return data.data
  }

  private mapSymbol(symbol: string): string {
    return this.config.symbolMap[symbol] || symbol.replace('/', '')
  }

  async getBalances(): Promise<ExchangeBalance[]> {
    const result = await this.request('GET', '/api/v2/spot/account/assets')
    return (result ?? [])
      .map((a: { coin: string; available: string; frozen: string }) => ({
        asset: a.coin,
        free: parseFloat(a.available || '0'),
        locked: parseFloat(a.frozen || '0'),
        total: parseFloat(a.available || '0') + parseFloat(a.frozen || '0'),
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
      const res = await fetch(`${this.config.apiBase}/api/v2/spot/market/tickers?symbol=${mapped}`, { next: { revalidate: 30 } })
      const data = await res.json()
      if (data.code !== '00000') return null
      const t = data.data?.[0]
      if (!t) return null
      const price = parseFloat(t.lastPr)
      const open = parseFloat(t.open)
      return {
        symbol, price,
        change24h: price - open,
        changePct24h: parseFloat(t.change) * 100,
        volume24h: parseFloat(t.quoteVolume),
        high24h: parseFloat(t.high24h),
        low24h: parseFloat(t.low24h),
        open24h: open,
      }
    } catch { return null }
  }

  async getKlines(symbol: string, interval: KlineInterval, limit = 200): Promise<ExchangeOHLCV[]> {
    const mapped = this.mapSymbol(symbol)
    const gran = INTERVAL_MAP[interval] || '1h'
    try {
      const res = await fetch(
        `${this.config.apiBase}/api/v2/spot/market/candles?symbol=${mapped}&granularity=${gran}&limit=${limit}`,
        { next: { revalidate: 60 } }
      )
      const data = await res.json()
      if (data.code !== '00000') return []
      return (data.data ?? []).reverse().map((k: string[]) => ({
        timestamp: parseInt(k[0]),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }))
    } catch { return [] }
  }

  async marketBuy(symbol: string, notionalUsd: number): Promise<ExchangeOrder | null> {
    const mapped = this.mapSymbol(symbol)
    const ticker = await this.getTicker(symbol)
    if (!ticker) throw new Error('Cannot get price')
    const qty = (notionalUsd / ticker.price).toFixed(6)

    const result = await this.request('POST', '/api/v2/spot/trade/place-order', undefined, {
      symbol: mapped, side: 'buy', orderType: 'market', size: qty, force: 'gtc',
    })

    return {
      orderId: result?.orderId ?? '',
      symbol, side: 'BUY', type: 'MARKET',
      executedQty: parseFloat(qty), avgPrice: ticker.price,
      status: 'FILLED',
    }
  }

  async marketSell(symbol: string, quantity: number): Promise<ExchangeOrder | null> {
    const mapped = this.mapSymbol(symbol)
    const result = await this.request('POST', '/api/v2/spot/trade/place-order', undefined, {
      symbol: mapped, side: 'sell', orderType: 'market', size: quantity.toFixed(6), force: 'gtc',
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
      await this.request('POST', '/api/v2/spot/trade/place-plan-order', undefined, {
        symbol: mapped, side: 'sell', orderType: 'market',
        size: quantity.toFixed(6), triggerPrice: stopPrice.toFixed(2), triggerType: 'mark_price',
      })
      return true
    } catch { return false }
  }

  async setTakeProfit(symbol: string, quantity: number, price: number): Promise<boolean> {
    const mapped = this.mapSymbol(symbol)
    try {
      await this.request('POST', '/api/v2/spot/trade/place-plan-order', undefined, {
        symbol: mapped, side: 'sell', orderType: 'market',
        size: quantity.toFixed(6), triggerPrice: price.toFixed(2), triggerType: 'mark_price',
      })
      return true
    } catch { return false }
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    const mapped = this.mapSymbol(symbol)
    try {
      await this.request('POST', '/api/v2/spot/trade/cancel-symbol-order', undefined, { symbol: mapped })
    } catch { /* ok */ }
  }

  async testConnection() {
    try {
      const result = await this.request('GET', '/api/v2/spot/account/assets')
      const usdt = (result ?? []).find((a: { coin: string }) => a.coin === 'USDT')
      return {
        success: true, canTrade: true, canWithdraw: false,
        quoteBalance: usdt ? parseFloat(usdt.available || '0') : 0,
      }
    } catch (err) {
      return { success: false, canTrade: false, canWithdraw: false, quoteBalance: 0, error: String(err) }
    }
  }
}
