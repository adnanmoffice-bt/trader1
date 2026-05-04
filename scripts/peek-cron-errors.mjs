// Pull the most recent error-level agent_logs for a given agent. Read-only.
//
// Usage: node scripts/peek-cron-errors.mjs <agent> [hours=96] [limit=10]
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
const agent = process.argv[2]
if (!agent) { console.error('Usage: node scripts/peek-cron-errors.mjs <agent> [hours] [limit]'); process.exit(1) }
const HOURS = Number(process.argv[3] || 96)
const LIMIT = Number(process.argv[4] || 10)
const since = new Date(Date.now() - HOURS * 3600 * 1000).toISOString()
const r = await fetch(
  `${URL}/rest/v1/agent_logs?agent=eq.${agent}&level=eq.error&created_at=gte.${since}&select=created_at,message,metadata&order=created_at.desc&limit=${LIMIT}`,
  { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
)
const rows = await r.json()
console.log(`=== ${agent} errors (last ${HOURS}h, max ${LIMIT}) ===`)
for (const r of rows) {
  console.log(`\n${r.created_at}`)
  console.log(`  msg: ${r.message}`)
  if (r.metadata) console.log(`  meta: ${JSON.stringify(r.metadata).slice(0, 400)}`)
}
if (!rows.length) console.log('No errors in window.')
