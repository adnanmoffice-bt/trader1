#!/usr/bin/env node
// One-shot read-only audit: did XAG/USD demo trades fill at prices that
// match Yahoo SI=F? If yes, we can lift XAG/USD from LIVE_INSTRUMENT_BLACKLIST.
// If IG silver was 100x scaled (the suspicion in 2026-05-06 HANDOFF entry),
// the simulated fills should still be ~$30/oz because demo cron uses
// price-fetcher (Yahoo fallback for forex/metals/oil), not IG raw quotes.
//
// We just want to confirm: every closed XAG demo trade entered/exited in
// the $25-$40 range (real silver), not $2500-$4000 (the 100x-scaled IG bug).

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

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }

// Pull all closed XAG demo trades.
const r = await fetch(
  `${URL}/rest/v1/demo_trades?instrument=eq.XAG/USD&exit_time=not.is.null&select=*&order=entry_time.asc`,
  { headers }
)
const trades = await r.json()

console.log('')
console.log(`XAG/USD demo trades — closed round-trips`)
console.log('━'.repeat(80))

if (!trades.length) {
  console.log('  (none yet — demo cron will fill this in over the next ~24-48h)')
  console.log('')
  console.log('VERDICT: NOT READY for live unblock — 0 closed demo trades.')
  process.exit(0)
}

// Read current Yahoo silver from market_data (live, refreshed every 2 min by
// market-data-cron). Compare demo fills against this with +/- 30% tolerance
// so the script auto-tracks price drift over weeks.
const liveR = await fetch(`${URL}/rest/v1/market_data?symbol=eq.XAG/USD&select=price`, { headers })
const liveRows = await liveR.json()
const livePrice = Number(liveRows?.[0]?.price ?? 0) || 30
const YAHOO_LO = livePrice * 0.7
const YAHOO_HI = livePrice * 1.3
console.log(`Reference: Yahoo XAG/USD = $${livePrice.toFixed(2)} (tolerance ±30% → $${YAHOO_LO.toFixed(2)} - $${YAHOO_HI.toFixed(2)})`)
console.log('')
let inRange = 0, outOfRange = 0
let wins = 0, losses = 0, totalPnl = 0

for (const t of trades) {
  const entry = Number(t.entry_price)
  const exit = Number(t.exit_price)
  const pnl = Number(t.pnl ?? 0)
  const pct = Number(t.pnl_pct ?? 0)
  const ok = entry >= YAHOO_LO && entry <= YAHOO_HI && exit >= YAHOO_LO && exit <= YAHOO_HI
  if (ok) inRange++; else outOfRange++
  if (pnl > 0) wins++; else losses++
  totalPnl += pnl
  const date = new Date(t.entry_time).toISOString().slice(0, 16).replace('T', ' ')
  const dur = t.exit_time
    ? Math.round((new Date(t.exit_time).getTime() - new Date(t.entry_time).getTime()) / 60000)
    : 0
  console.log(
    `  ${date}  ${t.direction.padEnd(5)}  entry=$${entry.toFixed(2).padStart(7)}  exit=$${exit.toFixed(2).padStart(7)}  ` +
    `pnl=${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2).padStart(7)} (${pct.toFixed(2)}%)  ` +
    `${dur}m  ${t.exit_reason}  ${ok ? '[ok]' : '[OUT-OF-RANGE]'}`
  )
}

const wr = trades.length ? ((wins / trades.length) * 100).toFixed(1) : '0.0'

console.log('━'.repeat(80))
console.log('')
console.log(`Closed trades : ${trades.length}`)
console.log(`Win / Loss    : ${wins}W / ${losses}L  (WR ${wr}%)`)
console.log(`Total PnL     : ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`)
console.log(`Price-range   : ${inRange} in-range ($${YAHOO_LO}-$${YAHOO_HI}), ${outOfRange} out-of-range`)
console.log('')

const enoughTrades = trades.length >= 5
const allInRange = outOfRange === 0
const wrOk = (wins / trades.length) >= 0.20  // very loose — we only care that it's not 0%

console.log(`READINESS GATES`)
console.log(`  [${enoughTrades ? 'x' : ' '}] >= 5 closed demo trades        (${trades.length}/5)`)
console.log(`  [${allInRange    ? 'x' : ' '}] All entries/exits in $25-$40   (${inRange}/${trades.length})`)
console.log(`  [${wrOk          ? 'x' : ' '}] WR >= 20% (sanity check)       (${wr}%)`)
console.log('')

if (enoughTrades && allInRange && wrOk) {
  console.log(`VERDICT: READY to remove 'XAG/USD' from LIVE_INSTRUMENT_BLACKLIST.`)
  console.log(`         Edit lib/safety.ts → LIVE_INSTRUMENT_BLACKLIST and drop the XAG entry.`)
  console.log(`         The 30d edge gate is bypassed by reduced-risk override (0.30%/trade),`)
  console.log(`         so live XAG can fire on the next signal that passes all war-room gates.`)
} else {
  console.log(`VERDICT: NOT READY. Wait for more demo trades and re-run this script.`)
}
console.log('')
