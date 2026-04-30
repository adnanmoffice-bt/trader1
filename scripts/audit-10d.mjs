// 10-day end-to-end APEX system audit. Read-only.
//
// Pulls from Supabase (service role) AND uses correct column names per actual
// schema (demo_trades.entry_time, not opened_at; trades is empty; etc.).
//
// Usage: node scripts/audit-10d.mjs [hours=240]
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
const HOURS = Number(process.argv[2] || 240)
const since = new Date(Date.now() - HOURS * 3600 * 1000).toISOString()
const sinceQ = `gte.${since}`
const tmLocal = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', hour12: false })

async function exactCount(table, filter = '') {
  const r = await fetch(`${URL}/rest/v1/${table}?select=id${filter ? '&' + filter : ''}`, {
    headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
  })
  return Number(r.headers.get('content-range')?.split('/')?.[1] ?? -1)
}
async function getAll(table, qs = '', max = 30000) {
  const rows = []
  for (let off = 0; off < max; off += 1000) {
    const r = await fetch(`${URL}/rest/v1/${table}?${qs}&limit=1000&offset=${off}`, { headers })
    if (!r.ok) return rows
    const j = await r.json()
    if (!Array.isArray(j) || j.length === 0) break
    rows.push(...j)
    if (j.length < 1000) break
  }
  return rows
}

console.log(`=== APEX 10-DAY AUDIT (${HOURS}h, since ${tmLocal(since)} Dubai) ===\n`)

console.log('━━━ COUNTS ━━━')
for (const [tbl, col] of [
  ['signals', 'created_at'],
  ['trades', 'opened_at'],
  ['demo_trades', 'entry_time'],
  ['positions', 'opened_at'],
  ['agent_logs', 'created_at'],
  ['war_room_messages', 'created_at'],
  ['price_history', 'timestamp'],
]) {
  const n = await exactCount(tbl, `${col}=${sinceQ}`)
  const total = await exactCount(tbl)
  console.log(`  ${tbl.padEnd(22)} window=${n.toString().padStart(6)}   total=${total}`)
}

// Demo trades — the actual proxy for war-room decisions in live mode
console.log('\n━━━ DEMO TRADES (window) ━━━')
const dRows = await getAll('demo_trades', `entry_time=${sinceQ}&order=entry_time.desc&select=*`)
const closed = dRows.filter(t => t.exit_price != null)
const open = dRows.filter(t => t.exit_price == null)
let pnl = 0, w = 0, l = 0
for (const t of closed) { const p = Number(t.pnl || 0); pnl += p; if (p > 0) w++; else if (p < 0) l++ }
console.log(`  total opened: ${dRows.length}  closed: ${closed.length}  open: ${open.length}`)
console.log(`  PnL: $${pnl.toFixed(2)}   W=${w}  L=${l}  WR=${closed.length ? ((w/closed.length)*100).toFixed(1) : 0}%`)
const reasons = {}
for (const t of closed) reasons[t.exit_reason || '?'] = (reasons[t.exit_reason || '?'] || 0) + 1
console.log(`  exit reasons: ${JSON.stringify(reasons)}`)
const byInstr = {}
for (const t of dRows) byInstr[t.instrument] = (byInstr[t.instrument] || 0) + 1
console.log(`  by instrument: ${JSON.stringify(byInstr)}`)

console.log('\n  --- all trades ---')
for (const t of dRows) {
  console.log(`    ${tmLocal(t.entry_time)}  ${t.instrument} ${t.direction}  entry=${t.entry_price}  exit=${t.exit_price ?? '-'}  pnl=$${(t.pnl||0).toFixed(2)}  reason=${t.exit_reason ?? 'open'}  conf=${t.confidence}`)
}

// Live trades (must be 0 unless something happened)
console.log('\n━━━ LIVE TRADES (window) ━━━')
const lt = await getAll('trades', `opened_at=${sinceQ}&order=opened_at.desc&select=*`)
console.log(`  count: ${lt.length}`)
for (const t of lt) console.log(`    ${tmLocal(t.opened_at)} ${t.instrument} ${t.direction} entry=${t.entry_price} pnl=${t.pnl_usd}`)

// War-room funnel
console.log('\n━━━ WAR-ROOM FUNNEL ━━━')
const wr = await getAll('war_room_messages', `created_at=${sinceQ}&select=meeting_id,role,instrument&order=created_at.desc`)
const meetings = new Map()
for (const m of wr) {
  if (!meetings.has(m.meeting_id)) meetings.set(m.meeting_id, { roles: {}, instrument: m.instrument })
  meetings.get(m.meeting_id).roles[m.role] = (meetings.get(m.meeting_id).roles[m.role] || 0) + 1
  if (!meetings.get(m.meeting_id).instrument && m.instrument) meetings.get(m.meeting_id).instrument = m.instrument
}
const total = meetings.size
const speak = [...meetings.values()].filter(m => m.roles.speak).length
const decided = [...meetings.values()].filter(m => m.roles.decision).length
const opened = [...meetings.values()].filter(m => m.roles.open).length
console.log(`  meetings: ${total}  reachedSpeak: ${speak}  reachedDecision: ${decided}  reachedOpen: ${opened}`)
console.log(`  conversion: speak ${(speak/total*100).toFixed(1)}%  decision ${(decided/total*100).toFixed(1)}%  open ${(opened/total*100).toFixed(1)}%`)

// Heartbeats
console.log('\n━━━ CRON HEARTBEATS ━━━')
const heartbeats = await getAll('agent_logs', `created_at=${sinceQ}&select=agent,created_at,level&order=created_at.desc`, 30000)
const byAgent = {}
for (const h of heartbeats) {
  byAgent[h.agent] = byAgent[h.agent] || { n: 0, last: h.created_at, levels: {} }
  byAgent[h.agent].n++
  if (h.created_at > byAgent[h.agent].last) byAgent[h.agent].last = h.created_at
  byAgent[h.agent].levels[h.level] = (byAgent[h.agent].levels[h.level] || 0) + 1
}
for (const [a, info] of Object.entries(byAgent).sort((a,b)=>b[1].n - a[1].n)) {
  const ageMin = Math.floor((Date.now() - new Date(info.last))/60000)
  console.log(`  ${a.padEnd(28)} n=${info.n.toString().padStart(5)}  last=${ageMin}min ago  levels=${JSON.stringify(info.levels)}`)
}

// AI spend
console.log('\n━━━ AI SPEND PER DAY ━━━')
const bt = await getAll('agent_logs', `agent=eq.budget-tracker&created_at=${sinceQ}&select=created_at,metadata&order=created_at.desc`, 5000)
const byDay = {}
let totalCost = 0
for (const r of bt) {
  const d = r.created_at.slice(0, 10)
  const c = Number(r.metadata?.cost_usd || 0)
  byDay[d] = (byDay[d] || 0) + c
  totalCost += c
}
for (const [d, c] of Object.entries(byDay).sort()) console.log(`  ${d}  $${c.toFixed(4)}`)
console.log(`  TOTAL: $${totalCost.toFixed(4)}`)

// Settings & portfolio
console.log('\n━━━ STATE ━━━')
const us = await getAll('user_settings', 'select=*', 10)
for (const s of us) console.log(`  user_settings: mode=${s.trading_mode} auto=${s.auto_trade_enabled} dailyLoss=${s.daily_loss_limit_pct}% maxDD=${s.max_drawdown_pct}% risk=${s.risk_per_trade_pct}% maxPos=${s.max_positions} curr=${s.currency} initCap=${s.initial_capital}`)
const pf = await getAll('portfolio', 'select=*', 10)
for (const p of pf) console.log(`  portfolio: capital=${p.capital} avail=${p.available_capital} realPnL=${p.realized_pnl} W/L=${p.win_count}/${p.loss_count} peak=${p.peak_capital} demo=${p.is_demo} updated=${tmLocal(p.updated_at)}`)

console.log('\n=== AUDIT COMPLETE ===')
