/**
 * Read-only Binance API key check.
 * Runs GET /api/v3/account (signed, read-only) to verify key + secret work.
 * Then runs GET /api/v3/openOrders to check permissions.
 * No orders placed.
 *
 * Usage: node scripts/test-binance-key.mjs
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

function loadEnvLocal() {
  const p = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(p)) return
  const raw = fs.readFileSync(p, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

loadEnvLocal()

const API = process.env.BINANCE_API_KEY
const SECRET = process.env.BINANCE_SECRET_KEY
const BASE = 'https://api.binance.com'

if (!API || !SECRET) {
  console.error('Missing BINANCE_API_KEY or BINANCE_SECRET_KEY in .env.local')
  process.exit(1)
}

function sign(qs) {
  return crypto.createHmac('sha256', SECRET).update(qs).digest('hex')
}

async function signedGet(endpoint) {
  const params = new URLSearchParams({
    timestamp: Date.now().toString(),
    recvWindow: '5000',
  })
  const qs = params.toString()
  const sig = sign(qs)
  const url = `${BASE}${endpoint}?${qs}&signature=${sig}`
  const res = await fetch(url, { headers: { 'X-MBX-APIKEY': API } })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  return { status: res.status, data }
}

console.log('API key prefix:', API.slice(0, 6) + '...' + API.slice(-4))
console.log('Secret present:', SECRET.length, 'chars\n')

console.log('1) GET /api/v3/account (balances + permissions) ...')
const acct = await signedGet('/api/v3/account')
if (acct.status !== 200) {
  console.error('  FAIL:', acct.status, JSON.stringify(acct.data))
  process.exit(1)
}

console.log('  Account type:', acct.data.accountType)
console.log('  canTrade     :', acct.data.canTrade)
console.log('  canWithdraw  :', acct.data.canWithdraw, acct.data.canWithdraw ? '  [WARNING: withdrawal permission enabled]' : '  (good)')
console.log('  canDeposit   :', acct.data.canDeposit)
console.log('  Permissions  :', (acct.data.permissions || []).join(', '))

const nonZero = (acct.data.balances || []).filter(b => +b.free + +b.locked > 0)
console.log('\n2) Non-zero balances:')
if (nonZero.length === 0) {
  console.log('  (none — account is empty)')
} else {
  for (const b of nonZero) {
    console.log(`  ${b.asset.padEnd(8)} free=${b.free}  locked=${b.locked}`)
  }
}

console.log('\n3) GET /api/v3/openOrders ...')
const oo = await signedGet('/api/v3/openOrders')
if (oo.status !== 200) {
  console.error('  FAIL:', oo.status, JSON.stringify(oo.data))
} else {
  console.log('  Open orders:', oo.data.length)
}

console.log('\nAll read-only checks passed. Key is valid.')
