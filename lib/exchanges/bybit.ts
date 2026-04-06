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
  '1m': '1', '5m': '5', '15m': '15', '1h': '60', '4h': '240', '1d': 'D',
}

export class BybitExchange implements IExchange {
  readonly config: ExchangeConfig
  private apiKey: string
  private secret: string

  constructor(creds?: ExchangeCredentials) {
    this.config = { ...EXCHANGE_CONFIGS.bybit, symbolMap: SYMBOL_MAP }
    this.apiKey = creds?.apiKey || process.env.BYBIT_API_KEY || ''
    this.secret = creds?.secretKey || process.env.BYBIT_SECRET_KEY || ''
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.secret)
  }

  private async hmacSign(payload: string): Promise<string> {
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey('raw', enc.encode(this.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  private async request(method: 'GET' | 'POST', endpoint: string, params: Record<string, string> = {}, body?: Record<string, unknown>) {
    const timestamp = Date.now().toString()
    const recvWindow = '5000'
    let signPayload: string

    if (method === 'GET') {
      const qs = new URLSearchParams(params).toString()
      signPayload = `${timestamp}${this.apiKey}${recvWindow}${qs}`
      const sign = await this.hmacSign(signPayload)
      const url = `${this.config.apiBase}${endpoint}${qs ? `?${qs}` : ''}`
      const res = await fetch(url, {
        headers: {
          'X-BAPI-API-KEY': this.apiKey,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-SIGN': sign,
          'X-BAPI-RECV-WINDOW': recvWindow,
        },
      })
      return res.json()
    } else {
      const bodyStr = JSON.stringify(body ?? {})
      signPayload = `${timestamp}${this.apiKey}${recvWindow}${bodyStr}`
      const sign = await this.hmacSign(signPayload)
      const res = await fetch(`${this.config.apiBase}${endpoint}`, {
        method: 'POST',
        headers: {
          'X-BAPI-API-KEY': this.apiKey,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-SIGN': sign,
          'X-BAPI-RECV-WINDOW': recvWindow,
          'Content-Type': 'application/json',
        },
        body: bodyStr,
      })
      return res.json()
    }
  }

  private mapSymbol(symbol: string): string {
    return this.config.symbolMap[symbol] || symbol.replace('/', '')
  }

  async getBalances(): Promise<ExchangeBalance[]> {
    const data = await this.request('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' })
    if (data.retCode !== 0) throw new Error(`Bybit: ${data.retMsg}`)
    const coins = data.result?.list?.[0]?.coin ?? []
    return coins
      .map((c: { coin: string; walletBalance: string; locked: string; availableToWithdraw: string }) => ({
        asset: c.coin,
        free: parseFloat(c.availableToWithdraw || '0'),
        locked: parseFloat(c.locked || '0'),
        total: parseFloat(c.walletBalance || '0'),
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
      const res = await fetch(`${this.config.apiBase}/v5/market/tickers?category=spot&symbol=${mapped}`, { next: { revalidate: 30 } })
      const data = await res.json()
      if (data.retCode !== 0) return null
      const t = data.result?.list?.[0]
      if (!t) return null
      return {
        symbol,
        price: parseFloat(t.lastPrice),
        change24h: parseFloat(t.price24hPcnt) * parseFloat(t.prevPrice24h),
        changePct24h: parseFloat(t.price24hPcnt) * 100,
        volume24h: parseFloat(t.turnover24h),
        high24h: parseFloat(t.highPrice24h),
        low24h: parseFloat(t.lowPrice24h),
        open24h: parseFloat(t.prevPrice24h),
      }
    } catch { return null }
  }

  async getKlines(symbol: string, interval: KlineInterval, limit = 200): Promise<ExchangeOHLCV[]> {
    const mapped = this.mapSymbol(symbol)
    const bybitInterval = INTERVAL_MAP[interval] || '60'
    try {
      const res = await fetch(
        `${this.config.apiBase}/v5/market/kline?category=spot&symbol=${mapped}&interval=${bybitInterval}&limit=${limit}`,
        { next: { revalidate: 60 } }
      )
      const data = await res.json()
      if (data.retCode !== 0) return []
      return (data.result?.list ?? []).reverse().map((k: string[]) => ({
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

    const data = await this.request('POST', '/v5/order/create', {}, {
      category: 'spot', symbol: mapped, side: 'Buy', orderType: 'Market', qty,
    })
    if (data.retCode !== 0) throw new Error(`Bybit: ${data.retMsg}`)

    return {
      orderId: data.result?.orderId ?? '',
      symbol, side: 'BUY', type: 'MARKET',
      executedQty: parseFloat(qty),
      avgPrice: ticker.price,
      status: 'FILLED',
    }
  }

  async marketSell(symbol: string, quantity: number): Promise<ExchangeOrder | null> {
    const mapped = this.mapSymbol(symbol)
    const data = await this.request('POST', '/v5/order/create', {}, {
      category: 'spot', symbol: mapped, side: 'Sell', orderType: 'Market', qty: quantity.toFixed(6),
    })
    if (data.retCode !== 0) throw new Error(`Bybit: ${data.retMsg}`)

    return {
      orderId: data.result?.orderId ?? '',
      symbol, side: 'SELL', type: 'MARKET',
      executedQty: quantity, avgPrice: 0,
      status: 'FILLED',
    }
  }

  async setStopLoss(symbol: string, quantity: number, stopPrice: number): Promise<boolean> {
    const mapped = this.mapSymbol(symbol)
    try {
      const data = await this.request('POST', '/v5/order/create', {}, {
        category: 'spot', symbol: mapped, side: 'Sell', orderType: 'Market',
        qty: quantity.toFixed(6),
        triggerPrice: stopPrice.toFixed(2),
        triggerDirection: 2, // 2 = triggers when price falls
        orderFilter: 'StopOrder',
      })
      return data.retCode === 0
    } catch { return false }
  }

  async setTakeProfit(symbol: string, quantity: number, price: number): Promise<boolean> {
    const mapped = this.mapSymbol(symbol)
    try {
      const data = await this.request('POST', '/v5/order/create', {}, {
        category: 'spot', symbol: mapped, side: 'Sell', orderType: 'Market',
        qty: quantity.toFixed(6),
        triggerPrice: price.toFixed(2),
        triggerDirection: 1, // 1 = triggers when price rises
        orderFilter: 'StopOrder',
      })
      return data.retCode === 0
    } catch { return false }
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    const mapped = this.mapSymbol(symbol)
    try {
      await this.request('POST', '/v5/order/cancel-all', {}, { category: 'spot', symbol: mapped })
    } catch { /* ok */ }
  }

  async testConnection() {
    try {
      const data = await this.request('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' })
      if (data.retCode !== 0) return { success: false, canTrade: false, canWithdraw: false, quoteBalance: 0, error: data.retMsg }
      const coins = data.result?.list?.[0]?.coin ?? []
      const usdt = coins.find((c: { coin: string }) => c.coin === 'USDT')
      return {
        success: true, canTrade: true, canWithdraw: false,
        quoteBalance: usdt ? parseFloat(usdt.availableToWithdraw || '0') : 0,
      }
    } catch (err) {
      return { success: false, canTrade: false, canWithdraw: false, quoteBalance: 0, error: String(err) }
    }
  }
}
