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

// MEXC uses Binance-compatible API format
export class MEXCExchange implements IExchange {
  readonly config: ExchangeConfig
  private apiKey: string
  private secret: string

  constructor(creds?: ExchangeCredentials) {
    this.config = { ...EXCHANGE_CONFIGS.mexc, symbolMap: SYMBOL_MAP }
    this.apiKey = creds?.apiKey || process.env.MEXC_API_KEY || ''
    this.secret = creds?.secretKey || process.env.MEXC_SECRET_KEY || ''
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.secret)
  }

  private async hmacSign(queryString: string): Promise<string> {
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey('raw', enc.encode(this.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(queryString))
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  private async request(method: 'GET' | 'POST' | 'DELETE', endpoint: string, params: Record<string, string> = {}, signed = false) {
    if (signed) {
      params.timestamp = Date.now().toString()
      params.recvWindow = '5000'
    }
    const qs = new URLSearchParams(params).toString()
    const signature = signed ? await this.hmacSign(qs) : ''
    const url = `${this.config.apiBase}${endpoint}?${qs}${signed ? `&signature=${signature}` : ''}`
    const res = await fetch(url, {
      method,
      headers: { 'X-MEXC-APIKEY': this.apiKey, 'Content-Type': 'application/json' },
    })
    return res.json()
  }

  private mapSymbol(symbol: string): string {
    return this.config.symbolMap[symbol] || symbol.replace('/', '')
  }

  async getBalances(): Promise<ExchangeBalance[]> {
    const data = await this.request('GET', '/api/v3/account', {}, true)
    if (data.code) throw new Error(`MEXC: ${data.msg}`)
    return (data.balances ?? [])
      .map((b: { asset: string; free: string; locked: string }) => ({
        asset: b.asset,
        free: parseFloat(b.free),
        locked: parseFloat(b.locked),
        total: parseFloat(b.free) + parseFloat(b.locked),
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
      const res = await fetch(`${this.config.apiBase}/api/v3/ticker/24hr?symbol=${mapped}`, { next: { revalidate: 30 } })
      if (!res.ok) return null
      const d = await res.json()
      return {
        symbol,
        price: parseFloat(d.lastPrice),
        change24h: parseFloat(d.priceChange),
        changePct24h: parseFloat(d.priceChangePercent),
        volume24h: parseFloat(d.quoteVolume),
        high24h: parseFloat(d.highPrice),
        low24h: parseFloat(d.lowPrice),
        open24h: parseFloat(d.openPrice),
      }
    } catch { return null }
  }

  async getKlines(symbol: string, interval: KlineInterval, limit = 200): Promise<ExchangeOHLCV[]> {
    const mapped = this.mapSymbol(symbol)
    try {
      const res = await fetch(
        `${this.config.apiBase}/api/v3/klines?symbol=${mapped}&interval=${interval}&limit=${limit}`,
        { next: { revalidate: 60 } }
      )
      if (!res.ok) return []
      const data: (number | string)[][] = await res.json()
      return data.map(k => ({
        timestamp: Number(k[0]),
        open: parseFloat(String(k[1])),
        high: parseFloat(String(k[2])),
        low: parseFloat(String(k[3])),
        close: parseFloat(String(k[4])),
        volume: parseFloat(String(k[5])),
      }))
    } catch { return [] }
  }

  async marketBuy(symbol: string, notionalUsd: number): Promise<ExchangeOrder | null> {
    const mapped = this.mapSymbol(symbol)
    const data = await this.request('POST', '/api/v3/order', {
      symbol: mapped, side: 'BUY', type: 'MARKET', quoteOrderQty: notionalUsd.toFixed(2),
    }, true)

    if (data.code) throw new Error(`MEXC: ${data.msg}`)

    return {
      orderId: String(data.orderId),
      symbol, side: 'BUY', type: 'MARKET',
      executedQty: parseFloat(data.executedQty || '0'),
      avgPrice: parseFloat(data.cummulativeQuoteQty || '0') / (parseFloat(data.executedQty || '1')),
      status: data.status || 'FILLED',
    }
  }

  async marketSell(symbol: string, quantity: number): Promise<ExchangeOrder | null> {
    const mapped = this.mapSymbol(symbol)
    const data = await this.request('POST', '/api/v3/order', {
      symbol: mapped, side: 'SELL', type: 'MARKET', quantity: quantity.toFixed(6),
    }, true)

    if (data.code) throw new Error(`MEXC: ${data.msg}`)

    return {
      orderId: String(data.orderId),
      symbol, side: 'SELL', type: 'MARKET',
      executedQty: parseFloat(data.executedQty || '0'),
      avgPrice: parseFloat(data.cummulativeQuoteQty || '0') / (parseFloat(data.executedQty || '1')),
      status: data.status || 'FILLED',
    }
  }

  async setStopLoss(symbol: string, quantity: number, stopPrice: number): Promise<boolean> {
    const mapped = this.mapSymbol(symbol)
    try {
      const data = await this.request('POST', '/api/v3/order', {
        symbol: mapped, side: 'SELL', type: 'STOP_LOSS_LIMIT',
        quantity: quantity.toFixed(6),
        stopPrice: stopPrice.toFixed(2),
        price: (stopPrice * 0.998).toFixed(2),
        timeInForce: 'GTC',
      }, true)
      return !data.code
    } catch { return false }
  }

  async setTakeProfit(symbol: string, quantity: number, price: number): Promise<boolean> {
    const mapped = this.mapSymbol(symbol)
    try {
      const data = await this.request('POST', '/api/v3/order', {
        symbol: mapped, side: 'SELL', type: 'TAKE_PROFIT_LIMIT',
        quantity: quantity.toFixed(6),
        stopPrice: price.toFixed(2),
        price: (price * 1.002).toFixed(2),
        timeInForce: 'GTC',
      }, true)
      return !data.code
    } catch { return false }
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    const mapped = this.mapSymbol(symbol)
    try {
      await this.request('DELETE', '/api/v3/openOrders', { symbol: mapped }, true)
    } catch { /* ok */ }
  }

  async testConnection() {
    try {
      const data = await this.request('GET', '/api/v3/account', {}, true)
      if (data.code) return { success: false, canTrade: false, canWithdraw: false, quoteBalance: 0, error: data.msg }
      const usdt = (data.balances ?? []).find((b: { asset: string }) => b.asset === 'USDT')
      return {
        success: true, canTrade: data.canTrade ?? true, canWithdraw: data.canWithdraw ?? false,
        quoteBalance: usdt ? parseFloat(usdt.free || '0') : 0,
      }
    } catch (err) {
      return { success: false, canTrade: false, canWithdraw: false, quoteBalance: 0, error: String(err) }
    }
  }
}
