#!/usr/bin/env node
// One-shot operator script: dial user_settings.risk_per_trade_pct down to 0.3%
// (Option 2a — reduced-risk override). After running this, lib/safety.ts
// checkLiveTradingAllowed() will bypass the 30d expectancy gate as long as
// risk stays ≤ 0.5% (REDUCED_RISK_CEILING_PCT).
//
// IMPORTANT: the column is stored as PERCENT (DECIMAL(5,2)). 0.30 means 0.3%,
// 2 means 2%. Don't pass fractions (0.003 truncates to 0).
//
// Usage: node scripts/set-reduced-risk.mjs           # sets to 0.30 (0.3%)
//        TARGET=0.50 node scripts/set-reduced-risk.mjs  # 0.5% — at ceiling, still bypasses
//        TARGET=2    node scripts/set-reduced-risk.mjs  # 2% — RE-ENGAGES edge gate

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

// PERCENT units. Default 0.30 = 0.3%. Hard cap 5 = 5% to prevent fat-fingers.
const target = Number(process.env.TARGET || '0.30')
if (!Number.isFinite(target) || target < 0 || target > 5) {
  console.error(`Refusing target ${target} — must be 0 .. 5 (percent). Aborting.`)
  process.exit(1)
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

console.log(`Loading current user_settings ...`)
const r0 = await fetch(`${URL}/rest/v1/user_settings?select=*&limit=1`, { headers })
const rows0 = await r0.json()
if (!Array.isArray(rows0) || !rows0.length) {
  console.error('No user_settings row found. Aborting.')
  process.exit(1)
}
const row = rows0[0]
const id = row.id
const prev = Number(row.risk_per_trade_pct)
console.log(`Current risk_per_trade_pct = ${prev}% (column units = percent)`)
console.log(`Target  risk_per_trade_pct = ${target}%`)

const r1 = await fetch(`${URL}/rest/v1/user_settings?id=eq.${id}`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ risk_per_trade_pct: target }),
})
if (!r1.ok) {
  console.error(`UPDATE failed HTTP ${r1.status}: ${await r1.text()}`)
  process.exit(1)
}
const rows1 = await r1.json()
console.log(`UPDATED. New row:`)
console.log(`  id=${rows1[0].id}  risk_per_trade_pct=${rows1[0].risk_per_trade_pct}`)

console.log(`\nDone.`)
console.log(`  • lib/safety.ts REDUCED_RISK_CEILING_PCT = 0.5%`)
console.log(`  • Bypass active: ${target > 0 && target <= 0.5 ? 'YES — edge gate skipped' : 'NO — normal 30d gate'}`)
console.log(`  • LIVE_INSTRUMENT_BLACKLIST still applies (ADA, DOT, APT, XAG)`)
