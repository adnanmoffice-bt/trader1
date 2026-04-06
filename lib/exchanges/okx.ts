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
  '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1H', '4h': '4H', '1d': '1D',
}

export class OKXExchange implements IExchange {
  readonly config: ExchangeConfig
  private apiKey: string
  private secret: string
  private passphrase: string

  constructor(creds?: ExchangeCredentials) {
    this.config = { ...EXCHANGE_CONFIGS.okx, symbolMap: SYMBOL_MAP }
    this.apiKey = creds?.apiKey || process.env.OKX_API_KEY || ''
    this.secret = creds?.secretKey || process.env.OKX_SECRET_KEY || ''
    this.passphrase = creds?.passphrase || process.env.OKX_PASSPHRASE || ''
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.secret && this.passphrase)
  }

  private async sign(timestamp: string, method: string, path: string, body = ''): Promise<string> {
    const payload = `${timestamp}${method}${path}${body}`
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey('raw', enc.encode(this.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
    return btoa(String.fromCharCode(...new Uint8Array(sig)))
  }

  private async request(method: 'GET' | 'POST', path: string, params?: Record<string, string>, body?: Record<string, unknown>) {
    const timestamp = new Date().toISOString()
    let fullPath = path
    if (params && method === 'GET') {
      const qs = new URLSearchParams(params).toString()
      if (qs) fullPath = `${path}?${qs}`
    }
    const bodyStr = body ? JSON.stringify(body) : ''
    const signature = await this.sign(timestamp, method, fullPath, bodyStr)

    const res = await fetch(`${this.config.apiBase}${fullPath}`, {
      method,
      headers: {
        'OK-ACCESS-KEY': this.apiKey,
        'OK-ACCESS-SIGN': signature,
        'OK-ACCESS-TIMESTAMP': timestamp,
        'OK-ACCESS-PASSPHRASE': this.passphrase,
        'Content-Type': 'application/json',
      },
      body: bodyStr || undefined,
    })
    return res.json()
  }

  private mapSymbol(symbol: string): string {
    return this.config.symbolMap[symbol] || symbol.replace('/', '-')
  }

  async getBalances(): Promise<ExchangeBalance[]> {
    const data = await this.request('GET', '/api/v5/account/balance')
    if (data.code !== '0') throw new Error(`OKX: ${data.msg}`)
    const details = data.data?.[0]?.details ?? []
    return details
      .map((d: { ccy: string; availBal: string; frozenBal: string; cashBal: string }) => ({
        asset: d.ccy,
        free: parseFloat(d.availBal || '0'),
        locked: parseFloat(d.frozenBal || '0'),
        total: parseFloat(d.cashBal || '0'),
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
      const res = await fetch(`${this.config.apiBase}/api/v5/market/ticker?instId=${mapped}`, { next: { revalidate: 30 } })
      const data = await res.json()
      if (data.code !== '0') return null
      const t = data.data?.[0]
      if (!t) return null
      const price = parseFloat(t.last)
      const open = parseFloat(t.open24h)
      return {
        symbol, price,
        change24h: price - open,
        changePct24h: open > 0 ? ((price - open) / open) * 100 : 0,
        volume24h: parseFloat(t.volCcy24h),
        high24h: parseFloat(t.high24h),
        low24h: parseFloat(t.low24h),
        open24h: open,
      }
    } catch { return null }
  }

  async getKlines(symbol: string, interval: KlineInterval, limit = 200): Promise<ExchangeOHLCV[]> {
    const mapped = this.mapSymbol(symbol)
    const bar = INTERVAL_MAP[interval] || '1H'
    try {
      const res = await fetch(
        `${this.config.apiBase}/api/v5/market/candles?instId=${mapped}&bar=${bar}&limit=${limit}`,
        { next: { revalidate: 60 } }
      )
      const data = await res.json()
      if (data.code !== '0') return []
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

    const data = await this.request('POST', '/api/v5/trade/order', undefined, {
      instId: mapped, tdMode: 'cash', side: 'buy', ordType: 'market', sz: qty,
    })
    if (data.code !== '0') throw new Error(`OKX: ${data.msg || data.data?.[0]?.sMsg}`)

    return {
      orderId: data.data?.[0]?.ordId ?? '',
      symbol, side: 'BUY', type: 'MARKET',
      executedQty: parseFloat(qty),
      avgPrice: ticker.price,
      status: 'FILLED',
    }
  }

  async marketSell(symbol: string, quantity: number): Promise<ExchangeOrder | null> {
    const mapped = this.mapSymbol(symbol)
    const data = await this.request('POST', '/api/v5/trade/order', undefined, {
      instId: mapped, tdMode: 'cash', side: 'sell', ordType: 'market', sz: quantity.toFixed(6),
    })
    if (data.code !== '0') throw new Error(`OKX: ${data.msg || data.data?.[0]?.sMsg}`)

    return {
      orderId: data.data?.[0]?.ordId ?? '',
      symbol, side: 'SELL', type: 'MARKET',
      executedQty: quantity, avgPrice: 0,
      status: 'FILLED',
    }
  }

  async setStopLoss(symbol: string, quantity: number, stopPrice: number): Promise<boolean> {
    const mapped = this.mapSymbol(symbol)
    try {
      const data = await this.request('POST', '/api/v5/trade/order-algo', undefined, {
        instId: mapped, tdMode: 'cash', side: 'sell', ordType: 'conditional',
        sz: quantity.toFixed(6), slTriggerPx: stopPrice.toFixed(2), slOrdPx: '-1',
      })
      return data.code === '0'
    } catch { return false }
  }

  async setTakeProfit(symbol: string, quantity: number, price: number): Promise<boolean> {
    const mapped = this.mapSymbol(symbol)
    try {
      const data = await this.request('POST', '/api/v5/trade/order-algo', undefined, {
        instId: mapped, tdMode: 'cash', side: 'sell', ordType: 'conditional',
        sz: quantity.toFixed(6), tpTriggerPx: price.toFixed(2), tpOrdPx: '-1',
      })
      return data.code === '0'
    } catch { return false }
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    const mapped = this.mapSymbol(symbol)
    try {
      const pending = await this.request('GET', '/api/v5/trade/orders-pending', { instId: mapped })
      for (const order of (pending.data ?? [])) {
        await this.request('POST', '/api/v5/trade/cancel-order', undefined, { instId: mapped, ordId: order.ordId })
      }
    } catch { /* ok */ }
  }

  async testConnection() {
    try {
      const data = await this.request('GET', '/api/v5/account/balance')
      if (data.code !== '0') return { success: false, canTrade: false, canWithdraw: false, quoteBalance: 0, error: data.msg }
      const details = data.data?.[0]?.details ?? []
      const usdt = details.find((d: { ccy: string }) => d.ccy === 'USDT')
      return {
        success: true, canTrade: true, canWithdraw: false,
        quoteBalance: usdt ? parseFloat(usdt.availBal || '0') : 0,
      }
    } catch (err) {
      return { success: false, canTrade: false, canWithdraw: false, quoteBalance: 0, error: String(err) }
    }
  }
}
