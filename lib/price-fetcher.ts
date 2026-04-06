import type { MarketData, OHLCV } from '@/types'

const BINANCE_REST = 'https://api.binance.com/api/v3'
const COINGECKO    = 'https://api.coingecko.com/api/v3'
const FEAR_GREED   = 'https://api.alternative.me/fng'

// ─── Symbol Maps ──────────────────────────────────────────────────────────────

const BINANCE_SYMBOLS: Record<string, string> = {
  'BTC/USD': 'BTCUSDT',
  'ETH/USD': 'ETHUSDT',
  'SOL/USD': 'SOLUSDT',
  'BNB/USD': 'BNBUSDT',
  'XAU/USD': 'PAXGUSDT',  // PAX Gold tracks real gold price
}

const YAHOO_SYMBOLS: Record<string, string> = {
  'BRENT':   'BZ=F',
  'WTI':     'CL=F',
  'XAU/USD': 'GC=F',
  'XAG/USD': 'SI=F',
  'SPY':     'SPY',
  'QQQ':     'QQQ',
  'EUR/USD': 'EURUSD=X',
  'USD/JPY': 'JPY=X',
}

// ─── Binance ──────────────────────────────────────────────────────────────────

export async function fetchBinanceTicker(symbol: string): Promise<MarketData | null> {
  const binanceSym = BINANCE_SYMBOLS[symbol]
  if (!binanceSym) return null

  try {
    const res = await fetch(`${BINANCE_REST}/ticker/24hr?symbol=${binanceSym}`, {
      next: { revalidate: 30 },
    })
    if (!res.ok) return null
    const d = await res.json()

    return {
      id:            crypto.randomUUID(),
      symbol,
      price:         parseFloat(d.lastPrice),
      change_24h:    parseFloat(d.priceChange),
      change_pct_24h:parseFloat(d.priceChangePercent),
      volume_24h:    parseFloat(d.quoteVolume),
      high_24h:      parseFloat(d.highPrice),
      low_24h:       parseFloat(d.lowPrice),
      open_24h:      parseFloat(d.openPrice),
      market_cap:    null,
      source:        'binance',
      fetched_at:    new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export async function fetchBinanceKlines(
  symbol: string,
  interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d',
  limit = 200
): Promise<OHLCV[]> {
  const binanceSym = BINANCE_SYMBOLS[symbol]
  if (!binanceSym) return []

  try {
    const res = await fetch(
      `${BINANCE_REST}/klines?symbol=${binanceSym}&interval=${interval}&limit=${limit}`,
      { next: { revalidate: 60 } }
    )
    if (!res.ok) return []
    const data: number[][] = await res.json()

    return data.map(k => ({
      timestamp: k[0],
      open:      parseFloat(String(k[1])),
      high:      parseFloat(String(k[2])),
      low:       parseFloat(String(k[3])),
      close:     parseFloat(String(k[4])),
      volume:    parseFloat(String(k[5])),
    }))
  } catch {
    return []
  }
}

/** Fetch historical klines with pagination for backtesting */
export async function fetchBinanceKlinesRange(
  symbol: string,
  interval: string,
  startMs: number,
  endMs: number
): Promise<OHLCV[]> {
  const binanceSym = BINANCE_SYMBOLS[symbol]
  if (!binanceSym) return []

  const all: OHLCV[] = []
  let current = startMs

  while (current < endMs) {
    try {
      const url =
        `${BINANCE_REST}/klines?symbol=${binanceSym}&interval=${interval}` +
        `&startTime=${current}&endTime=${endMs}&limit=1000`
      const res  = await fetch(url)
      if (!res.ok) break
      const data: number[][] = await res.json()
      if (!data.length) break

      all.push(...data.map(k => ({
        timestamp: k[0],
        open:      parseFloat(String(k[1])),
        high:      parseFloat(String(k[2])),
        low:       parseFloat(String(k[3])),
        close:     parseFloat(String(k[4])),
        volume:    parseFloat(String(k[5])),
      })))

      current = data[data.length - 1][6] + 1 // close_time + 1ms
    } catch {
      break
    }
  }

  return all
}

// ─── Yahoo Finance Candles (for commodities/forex/indices) ───────────────────

export async function fetchYahooKlines(symbol: string, limit = 100): Promise<OHLCV[]> {
  const yahooSym = YAHOO_SYMBOLS[symbol]
  if (!yahooSym) return []

  try {
    const range = limit > 100 ? '6mo' : '1mo'
    const interval = '1h'
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=${interval}&range=${range}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 300 } }
    )
    if (!res.ok) return []
    const data = await res.json()
    const result = data?.chart?.result?.[0]
    if (!result) return []

    const timestamps = result.timestamp ?? []
    const quotes = result.indicators?.quote?.[0] ?? {}
    const { open = [], high = [], low = [], close = [], volume = [] } = quotes

    const candles: OHLCV[] = []
    for (let i = 0; i < timestamps.length; i++) {
      if (open[i] == null || close[i] == null) continue
      candles.push({
        timestamp: timestamps[i] * 1000,
        open: open[i], high: high[i] ?? open[i],
        low: low[i] ?? open[i], close: close[i],
        volume: volume[i] ?? 0,
      })
    }
    return candles.slice(-limit)
  } catch {
    return []
  }
}

// ─── Universal Candle Fetcher ────────────────────────────────────────────────

export async function fetchKlines(symbol: string, interval: string, limit = 200): Promise<OHLCV[]> {
  // Try Binance first (more reliable for crypto + gold)
  const binanceData = await fetchBinanceKlines(symbol, interval as '1h', limit)
  if (binanceData.length > 0) return binanceData

  // Fallback to Yahoo for commodities/forex/indices
  const yahooData = await fetchYahooKlines(symbol, limit)
  if (yahooData.length > 0) return yahooData

  return []
}

// ─── CoinGecko ────────────────────────────────────────────────────────────────

const CG_IDS: Record<string, string> = {
  'BTC/USD': 'bitcoin',
  'ETH/USD': 'ethereum',
  'SOL/USD': 'solana',
}

export async function fetchCoinGeckoMarkets(): Promise<MarketData[]> {
  const apiKey = process.env.COINGECKO_API_KEY || ''
  const ids    = Object.values(CG_IDS).join(',')
  const headers: Record<string, string> = apiKey ? { 'x-cg-demo-api-key': apiKey } : {}

  try {
    const res = await fetch(
      `${COINGECKO}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`,
      { headers, next: { revalidate: 60 } }
    )
    if (!res.ok) return []
    const data = await res.json()

    return Object.entries(CG_IDS).map(([symbol, id]) => ({
      id:             crypto.randomUUID(),
      symbol,
      price:          data[id]?.usd ?? 0,
      change_24h:     0,
      change_pct_24h: data[id]?.usd_24h_change ?? 0,
      volume_24h:     data[id]?.usd_24h_vol ?? 0,
      high_24h:       0,
      low_24h:        0,
      open_24h:       0,
      market_cap:     data[id]?.usd_market_cap ?? null,
      source:         'coingecko',
      fetched_at:     new Date().toISOString(),
    }))
  } catch {
    return []
  }
}

// ─── Fear & Greed ─────────────────────────────────────────────────────────────

export interface FearGreedData {
  value: number
  classification: string
  timestamp: string
}

export async function fetchFearGreed(limit = 7): Promise<FearGreedData[]> {
  try {
    const res  = await fetch(`${FEAR_GREED}/?limit=${limit}`, { next: { revalidate: 3600 } })
    if (!res.ok) return []
    const data = await res.json()
    return (data.data as Array<{ value: string; value_classification: string; timestamp: string }>)
      .map(d => ({
        value:          parseInt(d.value),
        classification: d.value_classification,
        timestamp:      new Date(parseInt(d.timestamp) * 1000).toISOString(),
      }))
  } catch {
    return []
  }
}

// ─── Polymarket ───────────────────────────────────────────────────────────────

const POLY_GAMMA = 'https://gamma-api.polymarket.com'
const POLY_CLOB  = 'https://clob.polymarket.com'

export interface PolymarketSnapshot {
  id:        string
  question:  string
  token_id:  string
  yes_price: number
  no_price:  number
  volume:    number
  end_date:  string
}

/** Fetch active financial/market prediction markets from Polymarket */
export async function fetchPolymarketMarkets(tag = 'crypto'): Promise<PolymarketSnapshot[]> {
  try {
    const res = await fetch(
      `${POLY_GAMMA}/markets?tag_slug=${tag}&active=true&limit=20&order=volume&ascending=false`,
      { next: { revalidate: 300 } }
    )
    if (!res.ok) return []
    const markets = await res.json()

    return (markets as Array<{
      id: string; question: string; clobTokenIds: string[];
      volume: number; endDate: string
    }>).map(m => ({
      id:        m.id,
      question:  m.question,
      token_id:  m.clobTokenIds?.[0] ?? '',
      yes_price: 0,  // fetched separately via CLOB
      no_price:  0,
      volume:    m.volume ?? 0,
      end_date:  m.endDate,
    }))
  } catch {
    return []
  }
}

/** Get YES token price for a Polymarket market */
export async function fetchPolymarketPrice(tokenId: string): Promise<number> {
  try {
    const res = await fetch(`${POLY_CLOB}/midpoint?token_id=${tokenId}`, {
      next: { revalidate: 30 },
    })
    if (!res.ok) return 0
    const d = await res.json()
    return parseFloat(d.mid ?? '0')
  } catch {
    return 0
  }
}

// ─── Commodity Prices (via Yahoo Finance proxy) ─────────────────────────────

async function fetchYahooPrice(symbol: string, yahooSym: string): Promise<MarketData | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=1d&range=2d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 300 } }
    )
    if (!res.ok) return null
    const data = await res.json()
    const meta = data?.chart?.result?.[0]?.meta
    if (!meta) return null

    const price = meta.regularMarketPrice ?? 0
    const prevClose = meta.previousClose ?? price

    return {
      id:             crypto.randomUUID(),
      symbol,
      price,
      change_24h:     price - prevClose,
      change_pct_24h: prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0,
      volume_24h:     meta.regularMarketVolume ?? 0,
      high_24h:       meta.regularMarketDayHigh ?? price,
      low_24h:        meta.regularMarketDayLow ?? price,
      open_24h:       meta.regularMarketOpen ?? prevClose,
      market_cap:     null,
      source:         'yahoo',
      fetched_at:     new Date().toISOString(),
    }
  } catch {
    return null
  }
}

// ─── Aggregate Fetch (used by cron) ───────────────────────────────────────────

export async function fetchAllMarketData(): Promise<MarketData[]> {
  const results: MarketData[] = []

  // Fetch crypto from Binance (fast, reliable)
  const cryptoSymbols = Object.keys(BINANCE_SYMBOLS)
  const cryptoData = await Promise.allSettled(
    cryptoSymbols.map(sym => fetchBinanceTicker(sym))
  )
  cryptoData.forEach(r => {
    if (r.status === 'fulfilled' && r.value) results.push(r.value)
  })

  // Fetch commodities from Yahoo
  const commodityFetches = Object.entries(YAHOO_SYMBOLS).map(([sym, yahoo]) =>
    fetchYahooPrice(sym, yahoo)
  )
  const commodityData = await Promise.allSettled(commodityFetches)
  commodityData.forEach(r => {
    if (r.status === 'fulfilled' && r.value) results.push(r.value)
  })

  return results
}
