/**
 * Pull actual Binance Spot trade history for the last N days.
 * Read-only. Calls GET /api/v3/myTrades for every active symbol.
 * Source of truth — bypasses Supabase entirely.
 *
 * Usage: node scripts/binance-trade-history.mjs [days]
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

function loadEnvLocal() {
  const p = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(p)) return
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
}
loadEnvLocal()

const API = process.env.BINANCE_API_KEY
const SECRET = process.env.BINANCE_SECRET_KEY
const BASE = 'https://api.binance.com'
const DAYS = Number(process.argv[2] || 7)
const SINCE = Date.now() - DAYS * 86400 * 1000

if (!API || !SECRET) { console.error('Missing BINANCE_API_KEY/SECRET'); process.exit(1) }

const SYMBOLS = [
  'BTCUSDT','ETHUSDT','XAUUSDT',
  'DOGEUSDT','AVAXUSDT','LINKUSDT',
  'ADAUSDT','DOTUSDT','POLUSDT','NEARUSDT','APTUSDT',
  'SOLUSDT','BNBUSDT',
]

function sign(qs) { return crypto.createHmac('sha256', SECRET).update(qs).digest('hex') }
async function signedGet(endpoint, extra = {}) {
  const params = new URLSearchParams({ timestamp: Date.now().toString(), recvWindow: '5000', ...extra })
  const qs = params.toString()
  const url = `${BASE}${endpoint}?${qs}&signature=${sign(qs)}`
  const res = await fetch(url, { headers: { 'X-MBX-APIKEY': API } })
  const text = await res.text()
  try { return { status: res.status, data: JSON.parse(text) } }
  catch { return { status: res.status, data: { raw: text } } }
}
function dubai(iso) { return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', hour12: false }) }

console.log(`=== Binance Spot trade history — last ${DAYS} days ===`)
console.log(`Since ${dubai(SINCE)}  Dubai\n`)

let grandTotal = 0
let totalUsdtIn = 0
let totalUsdtOut = 0
const allFills = []

for (const sym of SYMBOLS) {
  const r = await signedGet('/api/v3/myTrades', { symbol: sym, startTime: String(SINCE), limit: '1000' })
  if (r.status !== 200) {
    console.log(`  ${sym}: ERR ${r.status} ${JSON.stringify(r.data).slice(0,150)}`)
    continue
  }
  const fills = r.data
  if (!fills || fills.length === 0) {
    console.log(`  ${sym}: 0 fills`)
    continue
  }
  console.log(`\n--- ${sym} (${fills.length} fills) ---`)
  for (const f of fills) {
    const side = f.isBuyer ? 'BUY ' : 'SELL'
    const usdt = Number(f.quoteQty)
    if (f.isBuyer) totalUsdtOut += usdt; else totalUsdtIn += usdt
    grandTotal++
    allFills.push({ sym, ...f })
    console.log(`  ${dubai(f.time)}  ${side}  qty=${f.qty}  px=${f.price}  notional=$${usdt.toFixed(2)}  fee=${f.commission} ${f.commissionAsset}  order#${f.orderId}`)
  }
}

console.log(`\n=== SUMMARY (${DAYS}d) ===`)
console.log(`  Total fills: ${grandTotal}`)
console.log(`  USDT spent on buys: $${totalUsdtOut.toFixed(2)}`)
console.log(`  USDT received from sells: $${totalUsdtIn.toFixed(2)}`)
console.log(`  Net flow: $${(totalUsdtIn - totalUsdtOut).toFixed(2)}`)

const buyFills  = allFills.filter(x => x.isBuyer)
const sellFills = allFills.filter(x => !x.isBuyer)
console.log(`  Buys: ${buyFills.length}  Sells: ${sellFills.length}`)

console.log('\n=== Open orders RIGHT NOW ===')
const oo = await signedGet('/api/v3/openOrders')
if (oo.status !== 200) console.log('  ERR', oo.data)
else if (oo.data.length === 0) console.log('  (none)')
else for (const o of oo.data) {
  console.log(`  ${dubai(o.time)}  ${o.symbol} ${o.side} ${o.type} qty=${o.origQty} px=${o.price} stopPx=${o.stopPrice} status=${o.status}`)
}
