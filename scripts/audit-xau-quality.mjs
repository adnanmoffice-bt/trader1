#!/usr/bin/env node
// Quick quality audit for XAU/USD candles vs a crypto reference (BTC).
// PAXGUSDT is thin — we want to quantify how thin BEFORE running gate studies.

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
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function fetchAll(symbol) {
  const all = []
  let offset = 0
  while (true) {
    const url = `${URL_}/rest/v1/price_history?symbol=eq.${encodeURIComponent(symbol)}&interval=eq.1h&order=timestamp.asc&limit=1000&offset=${offset}&select=timestamp,open,high,low,close,volume`
    const r = await fetch(url, { headers })
    const rows = await r.json()
    if (!Array.isArray(rows) || rows.length === 0) break
    all.push(...rows)
    if (rows.length < 1000) break
    offset += 1000
  }
  return all
}

function stats(name, rows) {
  const closes = rows.map(r => +r.close)
  const ranges = rows.map(r => (+r.high - +r.low) / +r.close)
  const vols = rows.map(r => +r.volume)
  // Gaps in timestamps (looking for missing 1h slots)
  let gaps = 0
  for (let i = 1; i < rows.length; i++) {
    const dt = new Date(rows[i].timestamp) - new Date(rows[i - 1].timestamp)
    if (dt > 3600_000 + 60_000) gaps++
  }
  // Doji bars (open ≈ close ≈ very small range) — sign of no trading
  let doji = 0
  for (const r of rows) {
    const range = (+r.high - +r.low) / +r.close
    const body = Math.abs(+r.close - +r.open) / +r.close
    if (range < 0.001 && body < 0.0005) doji++
  }
  // Zero-volume bars
  const zeroVol = rows.filter(r => +r.volume === 0).length
  // Average ATR%price as the rough vol baseline
  const atrPct = ranges.reduce((s, x) => s + x, 0) / ranges.length * 100
  // Median bar volume (in quote terms ≈ vol × close)
  const quoteVols = rows.map((r, i) => vols[i] * closes[i]).sort((a, b) => a - b)
  const medQuoteVol = quoteVols[Math.floor(quoteVols.length / 2)]

  console.log(`\n${name}`)
  console.log(`  candles                ${rows.length}`)
  console.log(`  span                   ${rows[0].timestamp.slice(0, 10)} .. ${rows.at(-1).timestamp.slice(0, 10)}`)
  console.log(`  avg ATR%price          ${atrPct.toFixed(3)}%`)
  console.log(`  median bar quote vol   $${medQuoteVol.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
  console.log(`  bars with zero volume  ${zeroVol} (${(zeroVol / rows.length * 100).toFixed(1)}%)`)
  console.log(`  doji-like bars         ${doji} (${(doji / rows.length * 100).toFixed(1)}%)`)
  console.log(`  timestamp gaps (>1h)   ${gaps}`)
}

async function main() {
  const xau = await fetchAll('XAU/USD')
  const btc = await fetchAll('BTC/USD')
  console.log('\nQuality audit: XAU/USD (PAXGUSDT) vs BTC/USD (BTCUSDT) — 1H candles\n')
  stats('XAU/USD (PAXGUSDT)', xau)
  stats('BTC/USD (BTCUSDT)', btc)

  console.log('\n[end]')
}

main().catch(e => { console.error(e); process.exit(1) })
