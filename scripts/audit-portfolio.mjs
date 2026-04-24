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

const r = await fetch(`${URL}/rest/v1/portfolio?select=*&order=updated_at.desc`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
})
const rows = await r.json()
console.log('portfolio rows:', rows.length)
for (const x of rows) console.log(JSON.stringify(x, null, 2))

// Also compute current demo session realized PnL
console.log('\n--- demo_sessions (active) ---')
const s = await fetch(`${URL}/rest/v1/demo_sessions?status=eq.running&select=*&order=created_at.desc&limit=5`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
})
for (const sess of await s.json()) console.log(JSON.stringify(sess, null, 2))

// Total demo pnl across all trades in active session
console.log('\n--- total realized PnL (all demo_trades, all sessions) ---')
const t = await fetch(`${URL}/rest/v1/demo_trades?select=pnl,exit_reason&exit_time=not.is.null`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
})
const trades = await t.json()
const pnl = trades.reduce((s, x) => s + Number(x.pnl ?? 0), 0)
const wins = trades.filter(x => Number(x.pnl) > 0).length
const losses = trades.filter(x => Number(x.pnl) <= 0).length
console.log(`  closed=${trades.length}  ${wins}W/${losses}L  realized=$${pnl.toFixed(2)}`)
