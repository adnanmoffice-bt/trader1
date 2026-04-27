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
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }
const r = await fetch(`${URL}/rest/v1/agent_logs?agent=eq.polymarket-scanner&level=eq.error&order=created_at.desc&limit=3`, { headers })
const rows = await r.json()
for (const row of rows) {
  console.log('---')
  console.log('time:', row.created_at)
  console.log('msg:', row.message)
}
