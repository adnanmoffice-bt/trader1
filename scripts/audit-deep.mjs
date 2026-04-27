// Deep audit — bypasses the Supabase 1000-row cap by querying per-agent.
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
const HOURS = Number(process.argv[2] || 72)
const since = new Date(Date.now() - HOURS * 3600 * 1000).toISOString()
const tmLocal = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', hour12: false })

async function countAgent(agent) {
  const r = await fetch(`${URL}/rest/v1/agent_logs?agent=eq.${encodeURIComponent(agent)}&created_at=gte.${since}&select=id`, {
    headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
  })
  return Number(r.headers.get('content-range')?.split('/')?.[1] ?? 0)
}
async function distinctAgents() {
  // Get distinct agents using PostgREST
  const r = await fetch(`${URL}/rest/v1/agent_logs?created_at=gte.${since}&select=agent&order=agent.asc`, {
    headers: { ...headers, Range: '0-9999' },
  })
  const rows = await r.json()
  return [...new Set(rows.map(r => r.agent))]
}

console.log(`=== DEEP AGENT_LOGS AUDIT (${HOURS}h, since ${tmLocal(since)}) ===\n`)
const agents = await distinctAgents()
console.log(`Distinct agents seen: ${agents.length}`)
const counts = []
for (const a of agents) {
  const c = await countAgent(a)
  counts.push({ agent: a, n: c })
}
counts.sort((a, b) => b.n - a.n)
console.log('\nPer-agent volumes:')
for (const c of counts) console.log(`  ${c.agent.padEnd(30)} n=${c.n}`)

// Check by_level for each agent
console.log('\nPer-agent levels (sample query):')
for (const c of counts) {
  const r = await fetch(`${URL}/rest/v1/agent_logs?agent=eq.${encodeURIComponent(c.agent)}&created_at=gte.${since}&select=level&order=created_at.desc`, {
    headers: { ...headers, Range: '0-999' },
  })
  const rows = await r.json()
  const byLevel = {}
  for (const row of rows) byLevel[row.level] = (byLevel[row.level] || 0) + 1
  console.log(`  ${c.agent.padEnd(30)} ${JSON.stringify(byLevel)}  (sample of ${rows.length})`)
}

// Look for ALL warn/error across all agents
console.log('\n--- ERRORS + WARNS (full window, paginated) ---')
const errorRows = []
let offset = 0
while (true) {
  const r = await fetch(`${URL}/rest/v1/agent_logs?level=in.(error,warn)&created_at=gte.${since}&order=created_at.desc&select=created_at,agent,level,message&limit=1000&offset=${offset}`, { headers })
  const rows = await r.json()
  if (!Array.isArray(rows) || rows.length === 0) break
  errorRows.push(...rows)
  if (rows.length < 1000) break
  offset += 1000
  if (offset > 10000) break
}
console.log(`  total error+warn rows: ${errorRows.length}`)
const grp = {}
for (const r of errorRows) {
  const key = `[${r.agent}|${r.level}]`
  grp[key] = (grp[key] || 0) + 1
}
for (const [k, n] of Object.entries(grp).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n.toString().padStart(4)}  ${k}`)
}

// Recent meta-agent runs
console.log('\n--- META-AGENT runs (last 7 days) ---')
const meta7d = new Date(Date.now() - 7 * 86400e3).toISOString()
const mr = await fetch(`${URL}/rest/v1/meta_agent_runs?created_at=gte.${meta7d}&order=created_at.desc&select=*`, { headers })
const mrtxt = await mr.text()
let mrows
try { mrows = JSON.parse(mrtxt) } catch { mrows = mrtxt }
if (Array.isArray(mrows)) {
  console.log(`  meta_agent_runs (7d): ${mrows.length}`)
  for (const m of mrows.slice(0, 10)) {
    console.log(`  ${tmLocal(m.created_at)}  ${m.run_type ?? '?'}  ${(m.summary ?? '').slice(0, 100)}`)
  }
} else {
  console.log(`  meta_agent_runs query failed: ${mrtxt.slice(0, 200)}`)
}

// Check last 10 war-room "decision" messages
console.log('\n--- LAST 10 war-room DECISION messages ---')
const wr = await fetch(`${URL}/rest/v1/war_room_messages?role=eq.decision&order=created_at.desc&limit=10&select=created_at,instrument,agent,content`, { headers })
const wrows = await wr.json()
for (const w of wrows) {
  console.log(`  ${tmLocal(w.created_at)}  ${(w.instrument || '').padEnd(10)}  ${(w.content || '').slice(0, 120)}`)
}

// Last 10 war-room ALERT messages
console.log('\n--- LAST 10 war-room ALERT messages ---')
const wr2 = await fetch(`${URL}/rest/v1/war_room_messages?role=eq.alert&order=created_at.desc&limit=10&select=created_at,instrument,agent,content`, { headers })
const wrows2 = await wr2.json()
for (const w of wrows2) {
  console.log(`  ${tmLocal(w.created_at)}  ${(w.instrument || '').padEnd(10)}  [${w.agent}] ${(w.content || '').slice(0, 120)}`)
}

// Check if any LIVE trades EVER existed
console.log('\n--- LIVE TRADES table (all-time) ---')
const t = await fetch(`${URL}/rest/v1/trades?order=opened_at.desc&limit=10&select=*`, { headers })
const trows = await t.json()
console.log(`  total trades rows (sample): ${trows.length}`)
for (const r of trows) console.log(`  ${tmLocal(r.opened_at)} ${r.instrument} ${r.side} entry=${r.entry_price} pnl=${r.pnl_usd}`)

// Daily AI spend
console.log('\n--- AI SPEND BY DAY (budget-tracker) ---')
const bt = await fetch(`${URL}/rest/v1/agent_logs?agent=eq.budget-tracker&created_at=gte.${since}&select=created_at,metadata&order=created_at.desc&limit=10000`, { headers })
const btrows = await bt.json()
const byDay = {}
let total = 0
for (const r of btrows) {
  const day = r.created_at.slice(0, 10)
  const cost = Number(r.metadata?.cost_usd || 0)
  byDay[day] = (byDay[day] || 0) + cost
  total += cost
}
for (const [d, c] of Object.entries(byDay).sort()) console.log(`  ${d}  $${c.toFixed(4)}`)
console.log(`  TOTAL ${HOURS}h: $${total.toFixed(4)}  (rows=${btrows.length})`)

console.log('\n=== DONE ===')
