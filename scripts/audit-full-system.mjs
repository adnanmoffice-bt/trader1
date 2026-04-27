#!/usr/bin/env node
// Full APEX system audit. Reads Supabase (service-role) and prints a wide
// snapshot of cron health, error patterns, table sizes, schema drift signals,
// and recent activity. Read-only.

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
if (!URL || !KEY) { console.error('missing env'); process.exit(1) }
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function q(table, qs = '') {
  // Supabase REST default 1000-row cap — pass Range to bypass.
  const r = await fetch(`${URL}/rest/v1/${table}${qs ? '?' + qs : ''}`, {
    headers: { ...headers, Range: '0-9999', 'Range-Unit': 'items' },
  })
  if (!r.ok) return { _error: `${r.status} ${await r.text().then(t => t.slice(0, 120))}` }
  return r.json()
}
async function count(table, filter = '') {
  const r = await fetch(`${URL}/rest/v1/${table}?select=id${filter ? '&' + filter : ''}`, {
    headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
  })
  return Number(r.headers.get('content-range')?.split('/')?.[1] ?? 0)
}

const tmLocal = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', hour12: false })
const HOURS = Number(process.argv[2] || 72)
const since = new Date(Date.now() - HOURS * 3600 * 1000).toISOString()
const sinceQ = `gte.${since}`

console.log(`=== FULL APEX SYSTEM AUDIT (window: ${HOURS}h) ===`)
console.log(`Cutoff: ${tmLocal(since)} (Dubai)\n`)

console.log('━━━ TABLE SIZES ━━━')
for (const t of ['portfolio', 'positions', 'trades', 'demo_trades', 'demo_sessions',
                  'signals', 'agent_logs', 'war_room_messages', 'price_history',
                  'market_data', 'user_settings', 'meta_agent_runs',
                  'performance_reviews']) {
  try {
    const n = await count(t)
    console.log(`  ${t.padEnd(22)}  rows=${n}`)
  } catch (e) { console.log(`  ${t.padEnd(22)}  ERR ${e.message}`) }
}

console.log('\n━━━ AGENT_LOGS ACTIVITY by agent (last window) ━━━')
const logs = await q('agent_logs', `created_at=${sinceQ}&order=created_at.desc&limit=5000`)
if (Array.isArray(logs)) {
  const byAgent = {}, byLevel = {}
  for (const l of logs) {
    byAgent[l.agent] = byAgent[l.agent] || { total: 0, levels: {} }
    byAgent[l.agent].total++
    byAgent[l.agent].levels[l.level] = (byAgent[l.agent].levels[l.level] || 0) + 1
    byLevel[l.level] = (byLevel[l.level] || 0) + 1
  }
  console.log(`  total=${logs.length}  byLevel=${JSON.stringify(byLevel)}`)
  const sorted = Object.entries(byAgent).sort((a, b) => b[1].total - a[1].total)
  for (const [agent, info] of sorted) {
    console.log(`  ${agent.padEnd(28)}  n=${info.total.toString().padStart(5)}  ${JSON.stringify(info.levels)}`)
  }
} else { console.log('  ERR', logs._error) }

console.log('\n━━━ ERRORS & WARNS (last window, top messages) ━━━')
const errs = await q('agent_logs', `level=in.(error,warn)&created_at=${sinceQ}&order=created_at.desc&limit=200`)
if (Array.isArray(errs)) {
  console.log(`  total error/warn rows: ${errs.length}`)
  const byMsg = {}
  for (const e of errs) {
    const key = `[${e.agent}|${e.level}] ${(e.message || '').slice(0, 100)}`
    byMsg[key] = (byMsg[key] || 0) + 1
  }
  const top = Object.entries(byMsg).sort((a, b) => b[1] - a[1]).slice(0, 25)
  for (const [k, n] of top) console.log(`  ×${n.toString().padStart(3)}  ${k}`)
} else { console.log('  ERR', errs._error) }

console.log('\n━━━ CRON HEARTBEATS (last window) ━━━')
const heartbeats = await q('agent_logs',
  `agent=in.(market-data-cron,signals-cron,positions-cron,demo-cron,polymarket-cron,meta-agent-cron,morning-briefing-cron,daily-report-cron,weekly-report-cron,seed-cron)&created_at=${sinceQ}&order=created_at.desc&limit=2000`)
if (Array.isArray(heartbeats)) {
  const byAgent = {}
  for (const h of heartbeats) {
    byAgent[h.agent] = byAgent[h.agent] || { count: 0, last: h.created_at, first: h.created_at, levels: {} }
    byAgent[h.agent].count++
    byAgent[h.agent].levels[h.level] = (byAgent[h.agent].levels[h.level] || 0) + 1
    if (h.created_at > byAgent[h.agent].last) byAgent[h.agent].last = h.created_at
    if (h.created_at < byAgent[h.agent].first) byAgent[h.agent].first = h.created_at
  }
  for (const [a, i] of Object.entries(byAgent).sort()) {
    const ageMin = Math.floor((Date.now() - new Date(i.last)) / 60000)
    console.log(`  ${a.padEnd(28)}  runs=${i.count.toString().padStart(4)}  last=${ageMin}min ago  levels=${JSON.stringify(i.levels)}`)
  }
} else { console.log('  ERR', heartbeats._error) }

console.log('\n━━━ WAR-ROOM cycles (last window) ━━━')
const wr = await q('war_room_messages', `created_at=${sinceQ}&select=meeting_id,role,agent,created_at&order=created_at.desc&limit=5000`)
if (Array.isArray(wr)) {
  const meetings = new Set(wr.map(m => m.meeting_id))
  const byRole = {}
  for (const m of wr) byRole[m.role] = (byRole[m.role] || 0) + 1
  console.log(`  total messages=${wr.length}  unique meetings=${meetings.size}  byRole=${JSON.stringify(byRole)}`)
}

console.log('\n━━━ SIGNALS / TRADES / POSITIONS (last window) ━━━')
const sigCount = await count('signals', `created_at=${sinceQ}`)
const tradesOpen = await count('trades', `opened_at=${sinceQ}`)
const tradesClosed = await count('trades', `closed_at=${sinceQ}`)
const demoOpen = await count('demo_trades', `opened_at=${sinceQ}`)
const demoClosed = await count('demo_trades', `closed_at=${sinceQ}`)
const positionsOpen = await count('positions')
console.log(`  signals=${sigCount}  live opened=${tradesOpen}  live closed=${tradesClosed}  demo opened=${demoOpen}  demo closed=${demoClosed}  open positions=${positionsOpen}`)

console.log('\n━━━ PRICE_HISTORY freshness (per symbol) ━━━')
const ph = await q('price_history', `select=symbol,timestamp&order=timestamp.desc&limit=2000`)
if (Array.isArray(ph)) {
  const lastBy = {}
  for (const r of ph) if (!lastBy[r.symbol] || r.timestamp > lastBy[r.symbol]) lastBy[r.symbol] = r.timestamp
  for (const [sym, ts] of Object.entries(lastBy).sort()) {
    const ageMin = Math.floor((Date.now() - new Date(ts)) / 60000)
    const flag = ageMin > 180 ? 'STALE' : 'ok'
    console.log(`  [${flag.padEnd(5)}] ${sym.padEnd(11)} last=${tmLocal(ts)}  age=${ageMin}min`)
  }
}

console.log('\n━━━ MARKET_DATA freshness ━━━')
const md = await q('market_data', `select=symbol,price,fetched_at,source&order=fetched_at.desc`)
if (Array.isArray(md)) {
  for (const r of md) {
    const ageMin = Math.floor((Date.now() - new Date(r.fetched_at)) / 60000)
    const flag = ageMin > 10 ? 'STALE' : 'ok'
    console.log(`  [${flag.padEnd(5)}] ${r.symbol.padEnd(11)} $${r.price}  src=${r.source}  ${ageMin}min ago`)
  }
}

console.log('\n━━━ META_AGENT runs (last window) ━━━')
const meta = await q('meta_agent_runs', `created_at=${sinceQ}&order=created_at.desc&limit=20`)
if (Array.isArray(meta)) {
  console.log(`  count=${meta.length}`)
  for (const m of meta.slice(0, 5)) console.log(`  ${tmLocal(m.created_at)}  ${m.run_type}  ${m.summary?.slice(0, 80)}`)
}

console.log('\n━━━ USER_SETTINGS (current) ━━━')
const us = await q('user_settings', 'select=*')
if (Array.isArray(us)) {
  for (const s of us) {
    console.log(`  user=${s.user_id}  mode=${s.trading_mode}  auto=${s.auto_trade_enabled}  dailyLossPct=${s.daily_loss_limit_pct}  maxDDpct=${s.max_drawdown_pct}  riskPerTrade=${s.risk_per_trade_pct}  maxPos=${s.max_positions}  curr=${s.currency}  initCap=${s.initial_capital}  notif=${s.notifications_enabled}  binanceKey=${s.binance_api_key ? 'SET' : 'MISSING'}  telegramTok=${s.telegram_bot_token ? 'SET' : 'MISSING'}`)
  }
}

console.log('\n=== AUDIT DONE ===')
