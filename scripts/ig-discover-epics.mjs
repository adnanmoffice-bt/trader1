#!/usr/bin/env node
// Discover IG epics for forex / indices / silver and print verified mid prices.
// Read-only. Does NOT place orders.
//
// Usage: node scripts/ig-discover-epics.mjs

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

if (!API_KEY || !USERNAME || !PASSWORD || !ACCOUNT_ID) {
  console.error('Missing IG_* env vars')
  process.exit(1)
}

console.log(`=== IG EPIC DISCOVERY (forex / indices / silver) ===`)
console.log(`Base URL: ${BASE_URL}`)
console.log(`Account:  ${ACCOUNT_ID}`)
console.log()

// 1. Auth
const auth = await fetch(`${BASE_URL}/session`, {
  method: 'POST',
  headers: {
    'X-IG-API-KEY': API_KEY,
    Version: '2',
    'Content-Type': 'application/json',
    Accept: 'application/json; charset=UTF-8',
  },
  body: JSON.stringify({ identifier: USERNAME, password: PASSWORD }),
})
if (!auth.ok) {
  console.error(`AUTH FAILED HTTP ${auth.status}: ${await auth.text()}`)
  process.exit(1)
}
const cst = auth.headers.get('CST')
const xst = auth.headers.get('X-SECURITY-TOKEN')
const headers = { 'X-IG-API-KEY': API_KEY, CST: cst, 'X-SECURITY-TOKEN': xst, Accept: 'application/json; charset=UTF-8' }
console.log(`Auth OK\n`)

// Set requested account
await fetch(`${BASE_URL}/session`, { method: 'PUT', headers: { ...headers, Version: '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: ACCOUNT_ID }) }).catch(() => {})

// Helper: search a term, return top markets
async function search(term) {
  const r = await fetch(`${BASE_URL}/markets?searchTerm=${encodeURIComponent(term)}`, { headers: { ...headers, Version: '1' } })
  if (!r.ok) return []
  const j = await r.json()
  return j.markets || []
}

// Helper: confirm an epic is live by snapshot
async function snapshot(epic) {
  const r = await fetch(`${BASE_URL}/markets/${encodeURIComponent(epic)}`, { headers: { ...headers, Version: '3' } })
  if (!r.ok) return null
  const j = await r.json()
  return j.snapshot
}

// Search probes: pick the most likely candidates per asset class.
// We prefer ".BMU.IP" minisize variants (matches verified gold/oil pattern on
// this account; smaller min contract size).
const TARGETS = [
  // Silver
  { instrument: 'XAG/USD', terms: ['Spot Silver', 'Silver $5', 'Silver Mini'] },
  // Major forex
  { instrument: 'EUR/USD', terms: ['EUR/USD Mini', 'EUR/USD'] },
  { instrument: 'GBP/USD', terms: ['GBP/USD Mini', 'GBP/USD'] },
  { instrument: 'USD/JPY', terms: ['USD/JPY Mini', 'USD/JPY'] },
  // US indices (cash CFDs)
  { instrument: 'SPY',     terms: ['US 500 Mini', 'US 500', 'S&P 500'] },
  { instrument: 'QQQ',     terms: ['US Tech 100 Mini', 'US Tech 100', 'Nasdaq'] },
]

const results = {}

for (const t of TARGETS) {
  console.log(`\n── ${t.instrument} ──`)
  const seen = new Set()
  let chosen = null
  for (const term of t.terms) {
    const ms = await search(term)
    for (const m of ms.slice(0, 6)) {
      if (seen.has(m.epic)) continue
      seen.add(m.epic)
      console.log(`  epic=${m.epic.padEnd(35)} name=${(m.instrumentName || '').padEnd(40)} status=${m.marketStatus} expiry=${m.expiry || '-'} bid=${m.bid} offer=${m.offer}`)
      // Pick first epic that is TRADEABLE/EDITS_ONLY (not closed) and ends with .BMU.IP or .IP.
      if (!chosen && (m.marketStatus === 'TRADEABLE' || m.marketStatus === 'EDITS_ONLY' || m.marketStatus === 'ON_AUCTION') && m.epic.endsWith('.IP')) {
        chosen = m
      }
    }
    if (chosen) break
  }
  if (chosen) {
    const snap = await snapshot(chosen.epic)
    const mid = snap ? ((snap.bid + snap.offer) / 2) : null
    console.log(`  ▶ PICK: ${chosen.epic}  mid=${mid?.toFixed(4)}  status=${snap?.marketStatus}`)
    results[t.instrument] = { epic: chosen.epic, name: chosen.instrumentName, mid, status: snap?.marketStatus }
  } else {
    console.log(`  ✗ no tradeable match found`)
    results[t.instrument] = null
  }
}

console.log(`\n\n══ SUMMARY (paste into lib/exchanges/ig.ts SYMBOL_MAP) ══`)
for (const [k, v] of Object.entries(results)) {
  if (v) console.log(`  '${k}': ${JSON.stringify(v.epic)}, // ${v.name} mid=${v.mid?.toFixed(4)} ${v.status}`)
  else  console.log(`  // '${k}': NOT FOUND — re-run with broader terms`)
}

// Logout
await fetch(`${BASE_URL}/session`, { method: 'DELETE', headers: { ...headers, Version: '1' } }).catch(() => {})
console.log('\n=== DONE — no orders placed ===')
