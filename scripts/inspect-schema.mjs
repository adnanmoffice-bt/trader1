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

async function sample(table) {
  const r = await fetch(`${URL}/rest/v1/${table}?limit=1`, { headers })
  if (!r.ok) return { _err: r.status + ' ' + (await r.text()).slice(0, 150) }
  const j = await r.json()
  if (!j.length) return { _empty: true }
  return j[0]
}

for (const t of ['war_room_messages', 'agent_logs', 'trades', 'demo_trades',
                 'positions', 'signals', 'portfolio', 'user_settings',
                 'meta_agent_runs', 'performance_reviews', 'price_history',
                 'demo_sessions', 'kill_switch_events', 'daily_pnl']) {
  const s = await sample(t)
  console.log(`\n=== ${t} ===`)
  console.log(JSON.stringify(s, null, 2).slice(0, 1500))
}
