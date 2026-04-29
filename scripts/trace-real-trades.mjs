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

async function q(table, params) {
  const qs = new URLSearchParams(params).toString()
  const r = await fetch(`${URL}/rest/v1/${table}?${qs}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  if (!r.ok) { console.error('ERR', table, r.status, await r.text()); return [] }
  return r.json()
}

console.log('=== TRADES table — last 40 rows by opened_at ===')
const all = await q('trades', { select: '*', order: 'opened_at.desc', limit: 40 })
console.log('rows:', all.length)
for (const r of all) {
  const tag = r.is_demo ? 'DEMO' : 'LIVE'
  console.log(`  [${tag}] ${String(r.status).padEnd(7)} ${String(r.instrument).padEnd(10)} ${String(r.direction).padEnd(5)} qty=${r.quantity} entry=${r.entry_price} exit=${r.exit_price||'—'} pnl=${r.pnl||'—'} (${r.pnl_pct||'—'}%) opened=${r.opened_at} closed=${r.closed_at||'—'}`)
  if (r.notes) console.log('     notes:', String(r.notes).slice(0,200))
}

console.log('\n=== TRADES is_demo=false — last 50 ===')
const live = await q('trades', { select: '*', is_demo: 'eq.false', order: 'opened_at.desc', limit: 50 })
console.log('rows:', live.length)
for (const r of live) {
  console.log(`  ${r.status} ${r.instrument} ${r.direction} qty=${r.quantity} entry=${r.entry_price} exit=${r.exit_price||'—'} pnl=${r.pnl||'—'} opened=${r.opened_at} closed=${r.closed_at||'—'}`)
  if (r.notes) console.log('     notes:', String(r.notes).slice(0,200))
}

console.log('\n=== POSITIONS — ALL (open + closed last 30) ===')
const pos = await q('positions', { select: '*', order: 'opened_at.desc', limit: 30 })
console.log('rows:', pos.length)
for (const r of pos) {
  const tag = r.is_demo ? 'DEMO' : 'LIVE'
  console.log(`  [${tag}] ${r.status} ${r.instrument} ${r.direction} qty=${r.quantity} avg=${r.avg_entry_price} now=${r.current_price} uPnL=${r.unrealized_pnl} (${r.unrealized_pnl_pct}%) opened=${r.opened_at} closed=${r.closed_at||'—'}`)
}

console.log('\n=== live-exec agent_logs — last 200 ===')
const le = await q('agent_logs', { select: '*', agent: 'eq.live-exec', order: 'created_at.desc', limit: 200 })
console.log('rows:', le.length)
for (const r of le) {
  console.log(`  ${r.created_at} [${r.level}] ${(r.message||'').slice(0,220)}`)
  if (r.metadata && Object.keys(r.metadata).length) console.log('     meta:', JSON.stringify(r.metadata).slice(0,260))
}

console.log('\n=== war-room agent_logs — last 100 ===')
const wr = await q('agent_logs', { select: '*', agent: 'eq.war-room', order: 'created_at.desc', limit: 100 })
console.log('rows:', wr.length)
for (const r of wr) {
  console.log(`  ${r.created_at} [${r.level}] ${(r.message||'').slice(0,220)}`)
}

console.log('\n=== war_room_messages role=open or role=decision — last 30 ===')
const op = await q('war_room_messages', { select: 'created_at,instrument,role,agent,message,meeting_id', role: 'in.(open,decision,alert)', order: 'created_at.desc', limit: 30 })
console.log('rows:', op.length)
for (const r of op) {
  console.log(`  ${r.created_at} [${r.role}] ${r.instrument} ${r.agent}: ${(r.message||'').slice(0,260)}`)
}
