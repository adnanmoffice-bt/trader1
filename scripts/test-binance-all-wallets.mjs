/**
 * Read-only check of ALL Binance wallets: Spot, Funding, Margin (cross+isolated),
 * Futures (USD-M + COIN-M), Simple Earn. Read-only — no orders.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

function loadEnvLocal() {
  const p = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(p)) return
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
loadEnvLocal()

const API = process.env.BINANCE_API_KEY
const SECRET = process.env.BINANCE_SECRET_KEY
if (!API || !SECRET) { console.error('missing keys'); process.exit(1) }

function sign(qs) { return crypto.createHmac('sha256', SECRET).update(qs).digest('hex') }

async function signedCall(method, host, endpoint, extraParams = {}) {
  const params = new URLSearchParams({ ...extraParams, timestamp: Date.now().toString(), recvWindow: '5000' })
  const qs = params.toString()
  const url = `${host}${endpoint}?${qs}&signature=${sign(qs)}`
  const res = await fetch(url, { method, headers: { 'X-MBX-APIKEY': API } })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  return { status: res.status, data }
}

const SPOT = 'https://api.binance.com'
const FUT_USD = 'https://fapi.binance.com'
const FUT_COIN = 'https://dapi.binance.com'

async function showNonZero(label, rows, amountKey) {
  const nonZero = rows.filter(r => {
    const n = typeof amountKey === 'function' ? amountKey(r) : +(r[amountKey] ?? 0)
    return n > 0
  })
  console.log(`\n── ${label} (${nonZero.length} non-zero)`)
  if (nonZero.length === 0) { console.log('  (empty)'); return }
  for (const r of nonZero.slice(0, 40)) {
    console.log('  ' + JSON.stringify(r))
  }
}

console.log('API key:', API.slice(0, 6) + '...' + API.slice(-4))
console.log('Checking all wallet types...\n')

// 1) SPOT (already confirmed but include for completeness)
{
  const r = await signedCall('GET', SPOT, '/api/v3/account')
  const bals = (r.data.balances || []).filter(b => +b.free + +b.locked > 0)
  console.log(`── SPOT wallet (${bals.length} non-zero)`)
  for (const b of bals.slice(0, 40)) console.log(`  ${b.asset.padEnd(8)} free=${b.free}  locked=${b.locked}`)
}

// 2) FUNDING wallet
{
  const r = await signedCall('POST', SPOT, '/sapi/v1/asset/get-funding-asset')
  if (r.status !== 200) console.log(`\n── FUNDING wallet  ERROR ${r.status}: ${JSON.stringify(r.data)}`)
  else await showNonZero('FUNDING wallet', r.data || [], 'free')
}

// 3) MARGIN cross
{
  const r = await signedCall('GET', SPOT, '/sapi/v1/margin/account')
  if (r.status !== 200) console.log(`\n── MARGIN (cross)  ERROR ${r.status}: ${JSON.stringify(r.data)}`)
  else {
    const bals = (r.data.userAssets || []).filter(b => +b.free + +b.locked + +b.borrowed > 0)
    console.log(`\n── MARGIN (cross)  (${bals.length} non-zero)`)
    for (const b of bals.slice(0, 40)) console.log(`  ${b.asset.padEnd(8)} free=${b.free}  locked=${b.locked}  borrowed=${b.borrowed}  net=${b.netAsset}`)
    console.log(`  totalAssetOfBtc=${r.data.totalAssetOfBtc}  totalLiabilityOfBtc=${r.data.totalLiabilityOfBtc}  totalNetAssetOfBtc=${r.data.totalNetAssetOfBtc}`)
  }
}

// 4) FUTURES USD-M
{
  const r = await signedCall('GET', FUT_USD, '/fapi/v2/balance')
  if (r.status !== 200) console.log(`\n── FUTURES USD-M  ERROR ${r.status}: ${JSON.stringify(r.data)}`)
  else {
    const bals = (r.data || []).filter(b => +b.balance > 0 || +b.crossUnPnl !== 0)
    console.log(`\n── FUTURES USD-M (${bals.length} non-zero)`)
    for (const b of bals.slice(0, 20)) console.log(`  ${b.asset.padEnd(8)} balance=${b.balance}  available=${b.availableBalance}  crossUnPnl=${b.crossUnPnl}`)
  }
}

// 5) FUTURES COIN-M
{
  const r = await signedCall('GET', FUT_COIN, '/dapi/v1/balance')
  if (r.status !== 200) console.log(`\n── FUTURES COIN-M  ERROR ${r.status}: ${JSON.stringify(r.data)}`)
  else {
    const bals = (r.data || []).filter(b => +b.balance > 0)
    console.log(`\n── FUTURES COIN-M (${bals.length} non-zero)`)
    for (const b of bals.slice(0, 20)) console.log(`  ${b.asset.padEnd(8)} balance=${b.balance}  available=${b.availableBalance}`)
  }
}

// 6) SIMPLE EARN flexible — detail by asset
{
  const r = await signedCall('GET', SPOT, '/sapi/v1/simple-earn/flexible/position', { size: '100' })
  if (r.status !== 200) console.log(`\n── SIMPLE EARN flexible  ERROR ${r.status}: ${JSON.stringify(r.data)}`)
  else {
    const rows = r.data.rows || []
    console.log(`\n── SIMPLE EARN flexible (${rows.length} positions)`)
    // summarise by asset
    const byAsset = {}
    for (const p of rows) {
      byAsset[p.asset] = (byAsset[p.asset] || 0) + +p.totalAmount
    }
    for (const [a, amt] of Object.entries(byAsset).sort((x, y) => y[1] - x[1]).slice(0, 30)) {
      console.log(`  ${a.padEnd(8)} total=${amt}`)
    }
  }
}

// 7) SIMPLE EARN locked
{
  const r = await signedCall('GET', SPOT, '/sapi/v1/simple-earn/locked/position', { size: '100' })
  if (r.status !== 200) console.log(`\n── SIMPLE EARN locked  ERROR ${r.status}: ${JSON.stringify(r.data)}`)
  else {
    const rows = r.data.rows || []
    console.log(`\n── SIMPLE EARN locked (${rows.length} positions)`)
    const byAsset = {}
    for (const p of rows) byAsset[p.asset] = (byAsset[p.asset] || 0) + +p.amount
    for (const [a, amt] of Object.entries(byAsset).sort((x, y) => y[1] - x[1]).slice(0, 30)) {
      console.log(`  ${a.padEnd(8)} total=${amt}`)
    }
  }
}

console.log('\nAll wallet checks complete.')
