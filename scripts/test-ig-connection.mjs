#!/usr/bin/env node
// Read-only smoke test for IG Group credentials.
// Authenticates, fetches account balance, and tries to find Spot Gold / WTI epics.
// Does NOT place any orders. Run after putting IG_API_KEY, IG_USERNAME,
// IG_PASSWORD, IG_ACCOUNT_ID into .env.local (or Vercel env for prod).
//
// Usage:
//   node scripts/test-ig-connection.mjs            # uses live by default
//   IG_BASE_URL=https://demo-api.ig.com/gateway/deal node scripts/test-ig-connection.mjs

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

const API_KEY = process.env.IG_API_KEY
const USERNAME = process.env.IG_USERNAME
const PASSWORD = process.env.IG_PASSWORD
const ACCOUNT_ID = process.env.IG_ACCOUNT_ID
const BASE_URL = process.env.IG_BASE_URL || 'https://api.ig.com/gateway/deal'

const missing = []
if (!API_KEY) missing.push('IG_API_KEY')
if (!USERNAME) missing.push('IG_USERNAME')
if (!PASSWORD) missing.push('IG_PASSWORD')
if (!ACCOUNT_ID) missing.push('IG_ACCOUNT_ID')
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(', ')}`)
  console.error(`Add them to .env.local (locally) or Vercel env (prod).`)
  process.exit(1)
}

console.log(`=== IG SMOKE TEST ===`)
console.log(`Base URL: ${BASE_URL}`)
console.log(`Account:  ${ACCOUNT_ID}`)
console.log()

// 1. Authenticate
console.log('[1/4] POST /session ...')
const authRes = await fetch(`${BASE_URL}/session`, {
  method: 'POST',
  headers: {
    'X-IG-API-KEY': API_KEY,
    Version: '2',
    'Content-Type': 'application/json',
    Accept: 'application/json; charset=UTF-8',
  },
  body: JSON.stringify({ identifier: USERNAME, password: PASSWORD }),
})
if (!authRes.ok) {
  const txt = await authRes.text()
  console.error(`  FAILED HTTP ${authRes.status}: ${txt}`)
  process.exit(1)
}
const cst = authRes.headers.get('CST')
const xst = authRes.headers.get('X-SECURITY-TOKEN')
const authBody = await authRes.json()
console.log(`  OK. Currency: ${authBody.currencyIsoCode || authBody.currentAccountId} | TZ offset: ${authBody.timezoneOffset ?? '?'}`)

const headers = {
  'X-IG-API-KEY': API_KEY,
  CST: cst,
  'X-SECURITY-TOKEN': xst,
  Accept: 'application/json; charset=UTF-8',
}

// 2. List accounts
console.log('\n[2/4] GET /accounts ...')
const accRes = await fetch(`${BASE_URL}/accounts`, { headers: { ...headers, Version: '1' } })
if (!accRes.ok) {
  console.error(`  FAILED HTTP ${accRes.status}: ${await accRes.text()}`)
  process.exit(1)
}
const accounts = (await accRes.json()).accounts || []
console.log(`  Found ${accounts.length} account(s):`)
for (const a of accounts) {
  const tag = a.accountId === ACCOUNT_ID ? ' ←★' : ''
  console.log(
    `    ${a.accountId}  ${a.accountName}  ${a.currency}  bal:${a.balance?.balance?.toFixed(2)}  avail:${a.balance?.available?.toFixed(2)}  P&L:${a.balance?.profitLoss?.toFixed(2)}${tag}`,
  )
}

// 3. Search for Spot Gold and WTI epics
console.log('\n[3/4] GET /markets?searchTerm=GOLD and OIL ...')
for (const term of ['Spot Gold', 'US Crude', 'Brent']) {
  const r = await fetch(`${BASE_URL}/markets?searchTerm=${encodeURIComponent(term)}`, { headers: { ...headers, Version: '1' } })
  if (!r.ok) { console.log(`  ${term}: HTTP ${r.status}`); continue }
  const j = await r.json()
  const top = (j.markets || []).slice(0, 3)
  console.log(`  ${term}: top ${top.length} market(s):`)
  for (const m of top) {
    console.log(`    epic=${m.epic}  name=${m.instrumentName}  status=${m.marketStatus}  bid=${m.bid}  offer=${m.offer}`)
  }
}

// 4. Pull a snapshot of the configured XAU epic to confirm pricing works
const XAU_EPIC = 'CS.D.CFDGOLD.CFDGC.IP'
console.log(`\n[4/4] GET /markets/${XAU_EPIC} (Spot Gold default mapping) ...`)
const mRes = await fetch(`${BASE_URL}/markets/${encodeURIComponent(XAU_EPIC)}`, { headers: { ...headers, Version: '3' } })
if (!mRes.ok) {
  console.log(`  HTTP ${mRes.status}: ${(await mRes.text()).slice(0, 200)}`)
  console.log(`  → If 404, your account region uses a different epic. Check the search results above and update SYMBOL_MAP in lib/exchanges/ig.ts.`)
} else {
  const m = await mRes.json()
  console.log(`  bid=${m.snapshot?.bid}  offer=${m.snapshot?.offer}  high=${m.snapshot?.high}  low=${m.snapshot?.low}  status=${m.snapshot?.marketStatus}`)
}

// Logout cleanly to free the session slot.
await fetch(`${BASE_URL}/session`, { method: 'DELETE', headers: { ...headers, Version: '1' } }).catch(() => {})
console.log('\n=== DONE — no orders placed, no funds moved ===')
