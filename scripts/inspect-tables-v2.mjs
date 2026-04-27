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

const TABLES = [
  'performance_snapshots', 'agent_knowledge', 'meta_agent_runs',
  'performance_reviews', 'kill_switch_events', 'daily_pnl',
  'polymarket_bets', 'polymarket_markets',
  'market_news', 'macro_events', 'fear_greed',
  'wallet_snapshots', 'risk_config',
]

for (const t of TABLES) {
  const r = await fetch(`${URL}/rest/v1/${t}?limit=2&order=created_at.desc`, { headers })
  if (!r.ok) {
    const txt = await r.text()
    console.log(`${t.padEnd(28)} MISSING (${r.status}) ${txt.slice(0, 80)}`)
    continue
  }
  const j = await r.json()
  // Get row count
  const c = await fetch(`${URL}/rest/v1/${t}?select=*`, { headers: { ...headers, Prefer: 'count=exact', Range: '0-0' } })
  const total = Number(c.headers.get('content-range')?.split('/')?.[1] ?? 0)
  console.log(`${t.padEnd(28)} OK    rows=${total}  ${j.length ? 'sample: ' + Object.keys(j[0]).slice(0, 6).join(',') : '(empty)'}`)
  if (j.length) console.log(`  latest: ${j[0].created_at || j[0].date || j[0].timestamp || '?'}`)
}
