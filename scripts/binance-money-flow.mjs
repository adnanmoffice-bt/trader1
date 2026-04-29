/**
 * Trace where USDT went on Binance over the last 30 days.
 * Read-only. Calls:
 *   - GET /sapi/v1/asset/transfer            (universal transfers between Spot/Funding/Margin/etc.)
 *   - GET /sapi/v1/simple-earn/flexible/history/subscriptionRecord (Spot → Earn)
 *   - GET /sapi/v1/simple-earn/flexible/history/redemptionRecord    (Earn → Spot)
 *   - GET /sapi/v1/convert/tradeFlow         (Convert)
 *   - GET /sapi/v1/capital/deposit/hisrec    (Deposits)
 *   - GET /sapi/v1/capital/withdraw/history  (Withdrawals)
 *   - GET /api/v3/myTrades                   (Spot trades — we already know it's 0 but recheck)
 *
 * Usage: node scripts/binance-money-flow.mjs [days=30]
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
const DAYS = Number(process.argv[2] || 30)
const SINCE = Date.now() - DAYS * 86400 * 1000

if (!API || !SECRET) { console.error('Missing keys'); process.exit(1) }

function sign(qs) { return crypto.createHmac('sha256', SECRET).update(qs).digest('hex') }
async function signedGet(endpoint, extra = {}) {
  const params = new URLSearchParams({ timestamp: Date.now().toString(), recvWindow: '10000', ...extra })
  const qs = params.toString()
  const url = `${BASE}${endpoint}?${qs}&signature=${sign(qs)}`
  const res = await fetch(url, { headers: { 'X-MBX-APIKEY': API } })
  const text = await res.text()
  try { return { status: res.status, data: JSON.parse(text) } }
  catch { return { status: res.status, data: { raw: text } } }
}
function dubai(ts) { return new Date(Number(ts)).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', hour12: false }) }

console.log(`=== Binance money flow trace — last ${DAYS} days ===`)
console.log(`Since ${dubai(SINCE)} Dubai\n`)

// 1. Universal transfers — every direction (Spot↔Funding, Spot↔Margin, etc.)
const directions = [
  'MAIN_FUNDING', 'FUNDING_MAIN', 'MAIN_UMFUTURE', 'UMFUTURE_MAIN',
  'MAIN_CMFUTURE', 'CMFUTURE_MAIN', 'MAIN_MARGIN', 'MARGIN_MAIN',
  'FUNDING_UMFUTURE', 'UMFUTURE_FUNDING', 'MARGIN_UMFUTURE', 'UMFUTURE_MARGIN',
  'FUNDING_MARGIN', 'MARGIN_FUNDING', 'FUNDING_CMFUTURE', 'CMFUTURE_FUNDING',
]

console.log('━━━ ASSET TRANSFERS (between wallet types) ━━━')
let anyTx = false
for (const type of directions) {
  const r = await signedGet('/sapi/v1/asset/transfer', { type, startTime: String(SINCE), size: '100' })
  if (r.status !== 200) continue
  const rows = r.data.rows || []
  if (rows.length === 0) continue
  anyTx = true
  console.log(`\n  ${type}:`)
  for (const t of rows) {
    console.log(`    ${dubai(t.timestamp)}  ${t.asset.padEnd(6)} ${t.amount}   status=${t.status}`)
  }
}
if (!anyTx) console.log('  (no inter-wallet transfers in window)')

// 2. Simple Earn subscriptions (Spot → Earn)
console.log('\n━━━ SIMPLE EARN — subscriptions (Spot → Earn) ━━━')
{
  const r = await signedGet('/sapi/v1/simple-earn/flexible/history/subscriptionRecord', {
    startTime: String(SINCE), size: '100', current: '1',
  })
  if (r.status !== 200) console.log('  ERR', r.data)
  else {
    const rows = r.data.rows || []
    if (rows.length === 0) console.log('  (no subscriptions)')
    for (const x of rows) {
      console.log(`  ${dubai(x.time)}  ${x.asset.padEnd(6)} amount=${x.amount}  status=${x.status}  productId=${x.productId}  type=${x.type}  src=${x.sourceAccount}`)
    }
  }
}

// 3. Simple Earn redemptions (Earn → Spot)
console.log('\n━━━ SIMPLE EARN — redemptions (Earn → Spot) ━━━')
{
  const r = await signedGet('/sapi/v1/simple-earn/flexible/history/redemptionRecord', {
    startTime: String(SINCE), size: '100', current: '1',
  })
  if (r.status !== 200) console.log('  ERR', r.data)
  else {
    const rows = r.data.rows || []
    if (rows.length === 0) console.log('  (no redemptions)')
    for (const x of rows) {
      console.log(`  ${dubai(x.time)}  ${x.asset.padEnd(6)} amount=${x.amount}  principal=${x.principal}  interest=${x.interest}  status=${x.status}`)
    }
  }
}

// 4. Convert trades (Spot Convert)
console.log('\n━━━ CONVERT trades ━━━')
{
  const r = await signedGet('/sapi/v1/convert/tradeFlow', { startTime: String(SINCE), endTime: String(Date.now()), limit: '100' })
  if (r.status !== 200) console.log('  ERR', r.data)
  else {
    const rows = r.data.list || r.data || []
    if (Array.isArray(rows) && rows.length === 0) console.log('  (no converts)')
    else if (Array.isArray(rows)) {
      for (const c of rows) {
        console.log(`  ${dubai(c.createTime)}  ${c.fromAsset} ${c.fromAmount} → ${c.toAsset} ${c.toAmount}  status=${c.orderStatus}`)
      }
    } else { console.log('  unexpected:', JSON.stringify(rows).slice(0,300)) }
  }
}

// 5. Deposits + Withdrawals
console.log('\n━━━ DEPOSITS ━━━')
{
  const r = await signedGet('/sapi/v1/capital/deposit/hisrec', { startTime: String(SINCE), endTime: String(Date.now()) })
  if (r.status !== 200) console.log('  ERR', r.data)
  else if (!Array.isArray(r.data) || r.data.length === 0) console.log('  (none)')
  else for (const d of r.data) {
    console.log(`  ${dubai(d.insertTime)}  ${d.coin} amount=${d.amount}  network=${d.network}  status=${d.status}`)
  }
}

console.log('\n━━━ WITHDRAWALS ━━━')
{
  const r = await signedGet('/sapi/v1/capital/withdraw/history', { startTime: String(SINCE), endTime: String(Date.now()) })
  if (r.status !== 200) console.log('  ERR', r.data)
  else if (!Array.isArray(r.data) || r.data.length === 0) console.log('  (none)')
  else for (const w of r.data) {
    console.log(`  ${dubai(w.applyTime)}  ${w.coin} amount=${w.amount}  network=${w.network}  status=${w.status}  txid=${w.txId}`)
  }
}

// 6. Spot myTrades (recheck for 30d window since previous check was 7d)
console.log('\n━━━ SPOT myTrades (USDT pairs) — 30 days ━━━')
const SYMS = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','LINKUSDT','DOGEUSDT','AVAXUSDT','ADAUSDT','DOTUSDT','POLUSDT','NEARUSDT','APTUSDT']
let anyFill = false
for (const sym of SYMS) {
  const r = await signedGet('/api/v3/myTrades', { symbol: sym, startTime: String(SINCE), limit: '1000' })
  if (r.status !== 200) continue
  const fills = r.data
  if (!fills || fills.length === 0) continue
  anyFill = true
  console.log(`\n  ${sym} (${fills.length} fills):`)
  for (const f of fills) {
    const side = f.isBuyer ? 'BUY ' : 'SELL'
    console.log(`    ${dubai(f.time)}  ${side} qty=${f.qty}  px=${f.price}  notional=$${Number(f.quoteQty).toFixed(2)}  fee=${f.commission} ${f.commissionAsset}  order#${f.orderId}`)
  }
}
if (!anyFill) console.log('  (no spot fills on any USDT pair in 30 days)')
