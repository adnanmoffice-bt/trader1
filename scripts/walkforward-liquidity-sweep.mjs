#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// PHASE D — Walk-forward out-of-sample validation of liquidity-sweep trigger
//
// 180d sweep finds best params (lookback=40, SL=2.5, TP=2.0, confirm=true) at
// +0.154 R/trade. Critical question: is this curve-fit, or genuine edge?
//
// This script:
//   1. Pulls 180 days of 1H candles
//   2. Splits 60/40: first 108 days = train, last 72 days = test
//   3. Re-runs the full parameter sweep on the TRAIN portion only
//   4. Picks the best train-set params
//   5. Reports OUT-OF-SAMPLE expectancy of those params on the TEST portion
//
// Pass criteria:
//   - Test-set expectancy >= 50% of train-set expectancy
//   - Test-set N >= 100 trades (not data-starved)
//   - Test-set WR >= 50% (long-run sustainable)
// ─────────────────────────────────────────────────────────────────────────────

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

const DAYS = 180
const SPLIT = 0.6  // 60% train, 40% test
const INSTRUMENTS = ['BTC/USD', 'ETH/USD', 'XAU/USD', 'DOGE/USD', 'AVAX/USD', 'LINK/USD', 'ADA/USD', 'DOT/USD', 'MATIC/USD', 'NEAR/USD', 'APT/USD']

async function fetchCandles(symbol, sinceIso) {
  const all = []
  let offset = 0
  while (true) {
    const url = `${URL_}/rest/v1/price_history?symbol=eq.${encodeURIComponent(symbol)}&interval=eq.1h&timestamp=gte.${sinceIso}&order=timestamp.asc&limit=1000&offset=${offset}&select=timestamp,open,high,low,close,volume`
    const r = await fetch(url, { headers })
    const rows = await r.json()
    if (!Array.isArray(rows) || rows.length === 0) break
    all.push(...rows)
    if (rows.length < 1000) break
    offset += 1000
  }
  return all
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
  if (!trades.length) return { n: 0, wr: 0, expR: 0, totalR: 0 }
  return { n: trades.length, wr: trades.filter(t => t.r > 0).length / trades.length, expR: trades.reduce((s, t) => s + t.r, 0) / trades.length, totalR: trades.reduce((s, t) => s + t.r, 0) }
}

async function main() {
  const since = new Date(Date.now() - DAYS * 86400_000).toISOString()
  const all = {}
  for (const sym of INSTRUMENTS) {
    const data = await fetchCandles(sym, since)
    if (!data || data.length < 200) continue
    all[sym] = data.map(x => ({ open: +x.open, high: +x.high, low: +x.low, close: +x.close, volume: +x.volume }))
  }

  // Split each symbol into train/test
  const train = {}
  const test = {}
  for (const sym of Object.keys(all)) {
    const c = all[sym]
    const splitIdx = Math.floor(c.length * SPLIT)
    train[sym] = c.slice(0, splitIdx)
    test[sym] = c.slice(splitIdx)
  }
  const trainCandles = Object.values(train).reduce((s, c) => s + c.length, 0)
  const testCandles = Object.values(test).reduce((s, c) => s + c.length, 0)
  console.log(`\n${DAYS}d data, split ${(SPLIT*100).toFixed(0)}/${((1-SPLIT)*100).toFixed(0)}`)
  console.log(`  Train: ${trainCandles} candles  |  Test: ${testCandles} candles`)
  console.log(`  Train period: oldest 60% of data  |  Test period: most recent 40%\n`)

  // ── Sweep on TRAIN only ──
  const lookbacks = [10, 20, 40]
  const slMults = [1.5, 2.0, 2.5]
  const tpMults = [1.5, 2.0, 3.0, 4.0]
  const confirmModes = [false, true]
  const trainRows = []
  for (const lb of lookbacks) for (const sl of slMults) for (const tp of tpMults) for (const cf of confirmModes) {
    const trades = []
    for (const sym of Object.keys(train)) {
      const c = train[sym]
      const atr = atrSeries(c, 14)
      const t = detectSweeps(c, lb, cf)
      trades.push(...simulate(c, atr, t, sl, tp))
    }
    const s = summarise(trades)
    trainRows.push({ lb, sl, tp, cf, ...s })
  }
  trainRows.sort((a, b) => b.expR - a.expR)
  const top5train = trainRows.filter(r => r.n >= 100).slice(0, 5)

  console.log('━━━ TOP 5 PARAMS ON TRAIN SET (≥100 trades) ━━━')
  console.log('Lookback  SL    TP    Confirm   N     WR       Exp/R     Total R')
  console.log('-----------------------------------------------------------------')
  for (const r of top5train) {
    const wr = (r.wr * 100).toFixed(1) + '%'
    const exp = (r.expR >= 0 ? '+' : '') + r.expR.toFixed(3)
    const tot = (r.totalR >= 0 ? '+' : '') + r.totalR.toFixed(1)
    console.log(`${String(r.lb).padStart(8)}   ${r.sl.toFixed(1)}   ${r.tp.toFixed(1)}   ${r.cf ? 'YES' : 'no '}     ${String(r.n).padStart(4)}  ${wr.padStart(6)}    ${exp.padStart(7)}   ${tot.padStart(8)}`)
  }

  // ── Re-run those same params on TEST set ──
  console.log('\n━━━ OUT-OF-SAMPLE TEST RESULTS (same params, unseen data) ━━━')
  console.log('Lookback  SL    TP    Confirm   N     WR       Exp/R     Total R   Δ vs Train')
  console.log('--------------------------------------------------------------------------------')
  for (const r of top5train) {
    const trades = []
    for (const sym of Object.keys(test)) {
      const c = test[sym]
      const atr = atrSeries(c, 14)
      const t = detectSweeps(c, r.lb, r.cf)
      trades.push(...simulate(c, atr, t, r.sl, r.tp))
    }
    const s = summarise(trades)
    const wr = (s.wr * 100).toFixed(1) + '%'
    const exp = (s.expR >= 0 ? '+' : '') + s.expR.toFixed(3)
    const tot = (s.totalR >= 0 ? '+' : '') + s.totalR.toFixed(1)
    const delta = (s.expR - r.expR >= 0 ? '+' : '') + (s.expR - r.expR).toFixed(3)
    console.log(`${String(r.lb).padStart(8)}   ${r.sl.toFixed(1)}   ${r.tp.toFixed(1)}   ${r.cf ? 'YES' : 'no '}     ${String(s.n).padStart(4)}  ${wr.padStart(6)}    ${exp.padStart(7)}   ${tot.padStart(8)}    ${delta.padStart(8)}`)
  }

  // ── Verdict: is the edge real on out-of-sample? ──
  const top1 = top5train[0]
  const oosTrades = []
  for (const sym of Object.keys(test)) {
    const c = test[sym]
    const atr = atrSeries(c, 14)
    const t = detectSweeps(c, top1.lb, top1.cf)
    oosTrades.push(...simulate(c, atr, t, top1.sl, top1.tp))
  }
  const oos = summarise(oosTrades)
  console.log('\n━━━ FINAL VERDICT — best train param (lookback=' + top1.lb + ', SL=' + top1.sl + ', TP=' + top1.tp + ', confirm=' + top1.cf + ') ━━━')
  console.log(`  Train Exp/R:        ${top1.expR >= 0 ? '+' : ''}${top1.expR.toFixed(3)}  (n=${top1.n}, WR=${(top1.wr*100).toFixed(1)}%)`)
  console.log(`  Test  Exp/R (OOS):  ${oos.expR >= 0 ? '+' : ''}${oos.expR.toFixed(3)}  (n=${oos.n}, WR=${(oos.wr*100).toFixed(1)}%)`)
  const ratio = top1.expR === 0 ? 0 : oos.expR / top1.expR
  const verdict = oos.expR > 0.05 && oos.wr > 0.50 && ratio > 0.5
    ? 'PASS — out-of-sample retains > 50% of in-sample edge AND >0.05 R/trade AND >50% WR'
    : oos.expR > 0
      ? 'WEAK — positive OOS but degraded materially vs train. Consider walk-forward retraining cadence.'
      : 'FAIL — OOS expectancy turned negative. Likely overfit; do not deploy these params.'
  console.log(`  Train→Test ratio:   ${(ratio * 100).toFixed(0)}%`)
  console.log(`  Verdict:            ${verdict}`)

  console.log('\n[end]')
}

main().catch(e => { console.error(e); process.exit(1) })
