// Quick status: external_signals + telegram-* logs + trade_journal. Read-only.
//
// Usage: node scripts/check-trade-status.mjs [hours=24]
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
const HOURS = Number(process.argv[2] || 24)
const since = new Date(Date.now() - HOURS * 3600 * 1000).toISOString()
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function get(p) {
  const r = await fetch(`${URL}/rest/v1/${p}`, { headers })
  if (!r.ok) { console.error('HTTP', r.status, p, await r.text()); return [] }
  return r.json()
}

console.log(`\n=== external_signals (last ${HOURS}h) ===`)
const sigs = await get(
  `external_signals?created_at=gte.${since}&select=*&order=created_at.desc&limit=50`,
)
if (!sigs.length) console.log('  (none)')
for (const s of sigs) {
  console.log(`\n  ${s.id} ${s.created_at}`)
  console.log(`    instrument=${s.instrument || '-'} direction=${s.direction || '-'}`)
  console.log(`    status=${s.execution_status || '-'} executed=${s.executed_at || '-'}`)
  if (s.raw_text) console.log(`    raw: ${String(s.raw_text).replace(/\n/g, ' | ').slice(0, 200)}`)
  if (s.metadata?.skip_reason) console.log(`    skip_reason=${s.metadata.skip_reason}`)
  if (s.metadata?.parser_error) console.log(`    parser_error=${s.metadata.parser_error}`)
  if (s.metadata?.execution?.error) console.log(`    exec_error=${JSON.stringify(s.metadata.execution.error).slice(0,200)}`)
  if (s.metadata?.execution?.deal_id) console.log(`    deal_id=${s.metadata.execution.deal_id}`)
}

console.log(`\n=== agent_logs (telegram-executor-cron, last ${HOURS}h) ===`)
const exc = await get(
  `agent_logs?agent=eq.telegram-executor-cron&created_at=gte.${since}&select=created_at,level,message,metadata&order=created_at.desc&limit=20`,
)
if (!exc.length) console.log('  (none)')
for (const r of exc) {
  console.log(`  ${r.created_at} [${r.level}] ${r.message}`)
  if (r.metadata?.outcomes && r.metadata.outcomes.length) {
    console.log(`    outcomes: ${JSON.stringify(r.metadata.outcomes).slice(0, 400)}`)
  }
}

console.log(`\n=== open IG positions (live) ===`)
try {
  const r = await fetch(`${URL.replace(/\.supabase\.co$/, '.supabase.co')}/rest/v1/positions?select=*&status=eq.open&order=opened_at.desc&limit=20`, { headers })
  if (r.ok) {
    const rows = await r.json()
    if (!rows.length) console.log('  (none)')
    for (const p of rows) console.log(`  ${p.instrument} ${p.direction} entry=${p.entry_price} status=${p.status}`)
  } else {
    console.log('  (positions table not queryable: ' + r.status + ')')
  }
} catch (e) { console.log('  err: ' + e.message) }

console.log(`\n=== trade_journal (last ${HOURS}h) ===`)
const tj = await get(
  `trade_journal?ts=gte.${since}&select=*&order=ts.desc&limit=20`,
)
if (!tj.length) console.log('  (none)')
for (const t of tj) {
  console.log(`  ${t.ts} ${t.instrument} ${t.action} ${JSON.stringify(t.data).slice(0,200)}`)
}
