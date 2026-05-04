#!/usr/bin/env node
// Triage: 138 closed trades / -$6,421 USD — separate historical vs current.
// Group by instrument, by trigger, by exit cause, by session, by month.

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
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function fetchAll(table, query) {
  const all = []
  let offset = 0
  while (true) {
    const url = `${URL_}/rest/v1/${table}?${query}&limit=1000&offset=${offset}`
    const r = await fetch(url, { headers })
    if (!r.ok) { console.error('Fetch failed', r.status, await r.text()); break }
    const rows = await r.json()
    if (!Array.isArray(rows) || rows.length === 0) break
    all.push(...rows)
    if (rows.length < 1000) break
    offset += 1000
  }
  return all
}

function fmt(n, dp = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  const sign = n >= 0 ? '+' : ''
  return sign + Number(n).toFixed(dp)
}
function groupBy(rows, keyFn) {
  const m = new Map()
  for (const r of rows) {
    const k = keyFn(r) ?? 'unknown'
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(r)
  }
  return m
}
function summarise(rows, label) {
  if (!rows.length) return null
  const n = rows.length
  const wins = rows.filter(r => +r.pnl > 0).length
  const losses = rows.filter(r => +r.pnl <= 0).length
  const totalPnl = rows.reduce((s, r) => s + (+r.pnl || 0), 0)
  const avgPnl = totalPnl / n
  const wr = wins / n * 100
  const avgWin = wins ? rows.filter(r => +r.pnl > 0).reduce((s, r) => s + +r.pnl, 0) / wins : 0
  const avgLoss = losses ? rows.filter(r => +r.pnl <= 0).reduce((s, r) => s + +r.pnl, 0) / losses : 0
  return { label, n, wr, totalPnl, avgPnl, avgWin, avgLoss, wins, losses }
}
function printTable(items, headerLabel) {
  console.log(`\n━━━ ${headerLabel} ━━━`)
  console.log('Group                     n     WR%     Total $    Avg $/trade   Avg win    Avg loss')
  console.log('---------------------------------------------------------------------------------------')
  items.filter(Boolean).sort((a, b) => a.totalPnl - b.totalPnl).forEach(it => {
    console.log(
      `${String(it.label).padEnd(24)} ${String(it.n).padStart(4)}  ${it.wr.toFixed(1).padStart(5)}%  ${fmt(it.totalPnl).padStart(8)}    ${fmt(it.avgPnl).padStart(8)}      ${fmt(it.avgWin).padStart(7)}    ${fmt(it.avgLoss).padStart(7)}`,
    )
  })
}
// Mirror the dashboard's extractStrategy()
function triggerKey(t) {
  const r = String(t.signal_reason ?? '').toUpperCase()
  if (r.includes('BB_SQUEEZE') || r.includes('BB SQUEEZE')) return 'BB_SQUEEZE'
  if (r.includes('EMA_CROSS') || r.includes('EMA 12/26')) return 'EMA_CROSS'
  if (r.includes('EMA 50')) return 'EMA50'
  if (r.includes('MACD')) return 'MACD'
  if (r.includes('TECH_SCORE') || r.includes('TECH SCORE') || r.includes('TECH:')) return 'TECH_SCORE'
  if (r.includes('RSI')) return 'RSI'
  if (r.includes('VOLUME')) return 'VOLUME'
  if (r.includes('WAR ROOM') || r.includes('CONSENSUS')) return 'WAR_ROOM'
  return 'OTHER'
}

async function main() {
  const allTrades = await fetchAll('demo_trades', 'order=entry_time.desc&select=instrument,direction,signal_reason,entry_price,stop_loss,take_profit,exit_price,exit_reason,pnl,quantity,confidence,entry_time,exit_time,session_id')
  const trades = allTrades.filter(t => t.exit_time)
  if (!trades.length) { console.log('No closed trades. Total fetched:', allTrades.length); return }

  const total = trades.reduce((s, t) => s + (+t.pnl || 0), 0)
  const wins = trades.filter(t => +t.pnl > 0)
  const losses = trades.filter(t => +t.pnl <= 0)

  // Sort entries chronologically for first/last
  const sorted = [...trades].sort((a, b) => new Date(a.entry_time) - new Date(b.entry_time))

  console.log(`\nALL CLOSED DEMO TRADES — n=${trades.length}, P&L = ${fmt(total)} USD`)
  console.log(`  WR ${(wins.length/trades.length*100).toFixed(1)}%   wins ${wins.length}   losses ${losses.length}`)
  console.log(`  Avg win ${fmt(wins.reduce((s,t)=>s+ +t.pnl,0)/Math.max(1,wins.length))}   Avg loss ${fmt(losses.reduce((s,t)=>s+ +t.pnl,0)/Math.max(1,losses.length))}`)
  console.log(`  Date range: ${sorted[0]?.entry_time?.slice(0,10)} → ${sorted.at(-1)?.entry_time?.slice(0,10)}`)

  printTable([...groupBy(trades, t => t.instrument).entries()].map(([k, v]) => summarise(v, k)), 'BY INSTRUMENT (all-time)')
  printTable([...groupBy(trades, triggerKey).entries()].map(([k, v]) => summarise(v, k)), 'BY TRIGGER (all-time)')
  printTable([...groupBy(trades, t => t.exit_reason ?? 'unknown').entries()].map(([k, v]) => summarise(v, k)), 'BY EXIT REASON (all-time)')
  printTable([...groupBy(trades, t => String(t.entry_time ?? '').slice(0, 7)).entries()].map(([k, v]) => summarise(v, k)), 'BY MONTH')

  // ── Last 14 days ──
  const cutoff14 = Date.now() - 14 * 86400_000
  const recent = trades.filter(t => new Date(t.entry_time).getTime() >= cutoff14)
  if (recent.length) {
    const r = summarise(recent, `LAST 14 DAYS (${recent.length} trades)`)
    console.log(`\n━━━ LAST 14 DAYS — RECENT WINDOW ━━━`)
    console.log(`  ${r.label}   WR ${r.wr.toFixed(1)}%   Total ${fmt(r.totalPnl)}   Avg ${fmt(r.avgPnl)}/trade`)
    printTable([...groupBy(recent, t => t.instrument).entries()].map(([k, v]) => summarise(v, k)), 'last 14d BY INSTRUMENT')
    printTable([...groupBy(recent, triggerKey).entries()].map(([k, v]) => summarise(v, k)), 'last 14d BY TRIGGER')
    printTable([...groupBy(recent, t => t.exit_reason ?? 'unknown').entries()].map(([k, v]) => summarise(v, k)), 'last 14d BY EXIT REASON')
  } else {
    console.log('\nLast 14d: no closed trades.')
  }

  // ── Last 30 days ──
  const cutoff30 = Date.now() - 30 * 86400_000
  const last30 = trades.filter(t => new Date(t.entry_time).getTime() >= cutoff30)
  if (last30.length) {
    const r = summarise(last30, `LAST 30 DAYS (${last30.length} trades)`)
    console.log(`\nLAST 30 DAYS  WR ${r.wr.toFixed(1)}%  Total ${fmt(r.totalPnl)}  Avg ${fmt(r.avgPnl)}/trade`)
    printTable([...groupBy(last30, t => t.instrument).entries()].map(([k, v]) => summarise(v, k)), 'last 30d BY INSTRUMENT')
  }

  // ── Pre vs post 2026-04-17 (= when SOL/BNB stopped) ──
  const cut = new Date('2026-04-17').getTime()
  const pre = trades.filter(t => new Date(t.entry_time).getTime() < cut)
  const post = trades.filter(t => new Date(t.entry_time).getTime() >= cut)
  console.log(`\n━━━ PRE vs POST 2026-04-17 (SOL/BNB cutoff) ━━━`)
  if (pre.length) { const r = summarise(pre, 'pre-cutoff'); console.log(`  pre  : n=${r.n}  WR ${r.wr.toFixed(1)}%  Total ${fmt(r.totalPnl)}  Avg ${fmt(r.avgPnl)}/trade`) }
  if (post.length) { const r = summarise(post, 'post-cutoff'); console.log(`  post : n=${r.n}  WR ${r.wr.toFixed(1)}%  Total ${fmt(r.totalPnl)}  Avg ${fmt(r.avgPnl)}/trade`) }

  console.log('\n[end]')
}

main().catch(e => { console.error(e); process.exit(1) })
