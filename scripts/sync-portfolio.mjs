/**
 * One-off: resync the portfolio row from the current demo_sessions state
 * and refresh updated_at. Also drop the orphaned is_demo=true placeholder.
 */
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

async function api(method, path, body) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${(await res.text()).slice(0,200)}`)
  return res.json()
}

const [sess] = await api('GET', 'demo_sessions?status=eq.running&order=created_at.desc&limit=1&select=*')
if (!sess) { console.error('No running demo session'); process.exit(1) }

const updated = await api('PATCH', 'portfolio?is_demo=eq.false', {
  capital: Number(sess.final_capital ?? sess.initial_capital),
  available_capital: Number(sess.final_capital ?? sess.initial_capital),
  realized_pnl: Number(sess.total_pnl ?? 0),
  win_count: sess.win_count,
  loss_count: sess.loss_count,
  updated_at: new Date().toISOString(),
})
console.log('portfolio (is_demo=false) after sync:')
console.log(JSON.stringify(updated[0], null, 2))

console.log('\nDeleting orphan portfolio row (is_demo=true, never used by app)...')
const del = await fetch(`${URL}/rest/v1/portfolio?is_demo=eq.true`, {
  method: 'DELETE',
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'return=representation' },
})
if (del.ok) console.log('  deleted', (await del.json()).length, 'rows')
else console.log('  skip:', del.status, (await del.text()).slice(0,100))
