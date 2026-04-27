/**
 * APEX 24h trading audit.
 * Read-only — queries Supabase (service role) for the last 24h of:
 *  - trades (real + demo) opened/closed
 *  - positions (open now)
 *  - agent_logs (errors, warnings, live-exec trail, war-room decisions)
 *  - signals created
 *  - war_room_messages decisions
 *  - market_data freshness
 *  - portfolio state
 *
 * Usage: node scripts/audit-24h.mjs
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
if (!URL || !KEY) { console.error('Missing Supabase env'); process.exit(1) }

const HOURS = Number(process.env.WINDOW_HOURS || process.argv[2] || 24)
const DAY_AGO = new Date(Date.now() - HOURS * 3600 * 1000).toISOString()
const HR48_AGO = new Date(Date.now() - 48 * 3600 * 1000).toISOString()

async function q(table, params) {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${URL}/rest/v1/${table}?${qs}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  })
  if (!res.ok) {
    console.error(`  ERR ${table}: ${res.status} ${await res.text()}`)
    return []
  }
  return res.json()
}

function fmt(x, n = 2) { return x == null ? 'n/a' : Number(x).toFixed(n) }
function tmLocal(iso) {
  if (!iso) return 'n/a'
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { timeZone: 'Asia/Dubai', hour12: false })
}
function ago(iso) {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m ago`
  const h = (m / 60).toFixed(1)
  return `${h}h ago`
}

console.log(`=== APEX ${HOURS}h AUDIT ===`)
console.log(`Window: ${tmLocal(DAY_AGO)} → ${tmLocal(new Date().toISOString())}  (Dubai)\n`)

// 1. PORTFOLIO STATE
console.log('━━━ PORTFOLIO ━━━')
{
  const rows = await q('portfolio', { select: '*', order: 'updated_at.desc', limit: 5 })
  for (const r of rows) {
    console.log(`  user ${r.user_id?.slice(0,8)}  capital=$${fmt(r.capital)}  avail=$${fmt(r.available_capital)}  W${r.win_count}/L${r.loss_count}  upd ${tmLocal(r.updated_at)}`)
  }
}

// 2. OPEN POSITIONS NOW
console.log('\n━━━ OPEN POSITIONS (now) ━━━')
{
  const rows = await q('positions', { select: '*', order: 'opened_at.desc', limit: 50 })
  if (rows.length === 0) console.log('  (none)')
  for (const r of rows) {
    const tag = r.is_demo ? 'DEMO' : 'LIVE'
    console.log(`  [${tag}] ${r.instrument.padEnd(10)} ${r.direction.toUpperCase().padEnd(5)} qty=${r.quantity}  entry=$${fmt(r.avg_entry_price,4)}  now=$${fmt(r.current_price,4)}  uPnL=$${fmt(r.unrealized_pnl)} (${fmt(r.unrealized_pnl_pct,2)}%)  SL=${fmt(r.stop_loss,4)} TP=${fmt(r.take_profit,4)}  opened ${ago(r.opened_at)}`)
  }
}

// 3. TRADES IN LAST 24h
console.log('\n━━━ TRADES opened OR closed in last 24h ━━━')
{
  const rowsOpened = await q('trades', { select: '*', opened_at: `gte.${DAY_AGO}`, order: 'opened_at.desc', limit: 200 })
  const rowsClosed = await q('trades', { select: '*', closed_at: `gte.${DAY_AGO}`, order: 'closed_at.desc', limit: 200 })
  const byId = new Map()
  for (const r of [...rowsOpened, ...rowsClosed]) byId.set(r.id, r)
  const rows = [...byId.values()].sort((a,b) => new Date(b.opened_at) - new Date(a.opened_at))
  if (rows.length === 0) console.log('  (no trades in 24h)')

  let realOpen=0, realClosed=0, realWin=0, realLoss=0, realPnL=0
  let demoOpen=0, demoClosed=0, demoWin=0, demoLoss=0, demoPnL=0

  for (const t of rows) {
    const tag = t.is_demo ? 'DEMO' : 'LIVE'
    const status = t.status.toUpperCase()
    const pnl = t.pnl == null ? '' : `  pnl=$${fmt(t.pnl)} (${fmt(t.pnl_pct,2)}%)`
    const exit = t.exit_price ? ` exit=$${fmt(t.exit_price,4)}` : ''
    const closed = t.closed_at ? `  closed ${tmLocal(t.closed_at)}` : ''
    console.log(`  [${tag}] ${status.padEnd(7)} ${t.instrument.padEnd(10)} ${t.direction.toUpperCase().padEnd(5)} qty=${t.quantity} entry=$${fmt(t.entry_price,4)}${exit}${pnl}  opened ${tmLocal(t.opened_at)}${closed}`)
    if (t.notes) console.log(`         note: ${t.notes.slice(0,140)}`)

    if (t.is_demo) {
      if (t.status === 'open') demoOpen++
      else { demoClosed++; demoPnL += Number(t.pnl || 0); if (Number(t.pnl) > 0) demoWin++; else demoLoss++ }
    } else {
      if (t.status === 'open') realOpen++
      else { realClosed++; realPnL += Number(t.pnl || 0); if (Number(t.pnl) > 0) realWin++; else realLoss++ }
    }
  }

  console.log('\n  ── 24h P&L summary ──')
  console.log(`  LIVE:  opened=${realOpen}  closed=${realClosed}  ${realWin}W/${realLoss}L  realized=$${fmt(realPnL)}`)
  console.log(`  DEMO:  opened=${demoOpen}  closed=${demoClosed}  ${demoWin}W/${demoLoss}L  realized=$${fmt(demoPnL)}`)
}

// 4. SIGNALS created in 24h
console.log('\n━━━ SIGNALS created in last 24h ━━━')
{
  const rows = await q('signals', { select: '*', created_at: `gte.${DAY_AGO}`, order: 'created_at.desc', limit: 200 })
  if (rows.length === 0) console.log('  (no signals)')
  for (const s of rows) {
    console.log(`  ${tmLocal(s.created_at)}  ${s.instrument.padEnd(10)} ${s.direction.toUpperCase().padEnd(5)} conf=${s.confidence}  status=${s.status}  RR=${fmt(s.risk_reward,2)}  entry=$${fmt(s.entry_price,4)} SL=${fmt(s.stop_loss,4)} TP=${fmt(s.take_profit_1,4)}`)
  }
}

// 5. WAR-ROOM all messages (broad view)
console.log('\n━━━ WAR-ROOM messages in last 24h (ALL roles) ━━━')
{
  const rows = await q('war_room_messages', { select: '*', created_at: `gte.${DAY_AGO}`, order: 'created_at.desc', limit: 500 })
  if (rows.length === 0) console.log('  (nothing — war-room never emitted any message in 24h)')
  const byRole = {}
  const byAgent = {}
  const meetings = new Set()
  for (const m of rows) {
    byRole[m.role] = (byRole[m.role] || 0) + 1
    byAgent[m.agent] = (byAgent[m.agent] || 0) + 1
    meetings.add(m.meeting_id)
  }
  console.log(`  Total msgs: ${rows.length} | Meetings: ${meetings.size} | roles=${JSON.stringify(byRole)} | agents=${JSON.stringify(byAgent)}`)
  for (const m of rows.slice(0, 30)) {
    console.log(`  ${tmLocal(m.created_at)}  ${(m.instrument||'—').padEnd(10)} [${m.role.padEnd(8)}] ${m.agent.padEnd(18)} ${(m.message||'').slice(0,120)}`)
  }
}

// 6. LIVE-EXEC agent logs (real-money execution path)
console.log('\n━━━ LIVE-EXEC log trail (last 24h) ━━━')
{
  const rows = await q('agent_logs', { select: '*', created_at: `gte.${DAY_AGO}`, agent: 'eq.live-exec', order: 'created_at.desc', limit: 100 })
  if (rows.length === 0) console.log('  (no live-exec events — war-room never reached live path)')
  for (const r of rows) {
    console.log(`  ${tmLocal(r.created_at)}  [${r.level.toUpperCase().padEnd(5)}] ${r.message}`)
    if (r.metadata) console.log(`         ${JSON.stringify(r.metadata).slice(0,180)}`)
  }
}

// 7. ERRORS in 24h
console.log('\n━━━ ERROR-level logs in last 24h ━━━')
{
  const rows = await q('agent_logs', { select: '*', created_at: `gte.${DAY_AGO}`, level: 'eq.error', order: 'created_at.desc', limit: 80 })
  if (rows.length === 0) console.log('  (no errors)')
  const byAgent = {}
  for (const r of rows) byAgent[r.agent] = (byAgent[r.agent] || 0) + 1
  console.log(`  Total: ${rows.length} | By agent: ${Object.entries(byAgent).map(([k,v]) => `${k}=${v}`).join(', ')}\n`)
  for (const r of rows.slice(0, 20)) {
    console.log(`  ${tmLocal(r.created_at)}  [${r.agent}] ${r.message.slice(0,150)}`)
  }
}

// 8. WARN-level logs (sample)
console.log('\n━━━ WARN-level logs in last 24h (top agents) ━━━')
{
  const rows = await q('agent_logs', { select: '*', created_at: `gte.${DAY_AGO}`, level: 'eq.warn', order: 'created_at.desc', limit: 200 })
  const byAgent = {}
  for (const r of rows) byAgent[r.agent] = (byAgent[r.agent] || 0) + 1
  console.log(`  Total: ${rows.length} | By agent: ${Object.entries(byAgent).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v]) => `${k}=${v}`).join(', ')}`)
  for (const r of rows.slice(0, 15)) {
    console.log(`  ${tmLocal(r.created_at)}  [${r.agent}] ${r.message.slice(0,140)}`)
  }
}

// 8b. ALL agent_logs 24h — who actually ran?
console.log('\n━━━ ALL agent_logs in 24h — activity by agent ━━━')
{
  const rows = await q('agent_logs', { select: 'agent,level,created_at', created_at: `gte.${DAY_AGO}`, order: 'created_at.desc', limit: 1000 })
  const byAgent = {}
  for (const r of rows) {
    byAgent[r.agent] = byAgent[r.agent] || { count:0, last:null, first:null, levels:{} }
    byAgent[r.agent].count++
    byAgent[r.agent].levels[r.level] = (byAgent[r.agent].levels[r.level] || 0) + 1
    if (!byAgent[r.agent].last) byAgent[r.agent].last = r.created_at
    byAgent[r.agent].first = r.created_at
  }
  console.log(`  Total log rows: ${rows.length}`)
  const sorted = Object.entries(byAgent).sort((a,b) => b[1].count - a[1].count)
  for (const [agent, d] of sorted) {
    console.log(`  ${agent.padEnd(25)} n=${String(d.count).padStart(4)}  levels=${JSON.stringify(d.levels)}  last=${tmLocal(d.last)}  first=${tmLocal(d.first)}`)
  }
}

// 9. WAR-ROOM heartbeat (any agent='war-room' log)
console.log('\n━━━ WAR-ROOM activity (last 24h) ━━━')
{
  const rows = await q('agent_logs', { select: 'agent,level,message,created_at', created_at: `gte.${DAY_AGO}`, agent: 'eq.war-room', order: 'created_at.desc', limit: 300 })
  const byLevel = {}
  for (const r of rows) byLevel[r.level] = (byLevel[r.level] || 0) + 1
  console.log(`  Total: ${rows.length} | Levels: ${JSON.stringify(byLevel)}`)
  if (rows.length > 0) {
    console.log(`  First: ${tmLocal(rows[rows.length-1].created_at)}  Last: ${tmLocal(rows[0].created_at)}`)
  }
}

// 10. MARKET DATA FRESHNESS
console.log('\n━━━ MARKET DATA freshness ━━━')
{
  const rows = await q('market_data', { select: 'symbol,price,fetched_at,source', order: 'fetched_at.desc', limit: 25 })
  const stale = rows.filter(r => Date.now() - new Date(r.fetched_at).getTime() > 10 * 60000)
  const fresh = rows.filter(r => Date.now() - new Date(r.fetched_at).getTime() <= 10 * 60000)
  console.log(`  Fresh (<10min): ${fresh.length}  |  Stale (>10min): ${stale.length}`)
  for (const r of rows) {
    const aMs = Date.now() - new Date(r.fetched_at).getTime()
    const tag = aMs > 10*60000 ? 'STALE' : 'ok   '
    console.log(`  [${tag}] ${r.symbol.padEnd(10)} $${fmt(r.price,4)}  src=${r.source}  ${ago(r.fetched_at)}`)
  }
}

// 11. DEMO TRADES 24h (to track simulated performance)
console.log('\n━━━ DEMO TRADES (last 24h) ━━━')
{
  const rowsA = await q('demo_trades', { select: '*', entry_time: `gte.${DAY_AGO}`, order: 'entry_time.desc', limit: 200 })
  const rowsB = await q('demo_trades', { select: '*', exit_time: `gte.${DAY_AGO}`, order: 'exit_time.desc', limit: 200 })
  const byId = new Map()
  for (const r of [...rowsA, ...rowsB]) byId.set(r.id, r)
  const rows = [...byId.values()]
  let w=0,l=0,open=0,pnl=0
  for (const r of rows) {
    if (!r.exit_time) { open++; continue }
    pnl += Number(r.pnl||0)
    if (Number(r.pnl) > 0) w++; else l++
  }
  console.log(`  total=${rows.length}  open=${open}  closed=${w+l}  ${w}W/${l}L  realized=$${fmt(pnl)}`)
  for (const r of rows.slice(0, 10)) {
    console.log(`  ${tmLocal(r.entry_time)}  ${r.instrument.padEnd(10)} ${r.direction} conf=${r.confidence}  pnl=$${fmt(r.pnl)}  exit=${r.exit_reason||'open'}`)
  }
}

// 12. USER SETTINGS (live vs demo)
console.log('\n━━━ USER SETTINGS ━━━')
{
  const rows = await q('user_settings', { select: '*', limit: 5 })
  for (const r of rows) {
    const fields = ['trading_mode','auto_trade_enabled','primary_exchange','kill_switch_active','max_position_size_usd','daily_loss_limit_pct','max_open_positions','whatsapp_enabled','notifications_enabled']
    const parts = fields.filter(f => r[f] !== undefined).map(f => `${f}=${r[f]}`)
    console.log(`  user ${r.user_id?.slice(0,8)}  ${parts.join('  ')}`)
  }
}

console.log('\n=== AUDIT DONE ===')
