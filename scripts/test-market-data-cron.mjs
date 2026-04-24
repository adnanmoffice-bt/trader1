/**
 * Simulate what /api/cron/market-data does, step by step.
 * Helps diagnose why market_data table is frozen since 2026-04-06.
 */

const YAHOO_SYMBOLS = {
  'BRENT':   'BZ=F',
  'WTI':     'CL=F',
  'XAU/USD': 'GC=F',
  'XAG/USD': 'SI=F',
  'SPY':     'SPY',
  'QQQ':     'QQQ',
  'EUR/USD': 'EURUSD=X',
  'GBP/USD': 'GBPUSD=X',
  'USD/JPY': 'JPY=X',
}

const BINANCE_SYMBOLS = {
  'BTC/USD': 'BTCUSDT',
  'ETH/USD': 'ETHUSDT',
  'SOL/USD': 'SOLUSDT',
  'BNB/USD': 'BNBUSDT',
  'DOGE/USD': 'DOGEUSDT',
  'AVAX/USD': 'AVAXUSDT',
  'LINK/USD': 'LINKUSDT',
  'XAU/USD': 'PAXGUSDT',
}

async function fetchBinanceTicker(sym) {
  const bSym = BINANCE_SYMBOLS[sym]
  if (!bSym) return null
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${bSym}`)
    if (!res.ok) return null
    const d = await res.json()
    return { sym, price: parseFloat(d.lastPrice), source: 'binance' }
  } catch (e) { return { sym, error: String(e).slice(0, 60) } }
}

async function fetchYahooPrice(sym, yahoo) {
  try {
    const t0 = Date.now()
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yahoo}?interval=1d&range=2d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
    const ms = Date.now() - t0
    if (!res.ok) return { sym, error: `HTTP ${res.status}`, ms }
    const data = await res.json()
    const meta = data?.chart?.result?.[0]?.meta
    if (!meta) return { sym, error: 'no meta', ms }
    return { sym, price: meta.regularMarketPrice, source: 'yahoo', ms }
  } catch (e) {
    return { sym, error: String(e).slice(0, 60) }
  }
}

console.log('=== Simulate fetchAllMarketData() ===\n')
const t0 = Date.now()

console.log('1) Binance crypto (parallel):')
const cryptoResults = await Promise.allSettled(
  Object.keys(BINANCE_SYMBOLS).map(s => fetchBinanceTicker(s))
)
for (const r of cryptoResults) {
  if (r.status === 'fulfilled' && r.value) {
    const v = r.value
    console.log(`  ${v.sym.padEnd(10)} ${v.price ?? 'ERR: ' + v.error}`)
  }
}

console.log('\n2) Yahoo commodities/forex (parallel):')
const yahooResults = await Promise.allSettled(
  Object.entries(YAHOO_SYMBOLS).map(([s, y]) => fetchYahooPrice(s, y))
)
for (const r of yahooResults) {
  if (r.status === 'fulfilled' && r.value) {
    const v = r.value
    console.log(`  ${v.sym.padEnd(10)} ${v.price ?? 'ERR: ' + v.error}  (${v.ms}ms)`)
  } else {
    console.log(`  rejected: ${r.reason}`)
  }
}

const ms = Date.now() - t0
console.log(`\nTotal: ${ms}ms (${(ms/1000).toFixed(1)}s)  |  Cron maxDuration = 30s`)
