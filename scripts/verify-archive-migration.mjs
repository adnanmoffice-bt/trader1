#!/usr/bin/env node
// Verify the 2026-05-08 archive-legacy-demo-trades migration ran correctly.
// Run AFTER pasting supabase/migrations/2026-05-08-archive-legacy-demo-trades.sql
// into the Supabase SQL Editor.
//
// Expected output (counts may shift slightly as more trades close):
//   ACTIVE   :  ~49 trades  (post 2026-04-17)
//   ARCHIVED : ~102 trades  (pre 2026-04-17 — SOL/BNB/BB_SQUEEZE era)
//
// If ARCHIVED is 0 the migration UPDATE didn't run. Re-paste the SQL.

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

async function head(query) {
  const r = await fetch(`${URL}/rest/v1/demo_trades?select=id&${query}`, {
    headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
  })
  if (!r.ok) {
    console.error(`HTTP ${r.status}: ${await r.text()}`)
    process.exit(1)
  }
  const range = r.headers.get('content-range') || '*/0'
  return Number(range.split('/')[1] || 0)
}

async function sumPnl(query) {
  // Pull all rows (small, max ~200) and sum client-side. PostgREST does not
  // expose SUM aggregates without a stored proc, and we don't have one.
  const r = await fetch(`${URL}/rest/v1/demo_trades?select=pnl&${query}&limit=10000`, { headers })
  if (!r.ok) return 0
  const rows = await r.json()
  return rows.reduce((s, t) => s + Number(t.pnl ?? 0), 0)
}

const activeCount = await head('archived_at=is.null&exit_time=not.is.null')
const archivedCount = await head('archived_at=not.is.null')
const totalCount = await head('exit_time=not.is.null')
const archivedPnl = await sumPnl('archived_at=not.is.null')
const activePnl = await sumPnl('archived_at=is.null&exit_time=not.is.null')

console.log('')
console.log('demo_trades archive status')
console.log('───────────────────────────────────────────────')
console.log(`  ACTIVE   : ${String(activeCount).padStart(4)} trades   PnL ${activePnl >= 0 ? '+' : ''}${activePnl.toFixed(2)} USD`)
console.log(`  ARCHIVED : ${String(archivedCount).padStart(4)} trades   PnL ${archivedPnl >= 0 ? '+' : ''}${archivedPnl.toFixed(2)} USD`)
console.log(`  TOTAL    : ${String(totalCount).padStart(4)} trades`)
console.log('')

if (archivedCount === 0 && totalCount > 50) {
  console.log('[warn] archived_count = 0 but total > 50 — migration UPDATE may not have run.')
  console.log('       Re-paste supabase/migrations/2026-05-08-archive-legacy-demo-trades.sql')
  console.log('       into Supabase SQL Editor.')
  process.exit(1)
}

console.log(`[ok] dashboard will show ${activeCount} closed trades, hiding ${archivedCount} legacy.`)
