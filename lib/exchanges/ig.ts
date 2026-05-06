// ══════════════════════════════════════════════════════════════════════════════
// IG Group exchange adapter — gold, oil, FX, indices via CFDs
// ══════════════════════════════════════════════════════════════════════════════
//
// Why this exists:
//   Binance has no execution path for spot gold (PAXGUSDT is structurally
//   broken — see docs/GOLD_OIL_VENUE_DECISION.md), Brent, or WTI. IG is a
//   DFSA-licensed UAE CFD broker that gives us all three plus FX/indices via
//   a single REST API. This adapter is consumed by getExchangeForInstrument()
//   in lib/exchanges/index.ts; crypto continues to route to Binance.
//
// Auth model (different from every other adapter in this folder):
//   IG uses two stateful headers, CST and X-SECURITY-TOKEN, returned by
//   POST /session in response headers. They live ~6h. We cache them on the
//   instance and re-auth lazily when we get a 401. The static API key
//   (X-IG-API-KEY) is sent on every request.
//
// What this adapter does NOT do (deliberately):
//   - Lift XAU/USD off LIVE_INSTRUMENT_BLACKLIST. That's a separate operator
//     decision after testConnection() works end-to-end and 30d demo expectancy
//     turns positive on this venue.
//   - Persist session tokens across cold starts. Vercel functions are
//     short-lived and IG has no rate limit on /session. We re-auth per cold
//     start, which is fine.
//   - Disable the edge gate. checkLiveTradingAllowed() still applies and will
//     block real IG orders too until 30d rolling expectancy clears -0.05 R/trade.
//
// Required env vars:
//   IG_API_KEY      — REST API key from MyIG → Settings → My API Keys
//   IG_USERNAME     — IG login username (NOT email)
//   IG_PASSWORD     — IG login password
//   IG_ACCOUNT_ID   — account identifier shown in MyIG dashboard (e.g. "Z1ABCD")
//   IG_BASE_URL     — optional. Defaults to live (api.ig.com). Override to
//                     demo-api.ig.com/gateway/deal for paper testing.
//
// Spec reference: https://labs.ig.com/rest-trading-api-reference

import type {
  IExchange,
  ExchangeConfig,
  ExchangeBalance,
  ExchangeTicker,
  ExchangeOHLCV,
  ExchangeOrder,
  KlineInterval,
  ExchangeCredentials,
} from './types'
import { EXCHANGE_CONFIGS } from './types'

// ── Symbol → IG epic mapping ───────────────────────────────────────────────
// Verified on 2026-05-06 against operator account APSTU (USD CFD, MEA region).
// `.BMU.IP` variants return live spot prices; the older `.UNC.IP` and
// `.CFDGC.IP` epics on this account either don't exist or return stale
// historical prices (e.g. CS.D.CFDGOLD.CFDGC.IP shows $1404 vs real spot $4719).
// Re-run scripts/test-ig-connection.mjs after any account migration to
// re-verify the correct epic for this region.
// Note: symbol keys match `Instrument` type in `types/index.ts`. Crypto is
// FOO/USD style; oil is bare 'BRENT'/'WTI' (no /USD suffix) because the
// Yahoo Finance fallback path uses those keys throughout the codebase.
const SYMBOL_MAP: Record<string, string> = {
  'XAU/USD': 'CS.D.CFDGOLD.BMU.IP', // Spot Gold ($1 contract) — verified $4719
  'XAG/USD': 'CS.D.CFDSILVER.BMU.IP', // Spot Silver (untested but follows BMU pattern)
  'WTI':     'CC.D.CL.BMU.IP', // US Crude Oil — verified $88.42
  'BRENT':   'CC.D.LCO.BMU.IP', // Brent Crude — verified $97.26
}

// IG kline resolutions — only a fixed set is supported.
const RESOLUTION_MAP: Record<KlineInterval, string> = {
  '1m': 'MINUTE',
  '5m': 'MINUTE_5',
  '15m': 'MINUTE_15',
  '1h': 'HOUR',
  '4h': 'HOUR_4',
  '1d': 'DAY',
}

interface IGSessionState {
  cst: string
  xst: string
  expiresAt: number
}

export class IGExchange implements IExchange {
  readonly config: ExchangeConfig
  private apiKey: string
  private username: string
  private password: string
  private accountId: string
  private baseUrl: string
  private session: IGSessionState | null = null

  constructor(creds?: ExchangeCredentials) {
    this.config = { ...EXCHANGE_CONFIGS.ig, symbolMap: SYMBOL_MAP }
    // IG-specific creds are NOT in ExchangeCredentials (which only has
    // apiKey/secretKey/passphrase). We read them straight from env.
    this.apiKey = creds?.apiKey || process.env.IG_API_KEY || ''
    this.username = process.env.IG_USERNAME || ''
    this.password = process.env.IG_PASSWORD || ''
    this.accountId = process.env.IG_ACCOUNT_ID || ''
    this.baseUrl = process.env.IG_BASE_URL || this.config.apiBase
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.username && this.password && this.accountId)
  }

  // ── Auth ─────────────────────────────────────────────────────────────────

  private async authenticate(): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error(
        'IG: missing credentials (need IG_API_KEY, IG_USERNAME, IG_PASSWORD, IG_ACCOUNT_ID env vars)',
      )
    }

    const res = await fetch(`${this.baseUrl}/session`, {
      method: 'POST',
      headers: {
        'X-IG-API-KEY': this.apiKey,
        'Version': '2',
        'Content-Type': 'application/json',
        Accept: 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        identifier: this.username,
        password: this.password,
      }),
    })

    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`IG auth failed: HTTP ${res.status} ${txt.slice(0, 200)}`)
    }

    const cst = res.headers.get('CST')
    const xst = res.headers.get('X-SECURITY-TOKEN')
    if (!cst || !xst) {
      throw new Error('IG auth: missing CST or X-SECURITY-TOKEN in response headers')
    }

    this.session = {
      cst,
      xst,
      expiresAt: Date.now() + 5 * 60 * 60 * 1000, // re-auth every 5h to be safe (real life ~6h)
    }

    // Switch to the requested account (no-op if already current).
    try {
      await this.request('PUT', '/session', { accountId: this.accountId }, '1')
    } catch {
      // PUT /session can return 412 if already on that account — non-fatal.
    }
  }

  private async ensureSession(): Promise<void> {
    if (!this.session || Date.now() >= this.session.expiresAt) {
      await this.authenticate()
    }
  }

  // ── HTTP ─────────────────────────────────────────────────────────────────

  private async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    body?: Record<string, unknown>,
    version = '2',
  ): Promise<unknown> {
    await this.ensureSession()
    const url = `${this.baseUrl}${endpoint}`
    const headers: Record<string, string> = {
      'X-IG-API-KEY': this.apiKey,
      Version: version,
      Accept: 'application/json; charset=UTF-8',
      CST: this.session!.cst,
      'X-SECURITY-TOKEN': this.session!.xst,
    }
    if (body) headers['Content-Type'] = 'application/json'

    // IG quirk: DELETE-like ops on positions/working orders use POST + _method:DELETE
    let actualMethod: string = method
    if (method === 'DELETE') {
      actualMethod = 'POST'
      headers['_method'] = 'DELETE'
    }

    const res = await fetch(url, {
      method: actualMethod,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    // Auto-recover from session expiry once.
    if (res.status === 401) {
      this.session = null
      await this.ensureSession()
      return this.request(method, endpoint, body, version)
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`IG ${method} ${endpoint} → HTTP ${res.status}: ${txt.slice(0, 300)}`)
    }

    if (res.status === 204) return null
    const text = await res.text()
    return text ? JSON.parse(text) : null
  }

  private mapSymbol(symbol: string): string {
    return this.config.symbolMap[symbol] || symbol
  }

  // ── Account ──────────────────────────────────────────────────────────────

  async getBalances(): Promise<ExchangeBalance[]> {
    interface AccountsRes {
      accounts: { accountId: string; currency: string; balance: { balance: number; deposit: number; profitLoss: number; available: number } }[]
    }
    const data = (await this.request('GET', '/accounts', undefined, '1')) as AccountsRes
    const acc = data.accounts.find(a => a.accountId === this.accountId) ?? data.accounts[0]
    if (!acc) return []
    return [
      {
        asset: acc.currency,
        free: acc.balance.available ?? 0,
        locked: (acc.balance.balance ?? 0) - (acc.balance.available ?? 0),
        total: acc.balance.balance ?? 0,
      },
    ]
  }

  async getQuoteBalance(): Promise<number> {
    const balances = await this.getBalances()
    return balances[0]?.free ?? 0
  }

  // ── Market Data ──────────────────────────────────────────────────────────

  async getTicker(symbol: string): Promise<ExchangeTicker | null> {
    const epic = this.mapSymbol(symbol)
    try {
      interface MarketRes {
        snapshot: {
          bid: number
          offer: number
          high: number
          low: number
          netChange: number
          percentageChange: number
          updateTime: string
          marketStatus: string
        }
      }
      const data = (await this.request('GET', `/markets/${encodeURIComponent(epic)}`, undefined, '3')) as MarketRes
      const mid = (data.snapshot.bid + data.snapshot.offer) / 2
      return {
        symbol,
        price: mid,
        change24h: data.snapshot.netChange,
        changePct24h: data.snapshot.percentageChange,
        volume24h: 0, // IG doesn't expose 24h volume on snapshot
        high24h: data.snapshot.high,
        low24h: data.snapshot.low,
        open24h: mid - data.snapshot.netChange,
      }
    } catch {
      return null
    }
  }

  async getKlines(symbol: string, interval: KlineInterval, limit = 200): Promise<ExchangeOHLCV[]> {
    const epic = this.mapSymbol(symbol)
    const resolution = RESOLUTION_MAP[interval] ?? 'HOUR'
    try {
      interface PricesRes {
        prices: {
          snapshotTime: string
          openPrice: { bid: number; ask: number }
          closePrice: { bid: number; ask: number }
          highPrice: { bid: number; ask: number }
          lowPrice: { bid: number; ask: number }
          lastTradedVolume?: number
        }[]
      }
      const data = (await this.request(
        'GET',
        `/prices/${encodeURIComponent(epic)}?resolution=${resolution}&max=${limit}&pageSize=0`,
        undefined,
        '3',
      )) as PricesRes
      return (data.prices ?? []).map(p => {
        const mid = (px: { bid: number; ask: number }) => (px.bid + px.ask) / 2
        return {
          timestamp: new Date(p.snapshotTime + 'Z').getTime(),
          open: mid(p.openPrice),
          high: mid(p.highPrice),
          low: mid(p.lowPrice),
          close: mid(p.closePrice),
          volume: p.lastTradedVolume ?? 0,
        }
      })
    } catch {
      return []
    }
  }

  // ── Trading ──────────────────────────────────────────────────────────────
  //
  // Sizing note: IG positions take "size" in contract units, not USD notional.
  //   - Spot Gold ($1/contract): size = USD risk / (SL distance in price points)
  //   - WTI ($10/contract typically): size = USD risk / (10 × SL distance)
  // Because we receive notionalUsd here without knowing SL, we approximate:
  //   size = notionalUsd / current price.
  // For Spot Gold @ $2400, $50 notional → size 0.02 (0.02 oz exposure ≈ $48
  // P&L per $1 move). The war-room SL is set in a follow-up call which IG
  // can attach atomically via the same /positions/otc payload — preferred
  // path is marketBuyWithSL (extension). For now we keep the IExchange
  // contract: marketBuy returns the deal, then setStopLoss attaches SL via
  // amend.

  private async resolveDealId(symbol: string): Promise<string | null> {
    const epic = this.mapSymbol(symbol)
    try {
      interface PositionsRes {
        positions: { position: { dealId: string; size: number; direction: 'BUY' | 'SELL' }; market: { epic: string } }[]
      }
      const data = (await this.request('GET', '/positions', undefined, '2')) as PositionsRes
      const found = data.positions.find(p => p.market.epic === epic)
      return found?.position.dealId ?? null
    } catch {
      return null
    }
  }

  async marketBuy(symbol: string, notionalUsd: number): Promise<ExchangeOrder | null> {
    const epic = this.mapSymbol(symbol)
    const ticker = await this.getTicker(symbol)
    if (!ticker) throw new Error(`IG: cannot fetch ticker for ${symbol} (epic ${epic})`)

    // Crude size approximation; refine per instrument once we see real fills.
    const size = Math.max(0.5, Number((notionalUsd / ticker.price).toFixed(2)))

    interface DealRes {
      dealReference: string
    }
    interface ConfirmRes {
      dealId: string
      dealStatus: 'ACCEPTED' | 'REJECTED'
      reason?: string
      level: number
      size: number
      direction: 'BUY' | 'SELL'
      epic: string
    }

    const deal = (await this.request(
      'POST',
      '/positions/otc',
      {
        epic,
        expiry: '-',
        direction: 'BUY',
        size,
        orderType: 'MARKET',
        guaranteedStop: false,
        forceOpen: true,
        currencyCode: 'USD',
      },
      '2',
    )) as DealRes

    // Confirm — IG returns a reference, then you query the result.
    const confirm = (await this.request('GET', `/confirms/${deal.dealReference}`, undefined, '1')) as ConfirmRes
    if (confirm.dealStatus !== 'ACCEPTED') {
      throw new Error(`IG order rejected: ${confirm.reason ?? 'unknown'}`)
    }

    return {
      orderId: confirm.dealId,
      symbol,
      side: 'BUY',
      type: 'MARKET',
      executedQty: confirm.size,
      avgPrice: confirm.level,
      status: 'FILLED',
    }
  }

  async marketSell(symbol: string, quantity: number): Promise<ExchangeOrder | null> {
    const dealId = await this.resolveDealId(symbol)
    if (!dealId) {
      throw new Error(`IG: no open position to sell on ${symbol}`)
    }

    interface DealRes { dealReference: string }
    interface ConfirmRes { dealId: string; dealStatus: 'ACCEPTED' | 'REJECTED'; reason?: string; level: number; size: number }

    const deal = (await this.request(
      'POST',
      '/positions/otc',
      {
        dealId,
        direction: 'SELL',
        size: quantity,
        orderType: 'MARKET',
      },
      '1',
    )) as DealRes

    const confirm = (await this.request('GET', `/confirms/${deal.dealReference}`, undefined, '1')) as ConfirmRes
    if (confirm.dealStatus !== 'ACCEPTED') {
      throw new Error(`IG close rejected: ${confirm.reason ?? 'unknown'}`)
    }

    return {
      orderId: confirm.dealId,
      symbol,
      side: 'SELL',
      type: 'MARKET',
      executedQty: confirm.size,
      avgPrice: confirm.level,
      status: 'FILLED',
    }
  }

  async setStopLoss(symbol: string, _quantity: number, stopPrice: number): Promise<boolean> {
    void _quantity
    const dealId = await this.resolveDealId(symbol)
    if (!dealId) return false
    try {
      await this.request('PUT', `/positions/otc/${dealId}`, { stopLevel: stopPrice }, '2')
      return true
    } catch {
      return false
    }
  }

  async setTakeProfit(symbol: string, _quantity: number, price: number): Promise<boolean> {
    void _quantity
    const dealId = await this.resolveDealId(symbol)
    if (!dealId) return false
    try {
      await this.request('PUT', `/positions/otc/${dealId}`, { limitLevel: price }, '2')
      return true
    } catch {
      return false
    }
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    const epic = this.mapSymbol(symbol)
    try {
      interface OrdersRes {
        workingOrders: { workingOrderData: { dealId: string }; marketData: { epic: string } }[]
      }
      const data = (await this.request('GET', '/workingorders', undefined, '2')) as OrdersRes
      for (const o of data.workingOrders ?? []) {
        if (o.marketData.epic === epic) {
          await this.request('DELETE', `/workingorders/otc/${o.workingOrderData.dealId}`, undefined, '2').catch(() => {})
        }
      }
    } catch {
      /* ok */
    }
  }

  async testConnection() {
    try {
      await this.authenticate()
      const balances = await this.getBalances()
      return {
        success: true,
        canTrade: true, // IG accounts always have trading once funded
        canWithdraw: false, // we cannot infer from API; assume false (safer)
        quoteBalance: balances[0]?.free ?? 0,
      }
    } catch (err) {
      return {
        success: false,
        canTrade: false,
        canWithdraw: false,
        quoteBalance: 0,
        error: String(err),
      }
    }
  }
}
