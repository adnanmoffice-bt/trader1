#!/usr/bin/env node
// Quick audit: per-symbol per-interval count + earliest/latest timestamp.
// Tells us how much data we have to validate Phase D triggers against.

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
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !KEY) { console.error('Missing Supabase env'); process.exit(1) }
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }

const SYMS = ['BTC/USD', 'ETH/USD', 'XAU/USD', 'DOGE/USD', 'AVAX/USD', 'LINK/USD', 'ADA/USD', 'DOT/USD', 'MATIC/USD', 'NEAR/USD', 'APT/USD', 'SOL/USD', 'BNB/USD']

async function fetchOne(sym, interval, asc, limit = 1) {
  const url = `${URL_}/rest/v1/price_history?symbol=eq.${encodeURIComponent(sym)}&interval=eq.${interval}&order=timestamp.${asc ? 'asc' : 'desc'}&limit=${limit}&select=timestamp`
  const r = await fetch(url, { headers })
  return r.json()
}
async function countOne(sym, interval) {
  const url = `${URL_}/rest/v1/price_history?symbol=eq.${encodeURIComponent(sym)}&interval=eq.${interval}&select=id`
  const r = await fetch(url, { headers: { ...headers, Prefer: 'count=exact', Range: '0-0' } })
  return Number(r.headers.get('content-range')?.split('/')?.[1] ?? 0)
}

async function main() {
  console.log('\nprice_history audit — per (symbol, interval)\n')
  console.log('Symbol         Interval   N candles   Earliest                  Latest                    Span (days)')
  console.log('--------------------------------------------------------------------------------------------------------')
  for (const sym of SYMS) {
    for (const intv of ['1h', '4h', '1d']) {
      const [first] = await fetchOne(sym, intv, true)
      const [last] = await fetchOne(sym, intv, false)
      const n = await countOne(sym, intv)
      if (!first || !last) {
        console.log(`${sym.padEnd(15)}${intv.padEnd(11)}${String(n).padStart(8)}   —                         —                          —`)
        continue
      }
      const span = (new Date(last.timestamp) - new Date(first.timestamp)) / 86400_000
      console.log(`${sym.padEnd(15)}${intv.padEnd(11)}${String(n).padStart(8)}   ${first.timestamp}   ${last.timestamp}   ${span.toFixed(1)}`)
    }
  }
  console.log('\n[end]')
}
main().catch(e => { console.error(e); process.exit(1) })
