#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// PHASE D — Backfill price_history to N months from Binance public klines API
//
// Why this exists:
//   audit-price-history.mjs revealed the DB only has ~47d of 1H candles.
//   The earlier Phase D walk-forward "OOS at +0.131" was on 19d of test data
//   — too thin to be statistically meaningful. This script fills in the
//   missing history so 5-fold walk-forward becomes possible.
//
// Usage:
//   node scripts/backfill-price-history.mjs            # default 365 days
//   node scripts/backfill-price-history.mjs 540        # ~18 months
//   node scripts/backfill-price-history.mjs 365 BTC/USD,ETH/USD   # subset
//
// Safety:
//   - Read-only against Binance (public klines, no auth).
//   - Writes via Supabase upsert with ON CONFLICT on (symbol,interval,timestamp)
//     so re-running is idempotent and never clobbers existing rows.
//   - Sleeps 200ms between batches to stay under Binance 1200 wt/min limit.
//   - Skips XAU/USD by default (PAXGUSDT exists but its illiquidity makes the
//     candles useless for backtesting; pass it explicitly if you want it).
// ─────────────────────────────────────────────────────────────────────────────

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
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }

const BINANCE = 'https://api.binance.com/api/v3'
const SYMBOLS = {
  'BTC/USD': 'BTCUSDT',
  'ETH/USD': 'ETHUSDT',
  'SOL/USD': 'SOLUSDT',
  'BNB/USD': 'BNBUSDT',
  'DOGE/USD': 'DOGEUSDT',
  'AVAX/USD': 'AVAXUSDT',
  'LINK/USD': 'LINKUSDT',
  'ADA/USD': 'ADAUSDT',
  'DOT/USD': 'DOTUSDT',
  'MATIC/USD': 'POLUSDT',
  'NEAR/USD': 'NEARUSDT',
  'APT/USD': 'APTUSDT',
  // XAU added 2026-05-04: previously skipped because PAXGUSDT is thin
  // ($15M daily vol, ~0.1% spread). Including it now to reconcile with
  // war-room rotation (XAU/USD has been in ALL_INSTRUMENTS the whole time).
  // Backtests must be read with the spread caveat in mind — assume real
  // fills will be 0.05-0.15% worse than the candle close.
  'XAU/USD': 'PAXGUSDT',
}

// 2026-05-06: oil candles via Yahoo Finance (Binance has no oil pair).
// Used when war-room rotation includes 'WTI'/'BRENT'. Yahoo gives free 1H
// candles back ~2 years per request. Same upsert path as Binance candles.
const YAHOO_SYMBOLS = {
  'WTI':   'CL=F', // NYMEX WTI Crude Oil front month
  'BRENT': 'BZ=F', // ICE Brent Crude front month
}

const DAYS = parseInt(process.argv[2] ?? '365', 10)
// Filter list (e.g. "BTC/USD,ETH/USD") and interval can come in either order.
// If the 3rd arg looks like an interval token ("1h"/"4h"/"1d"/"15m") we treat
// it as the interval; otherwise it's a filter list. Same for arg 4.
function classify(arg) {
  if (!arg) return { kind: 'none' }
  if (/^(1m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w)$/i.test(arg.trim())) return { kind: 'interval', value: arg.trim().toLowerCase() }
  if (arg.includes('/') || arg.includes(',')) return { kind: 'filter', value: new Set(arg.split(',').map(s => s.trim()).filter(Boolean)) }
  return { kind: 'none' }
}
const a3 = classify(process.argv[3])
const a4 = classify(process.argv[4])
const FILTER = a3.kind === 'filter' ? a3.value : a4.kind === 'filter' ? a4.value : null
const INTERVAL = a3.kind === 'interval' ? a3.value : a4.kind === 'interval' ? a4.value : '1h'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Yahoo Finance 1H candle fetcher. Used for WTI/BRENT (and any future
// commodity/forex/index that lands in YAHOO_SYMBOLS). Yahoo's range param
// is fuzzy: '2y' returns ~2 years of 1H data in one request. Beyond 2y
// historic 1H is sparse, so we cap there.
async function fetchYahooKlinesRange(yahooSym, startMs, endMs) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=${INTERVAL}&range=2y`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) {
    console.error(`  Yahoo ${res.status} on ${yahooSym}: ${(await res.text()).slice(0, 120)}`)
    return []
  }
  const json = await res.json()
  const r = json?.chart?.result?.[0]
  if (!r) return []
  const t = r.timestamp ?? []
  const q = r.indicators?.quote?.[0] ?? {}
  const out = []
  for (let i = 0; i < t.length; i++) {
    if (q.open?.[i] == null || q.close?.[i] == null) continue
    const ts = t[i] * 1000
    if (ts < startMs || ts > endMs) continue
    out.push({
      timestamp: new Date(ts).toISOString(),
      open: q.open[i],
      high: q.high?.[i] ?? q.open[i],
      low:  q.low?.[i]  ?? q.open[i],
      close: q.close[i],
      volume: q.volume?.[i] ?? 0,
    })
  }
  return out
}

async function fetchKlinesRange(binanceSym, startMs, endMs) {
  const out = []
  let current = startMs
  let page = 0
  while (current < endMs) {
    const url = `${BINANCE}/klines?symbol=${binanceSym}&interval=${INTERVAL}&startTime=${current}&endTime=${endMs}&limit=1000`
    const res = await fetch(url)
    if (!res.ok) {
      console.error(`  Binance ${res.status} on ${binanceSym} page ${page}: ${(await res.text()).slice(0, 120)}`)
      break
    }
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) break
    out.push(...data.map(k => ({
      timestamp: new Date(k[0]).toISOString(),
      open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]),
      close: parseFloat(k[4]), volume: parseFloat(k[5]),
    })))
    current = data[data.length - 1][6] + 1
    page++
    await sleep(200)
  }
  return out
}

async function upsertBatch(rows) {
  // Insert in chunks of 500 to stay under any payload limit
  const chunkSize = 500
  let inserted = 0
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const r = await fetch(`${URL_}/rest/v1/price_history?on_conflict=symbol,interval,timestamp`, {
      method: 'POST', headers, body: JSON.stringify(chunk),
    })
    if (!r.ok) {
      console.error(`  upsert ${r.status}: ${(await r.text()).slice(0, 200)}`)
      break
    }
    inserted += chunk.length
  }
  return inserted
}

async function main() {
  const endMs = Date.now()
  const startMs = endMs - DAYS * 86400_000
  console.log(`\nBackfill ${DAYS}d of ${INTERVAL} klines from ${new Date(startMs).toISOString()} to ${new Date(endMs).toISOString()}`)
  if (FILTER) console.log(`Filter: ${[...FILTER].join(', ')}`)
  console.log()

  const binanceTargets = Object.entries(SYMBOLS).filter(([k]) => !FILTER || FILTER.has(k))
  const yahooTargets   = Object.entries(YAHOO_SYMBOLS).filter(([k]) => !FILTER || FILTER.has(k))
  const totalSyms      = binanceTargets.length + yahooTargets.length
  let grandTotal = 0

  for (const [sym, binSym] of binanceTargets) {
    const t0 = Date.now()
    process.stdout.write(`${sym.padEnd(12)}-> ${binSym.padEnd(10)}  binance  fetching... `)
    const klines = await fetchKlinesRange(binSym, startMs, endMs)
    process.stdout.write(`${klines.length} candles  upserting... `)
    const rows = klines.map(k => ({ symbol: sym, interval: INTERVAL, ...k }))
    const inserted = await upsertBatch(rows)
    const dt = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`${inserted} ok  (${dt}s)`)
    grandTotal += inserted
  }

  for (const [sym, yahooSym] of yahooTargets) {
    const t0 = Date.now()
    process.stdout.write(`${sym.padEnd(12)}-> ${yahooSym.padEnd(10)}  yahoo    fetching... `)
    const klines = await fetchYahooKlinesRange(yahooSym, startMs, endMs)
    process.stdout.write(`${klines.length} candles  upserting... `)
    const rows = klines.map(k => ({ symbol: sym, interval: INTERVAL, ...k }))
    const inserted = await upsertBatch(rows)
    const dt = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`${inserted} ok  (${dt}s)`)
    grandTotal += inserted
  }

  console.log(`\nDone. Total ${grandTotal} candles upserted across ${totalSyms} symbols.`)
}

main().catch(e => { console.error(e); process.exit(1) })
