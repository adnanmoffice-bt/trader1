// Probe-week audit (2026-05-08T10:30Z → 2026-05-15T20:00Z).
// Read-only. Answers "are we in plus or minus" with hard numbers.
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

const PROBE_START_ISO = '2026-05-08T10:30:00Z'
const PROBE_END_ISO = '2026-05-15T20:00:00Z'
const PROBE_KILL_USD = 200
const tmLocal = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', hour12: false })

const startMs = new Date(PROBE_START_ISO).getTime()
const endMs = new Date(PROBE_END_ISO).getTime()
const nowMs = Date.now()
const elapsedHrs = (nowMs - startMs) / 3600_000
const remainingHrs = Math.max(0, (endMs - nowMs) / 3600_000)

console.log('=== APEX PROBE-WEEK AUDIT ===')
console.log(`Window  : ${tmLocal(PROBE_START_ISO)} → ${tmLocal(PROBE_END_ISO)} (Dubai)`)
console.log(`Elapsed : ${elapsedHrs.toFixed(1)}h  |  Remaining: ${remainingHrs.toFixed(1)}h`)
console.log(`Kill at : -$${PROBE_KILL_USD} cumulative real P&L`)
console.log('')

async function getJson(url) {
  const r = await fetch(url, { headers })
  return r.json()
}

// 1. REAL trades since probe start
console.log('━━━ REAL TRADES (probe window) ━━━')
const trades = await getJson(`${URL}/rest/v1/trades?opened_at=gte.${PROBE_START_ISO}&order=opened_at.asc&limit=500&select=*`)
console.log(`  rows: ${trades.length}`)
let realRealised = 0
let realOpened = 0
let realClosed = 0
let realW = 0
let realL = 0
const realOpen = []
for (const t of trades) {
  realOpened++
  const pnl = Number(t.pnl ?? t.pnl_usd ?? 0)
  const status = (t.status || '').toLowerCase()
  if (status === 'closed' || status === 'stopped' || t.closed_at) {
    realClosed++
    realRealised += pnl
    if (pnl > 0) realW++
    else if (pnl < 0) realL++
    console.log(`  ${tmLocal(t.opened_at)} → ${t.closed_at ? tmLocal(t.closed_at) : '?'}  ${(t.instrument || '').padEnd(10)} ${(t.side || '').padEnd(5)} entry=${t.entry_price} pnl=$${pnl.toFixed(2)}  status=${status}`)
  } else {
    realOpen.push(t)
    console.log(`  ${tmLocal(t.opened_at)}  OPEN ${(t.instrument || '').padEnd(10)} ${(t.side || '').padEnd(5)} entry=${t.entry_price}  status=${status}`)
  }
}
console.log(`  → opened=${realOpened}  closed=${realClosed}  open-now=${realOpen.length}  ${realW}W/${realL}L  realised=$${realRealised.toFixed(2)}`)
const killHeadroom = PROBE_KILL_USD + realRealised
console.log(`  → kill headroom: $${killHeadroom.toFixed(2)} (kill trips at $0 headroom)`)

// 2. Demo trades since probe start (to gauge what would-have-happened)
console.log('\n━━━ DEMO TRADES (probe window) ━━━')
const demos = await getJson(`${URL}/rest/v1/demo_trades?entry_time=gte.${PROBE_START_ISO}&order=entry_time.asc&limit=500&select=*`)
let demoRealised = 0
let demoOpen = 0
let demoClosed = 0
let demoW = 0
let demoL = 0
for (const d of demos) {
  if (d.exit_time) {
    demoClosed++
    const pnl = Number(d.pnl ?? 0)
    demoRealised += pnl
    if (pnl > 0) demoW++
    else if (pnl < 0) demoL++
    console.log(`  ${tmLocal(d.entry_time)} → ${tmLocal(d.exit_time)}  ${(d.instrument || '').padEnd(10)} ${(d.side || '').padEnd(5)} conf=${d.confidence ?? '?'} pnl=$${pnl.toFixed(2)}  exit=${d.exit_reason}`)
  } else {
    demoOpen++
    console.log(`  ${tmLocal(d.entry_time)}  OPEN ${(d.instrument || '').padEnd(10)} ${(d.side || '').padEnd(5)} conf=${d.confidence ?? '?'}`)
  }
}
console.log(`  → total=${demos.length}  closed=${demoClosed}  open-now=${demoOpen}  ${demoW}W/${demoL}L  realised=$${demoRealised.toFixed(2)}`)

// 3. Probe-week-kill status
console.log('\n━━━ PROBE-WEEK-KILL STATUS ━━━')
const killLogs = await getJson(`${URL}/rest/v1/agent_logs?agent=eq.probe-week-kill&order=created_at.desc&limit=5`)
if (!killLogs.length) {
  console.log('  no kill events logged — switch is ARMED')
} else {
  for (const k of killLogs) {
    console.log(`  ${tmLocal(k.created_at)} [${k.level}] ${k.message}`)
  }
}

// 4. user_settings
console.log('\n━━━ USER SETTINGS ━━━')
const us = await getJson(`${URL}/rest/v1/user_settings?select=*&limit=2`)
for (const u of us) {
  console.log(`  user ${u.user_id?.slice(0, 8)}  trading_mode=${u.trading_mode}  risk_per_trade_pct=${u.risk_per_trade_pct}  auto=${u.auto_trade_enabled}`)
}

// 5a. ALL decisions / alerts / opens in the probe window (signal funnel)
console.log('\n━━━ DECISIONS / ALERTS / OPENS (probe window) ━━━')
const sigMsgs = await getJson(`${URL}/rest/v1/war_room_messages?created_at=gte.${PROBE_START_ISO}&role=neq.close&order=created_at.desc&limit=200&select=created_at,instrument,role,agent,content,data`)
const sigArr = Array.isArray(sigMsgs) ? sigMsgs : []
console.log(`  rows: ${sigArr.length}`)
for (const w of sigArr.slice(0, 30)) {
  const tm = tmLocal(w.created_at)
  const reason = w?.data?.reason ? ` reason=${w.data.reason}` : ''
  console.log(`  ${tm} ${(w.instrument || '').padEnd(10)} [${w.role}] [${w.agent}]${reason} ${(w.content || '').slice(0, 140)}`)
}

// 5. Live-exec events (war_room_messages) during the window
console.log('\n━━━ WAR-ROOM live-exec events in probe window ━━━')
const wrLive = await getJson(`${URL}/rest/v1/war_room_messages?created_at=gte.${PROBE_START_ISO}&content=ilike.*live*&order=created_at.desc&limit=30&select=created_at,instrument,agent,role,content`)
const wrLiveArr = Array.isArray(wrLive) ? wrLive : []
if (!wrLiveArr.length) console.log('  (none — no message mentioned live exec)')
for (const w of wrLiveArr) {
  console.log(`  ${tmLocal(w.created_at)} ${(w.instrument || '').padEnd(10)} [${w.role}] ${(w.content || '').slice(0, 160)}`)
}

// 6. Reason histogram (all close events) since probe start
console.log('\n━━━ CLOSE-REASON HISTOGRAM (probe window) ━━━')
const closeMsgs = await getJson(`${URL}/rest/v1/war_room_messages?created_at=gte.${PROBE_START_ISO}&role=eq.close&select=data&limit=10000`)
const reasonHist = {}
for (const m of closeMsgs) {
  const r = m?.data?.reason || 'unset'
  reasonHist[r] = (reasonHist[r] || 0) + 1
}
const reasonRows = Object.entries(reasonHist).sort((a, b) => b[1] - a[1])
const totalCloses = closeMsgs.length
console.log(`  total closes: ${totalCloses}`)
for (const [r, n] of reasonRows.slice(0, 20)) {
  const pct = ((n / totalCloses) * 100).toFixed(1)
  console.log(`    ${r.padEnd(28)} ${String(n).padStart(5)}  (${pct}%)`)
}

// 7. AI spend during window
console.log('\n━━━ AI SPEND (probe window) ━━━')
const bt = await getJson(`${URL}/rest/v1/agent_logs?agent=eq.budget-tracker&created_at=gte.${PROBE_START_ISO}&select=created_at,metadata&order=created_at.desc&limit=10000`)
let spend = 0
const byDay = {}
for (const r of bt) {
  const day = r.created_at.slice(0, 10)
  const c = Number(r.metadata?.cost_usd || 0)
  spend += c
  byDay[day] = (byDay[day] || 0) + c
}
for (const [d, c] of Object.entries(byDay).sort()) console.log(`  ${d}  $${c.toFixed(4)}`)
console.log(`  TOTAL: $${spend.toFixed(4)} (${bt.length} ticks)`)

// 8. Errors during window
console.log('\n━━━ ERROR-LEVEL LOGS (probe window) ━━━')
const errs = await getJson(`${URL}/rest/v1/agent_logs?created_at=gte.${PROBE_START_ISO}&level=eq.error&order=created_at.desc&limit=50&select=created_at,agent,message`)
console.log(`  total errors: ${errs.length}`)
const byAgent = {}
for (const e of errs) byAgent[e.agent] = (byAgent[e.agent] || 0) + 1
for (const [a, n] of Object.entries(byAgent).sort((a, b) => b[1] - a[1])) console.log(`    ${a.padEnd(30)} ${n}`)
console.log('  Last 5:')
for (const e of errs.slice(0, 5)) console.log(`    ${tmLocal(e.created_at)} [${e.agent}] ${(e.message || '').slice(0, 140)}`)

console.log('\n=== PROBE-WEEK VERDICT ===')
const sign = realRealised >= 0 ? '+' : ''
console.log(`  REAL realised P&L  : ${sign}$${realRealised.toFixed(2)}  (${realW}W/${realL}L, ${realOpen.length} open)`)
console.log(`  DEMO realised P&L  : ${demoRealised >= 0 ? '+' : ''}$${demoRealised.toFixed(2)}  (${demoW}W/${demoL}L, ${demoOpen} open)`)
console.log(`  Kill headroom      : $${killHeadroom.toFixed(2)} of $${PROBE_KILL_USD}`)
console.log(`  AI spend           : $${spend.toFixed(2)}`)
console.log('=== DONE ===')
