#!/usr/bin/env node
// Phase D — last-chance per-instrument 5-fold WF on liquidity-sweep
// (fixed params lb=40, sl=2.5, tp=4.0, confirm=YES, no per-fold reopt).
// If any single instrument retains real OOS edge across folds, that is a
// candidate for an instrument-specific demo-only trigger.

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
if (!URL_ || !KEY) { console.error('Missing Supabase env'); process.exit(1) }
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }

const INSTRUMENTS = ['BTC/USD', 'ETH/USD', 'DOGE/USD', 'AVAX/USD', 'LINK/USD', 'ADA/USD', 'DOT/USD', 'MATIC/USD', 'NEAR/USD', 'APT/USD']
const FIXED = { lb: 40, sl: 2.5, tp: 4.0, cf: true }

async function fetchCandles(symbol, sinceIso, untilIso) {
  const all = []
  let offset = 0
  while (true) {
    const url = `${URL_}/rest/v1/price_history?symbol=eq.${encodeURIComponent(symbol)}&interval=eq.1h&timestamp=gte.${sinceIso}&timestamp=lt.${untilIso}&order=timestamp.asc&limit=1000&offset=${offset}&select=timestamp,open,high,low,close,volume`
    const r = await fetch(url, { headers })
    const rows = await r.json()
    if (!Array.isArray(rows) || rows.length === 0) break
    all.push(...rows)
    if (rows.length < 1000) break
    offset += 1000
  }
  return all.map(x => ({ open: +x.open, high: +x.high, low: +x.low, close: +x.close, volume: +x.volume }))
}

function atrSeries(c, p = 14) {
  const tr = []
  for (let i = 0; i < c.length; i++) {
    if (i === 0) { tr.push(c[i].high - c[i].low); continue }
    tr.push(Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)))
  }
  const out = new Array(c.length).fill(0)
  let s = 0
  for (let i = 0; i < c.length; i++) {
    s += tr[i]
    if (i >= p) s -= tr[i - p]
    out[i] = i < p - 1 ? tr[i] : s / p
  }
  return out
}

function detectSweeps(c, lookback, requireConfirm) {
  const out = []
  for (let i = lookback + 1; i < c.length; i++) {
    const prior = c.slice(i - lookback, i)
    const recentHigh = Math.max(...prior.map(x => x.high))
    const recentLow = Math.min(...prior.map(x => x.low))
    const range = c[i].high - c[i].low
    if (range <= 0) continue
    if (c[i].high > recentHigh && c[i].close < recentHigh) {
      const reentryPct = (c[i].high - c[i].close) / range
      if (!requireConfirm || reentryPct >= 0.25) out.push({ idx: i, dir: 'short' })
    }
    if (c[i].low < recentLow && c[i].close > recentLow) {
      const reentryPct = (c[i].close - c[i].low) / range
      if (!requireConfirm || reentryPct >= 0.25) out.push({ idx: i, dir: 'long' })
    }
  }
  return out
}

function simulate(c, atr, triggers, slMult, tpMult, maxHold = 48) {
  const trades = []
  for (const t of triggers) {
    if (t.idx >= c.length - 1) continue
    if (atr[t.idx] === 0) continue
    const entry = c[t.idx].close
    const a = atr[t.idx]
    const sl = t.dir === 'long' ? entry - slMult * a : entry + slMult * a
    const tp = t.dir === 'long' ? entry + tpMult * a : entry - tpMult * a
    let outcome = null
    for (let j = t.idx + 1; j < Math.min(c.length, t.idx + 1 + maxHold); j++) {
      if (t.dir === 'long') {
        if (c[j].low <= sl) { outcome = -1; break }
        if (c[j].high >= tp) { outcome = tpMult / slMult; break }
      } else {
        if (c[j].high >= sl) { outcome = -1; break }
        if (c[j].low <= tp) { outcome = tpMult / slMult; break }
      }
    }
    if (outcome === null) {
      const exit = c[Math.min(c.length - 1, t.idx + maxHold)].close
      const r = t.dir === 'long' ? (exit - entry) / (entry - sl) : (entry - exit) / (sl - entry)
      outcome = r
    }
    trades.push({ r: outcome })
  }
  return trades
}
function summarise(trades) {
  if (!trades.length) return { n: 0, wr: 0, expR: 0 }
  return { n: trades.length, wr: trades.filter(t => t.r > 0).length / trades.length, expR: trades.reduce((s, t) => s + t.r, 0) / trades.length }
}
function median(arr) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

async function main() {
  const totalDays = 365
  const minTrainDays = 65
  const testDays = 60
  const folds = []
  for (let f = 0; f < 5; f++) {
    folds.push({
      testStart: minTrainDays + f * testDays,
      testEnd: minTrainDays + (f + 1) * testDays,
    })
  }
  const now = Date.now()
  const dayMs = 86400_000
  const dayBack = (d) => new Date(now - (totalDays - d) * dayMs).toISOString()

  console.log('\nPer-instrument 5-fold WF — fixed params lb=40 sl=2.5 tp=4.0 confirm=YES')
  console.log('Pass criteria per instrument: median OOS Exp/R >= +0.05 AND >=3/5 folds positive AND mean WR > 48%\n')

  const results = []
  for (const sym of INSTRUMENTS) {
    const oosByFold = []
    for (const f of folds) {
      const c = await fetchCandles(sym, dayBack(f.testStart), dayBack(f.testEnd))
      const atr = atrSeries(c, 14)
      const t = detectSweeps(c, FIXED.lb, FIXED.cf)
      oosByFold.push(summarise(simulate(c, atr, t, FIXED.sl, FIXED.tp)))
    }
    const med = median(oosByFold.map(x => x.expR))
    const mean = oosByFold.reduce((s, x) => s + x.expR, 0) / oosByFold.length
    const wr = oosByFold.reduce((s, x) => s + x.wr, 0) / oosByFold.length
    const pos = oosByFold.filter(x => x.expR > 0).length
    const totN = oosByFold.reduce((s, x) => s + x.n, 0)
    results.push({ sym, med, mean, wr, pos, totN, oosByFold })
  }
  results.sort((a, b) => b.med - a.med)
  console.log('Symbol         Med Exp/R  Mean Exp/R  Pos folds   Mean WR   Total n   F1     F2     F3     F4     F5')
  console.log('-------------------------------------------------------------------------------------------------------')
  const passing = []
  for (const r of results) {
    const m = (r.med >= 0 ? '+' : '') + r.med.toFixed(3)
    const mn = (r.mean >= 0 ? '+' : '') + r.mean.toFixed(3)
    const folds_ = r.oosByFold.map(x => (x.expR >= 0 ? '+' : '') + x.expR.toFixed(2)).map(s => s.padStart(6)).join(' ')
    console.log(`${r.sym.padEnd(15)}${m.padStart(8)}   ${mn.padStart(8)}    ${r.pos}/5         ${(r.wr*100).toFixed(1).padStart(4)}%    ${String(r.totN).padStart(5)}   ${folds_}`)
    if (r.med >= 0.05 && r.pos >= 3 && r.wr > 0.48) passing.push(r.sym)
  }
  console.log('\n━━━ INSTRUMENTS THAT PASS ━━━')
  console.log(passing.length === 0 ? '(none)' : passing.join(', '))
  console.log('\n[end]')
}

main().catch(e => { console.error(e); process.exit(1) })
