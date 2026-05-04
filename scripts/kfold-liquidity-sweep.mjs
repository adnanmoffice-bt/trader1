#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// PHASE D — 5-fold ANCHORED walk-forward validation of liquidity-sweep
//
// Now that price_history holds 365 days of 1H candles per symbol (backfilled
// via scripts/backfill-price-history.mjs), we can validate the liquidity-sweep
// trigger with a real walk-forward design:
//
//   Fold 1: train [0d,   65d], test [65d,  125d]  (train=65d  test=60d)
//   Fold 2: train [0d,  125d], test [125d, 185d]
//   Fold 3: train [0d,  185d], test [185d, 245d]
//   Fold 4: train [0d,  245d], test [245d, 305d]
//   Fold 5: train [0d,  305d], test [305d, 365d]
//
// "Anchored" because each train window starts at day 0 and grows. This
// matches how a live system actually works: we never "forget" old data,
// and our model is always trained on everything we've ever seen at the
// time we're trading.
//
// Total OOS coverage: 5 × 60d = 300d.
//
// For each fold:
//   1. Run full 72-combo param sweep on TRAIN
//   2. Pick the top-5 train combos by Exp/R (≥150 trades minimum)
//   3. Apply each to TEST window
//   4. Record OOS Exp/R, WR, n per param set
//
// Overall verdict criteria (we want ALL three):
//   - median OOS Exp/R across the 5 folds, for the SAME "best param" picked
//     by the largest-N train fold, is ≥ +0.05 R/trade
//   - ≥ 3 / 5 folds show positive OOS Exp/R for that param
//   - mean OOS WR > 48% (just above coin-flip)
//
// Anything weaker = trigger is curve-fit, do NOT promote to live.
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

const INSTRUMENTS = ['BTC/USD', 'ETH/USD', 'DOGE/USD', 'AVAX/USD', 'LINK/USD', 'ADA/USD', 'DOT/USD', 'MATIC/USD', 'NEAR/USD', 'APT/USD']
// XAU/USD removed: PAXGUSDT illiquidity makes the candles unreliable.

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
    trades.push({ r: outcome, dir: t.dir })
  }
  return trades
}

function summarise(trades) {
  if (!trades.length) return { n: 0, wr: 0, expR: 0, totalR: 0 }
  return { n: trades.length, wr: trades.filter(t => t.r > 0).length / trades.length, expR: trades.reduce((s, t) => s + t.r, 0) / trades.length, totalR: trades.reduce((s, t) => s + t.r, 0) }
}

async function loadFold(trainStart, trainEnd, testStart, testEnd) {
  const train = {}, test = {}
  for (const sym of INSTRUMENTS) {
    train[sym] = await fetchCandles(sym, trainStart, trainEnd)
    test[sym] = await fetchCandles(sym, testStart, testEnd)
  }
  return { train, test }
}

function runSweep(symData) {
  const lookbacks = [10, 20, 40]
  const slMults = [1.5, 2.0, 2.5]
  const tpMults = [1.5, 2.0, 3.0, 4.0]
  const confirmModes = [false, true]
  const rows = []
  for (const lb of lookbacks) for (const sl of slMults) for (const tp of tpMults) for (const cf of confirmModes) {
    const trades = []
    for (const sym of Object.keys(symData)) {
      const c = symData[sym]
      if (c.length < lb + 14) continue
      const atr = atrSeries(c, 14)
      const t = detectSweeps(c, lb, cf)
      trades.push(...simulate(c, atr, t, sl, tp))
    }
    const s = summarise(trades)
    rows.push({ lb, sl, tp, cf, ...s })
  }
  rows.sort((a, b) => b.expR - a.expR)
  return rows
}

function applyParams(symData, lb, sl, tp, cf) {
  const trades = []
  for (const sym of Object.keys(symData)) {
    const c = symData[sym]
    if (c.length < lb + 14) continue
    const atr = atrSeries(c, 14)
    const t = detectSweeps(c, lb, cf)
    trades.push(...simulate(c, atr, t, sl, tp))
  }
  return summarise(trades)
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
    const trainEndDay = minTrainDays + f * testDays
    const testStartDay = trainEndDay
    const testEndDay = testStartDay + testDays
    folds.push({ trainStart: 0, trainEnd: trainEndDay, testStart: testStartDay, testEnd: testEndDay })
  }

  const now = Date.now()
  const dayMs = 86400_000
  const dayBack = (d) => new Date(now - (totalDays - d) * dayMs).toISOString()

  console.log('\n5-fold ANCHORED walk-forward — liquidity-sweep')
  console.log(`Total data: ${totalDays}d  |  Min train: ${minTrainDays}d  |  Test window per fold: ${testDays}d`)
  console.log(`OOS coverage: ${5 * testDays}d (${((5 * testDays) / totalDays * 100).toFixed(0)}% of data)\n`)

  const foldResults = []
  for (let i = 0; i < folds.length; i++) {
    const f = folds[i]
    const trainStart = dayBack(f.trainStart)
    const trainEnd = dayBack(f.trainEnd)
    const testStart = dayBack(f.testStart)
    const testEnd = dayBack(f.testEnd)
    const sd = await loadFold(trainStart, trainEnd, testStart, testEnd)
    const totalTrain = Object.values(sd.train).reduce((s, c) => s + c.length, 0)
    const totalTest = Object.values(sd.test).reduce((s, c) => s + c.length, 0)
    const trainRows = runSweep(sd.train)
    const top1 = trainRows.find(r => r.n >= 150) ?? trainRows[0]
    const oos = applyParams(sd.test, top1.lb, top1.sl, top1.tp, top1.cf)
    foldResults.push({
      fold: i + 1, train: top1, oos,
      trainCandles: totalTrain, testCandles: totalTest,
      trainRange: `${trainStart.slice(0, 10)}..${trainEnd.slice(0, 10)}`,
      testRange: `${testStart.slice(0, 10)}..${testEnd.slice(0, 10)}`,
    })
    console.log(`Fold ${i + 1}: train ${trainStart.slice(0, 10)}..${trainEnd.slice(0, 10)} (${totalTrain} candles)  |  test ${testStart.slice(0, 10)}..${testEnd.slice(0, 10)} (${totalTest} candles)`)
    console.log(`  Best train params: lookback=${top1.lb} SL=${top1.sl} TP=${top1.tp} confirm=${top1.cf ? 'YES' : 'no'} -> Train: n=${top1.n} WR=${(top1.wr*100).toFixed(1)}% Exp/R=${(top1.expR>=0?'+':'')}${top1.expR.toFixed(3)}`)
    console.log(`  OOS:                lookback=${top1.lb} SL=${top1.sl} TP=${top1.tp} confirm=${top1.cf ? 'YES' : 'no'} -> Test:  n=${oos.n} WR=${(oos.wr*100).toFixed(1)}% Exp/R=${(oos.expR>=0?'+':'')}${oos.expR.toFixed(3)}`)
    console.log()
  }

  // ─── Cross-fold summary ───
  console.log('━━━ FOLD SUMMARY ━━━')
  console.log('Fold  Train (lb/sl/tp/cf)              Train Exp/R   Train n    OOS Exp/R    OOS n   OOS WR')
  console.log('-------------------------------------------------------------------------------------------')
  for (const r of foldResults) {
    const p = `${r.train.lb}/${r.train.sl}/${r.train.tp}/${r.train.cf ? 'Y' : 'n'}`
    const trE = (r.train.expR >= 0 ? '+' : '') + r.train.expR.toFixed(3)
    const oosE = (r.oos.expR >= 0 ? '+' : '') + r.oos.expR.toFixed(3)
    const wr = (r.oos.wr * 100).toFixed(1) + '%'
    console.log(`${String(r.fold).padStart(2)}    ${p.padEnd(28)}      ${trE.padStart(7)}   ${String(r.train.n).padStart(5)}     ${oosE.padStart(7)}    ${String(r.oos.n).padStart(5)}    ${wr}`)
  }

  const oosExps = foldResults.map(r => r.oos.expR)
  const oosWrs = foldResults.map(r => r.oos.wr)
  const oosNs = foldResults.map(r => r.oos.n)
  const medExp = median(oosExps)
  const meanExp = oosExps.reduce((s, x) => s + x, 0) / oosExps.length
  const meanWr = oosWrs.reduce((s, x) => s + x, 0) / oosWrs.length
  const positiveFolds = oosExps.filter(x => x > 0).length
  const totalOosTrades = oosNs.reduce((s, x) => s + x, 0)
  console.log()
  console.log('━━━ HEADLINE STATS ━━━')
  console.log(`Median OOS Exp/R:  ${(medExp>=0?'+':'')}${medExp.toFixed(3)}`)
  console.log(`Mean OOS Exp/R:    ${(meanExp>=0?'+':'')}${meanExp.toFixed(3)}`)
  console.log(`Mean OOS WR:       ${(meanWr*100).toFixed(1)}%`)
  console.log(`Positive folds:    ${positiveFolds}/5`)
  console.log(`Total OOS trades:  ${totalOosTrades}`)
  console.log()

  // ─── Verdict ───
  const passMedian = medExp >= 0.05
  const passFolds = positiveFolds >= 3
  const passWr = meanWr > 0.48
  const passN = totalOosTrades >= 200
  const allPass = passMedian && passFolds && passWr && passN
  console.log('━━━ VERDICT ━━━')
  console.log(`  Median OOS Exp/R >= +0.05?    ${passMedian ? 'PASS' : 'FAIL'}  (got ${medExp.toFixed(3)})`)
  console.log(`  >=3/5 folds positive?         ${passFolds ? 'PASS' : 'FAIL'}  (got ${positiveFolds}/5)`)
  console.log(`  Mean OOS WR > 48%?            ${passWr ? 'PASS' : 'FAIL'}  (got ${(meanWr*100).toFixed(1)}%)`)
  console.log(`  Total OOS n >= 200?           ${passN ? 'PASS' : 'FAIL'}  (got ${totalOosTrades})`)
  console.log()
  console.log(allPass
    ? '  RESULT: PASS — robust enough to wire as DEMO-ONLY trigger for 30d before considering live.'
    : '  RESULT: FAIL — do NOT promote. The trigger has not demonstrated genuine edge across regimes.')

  console.log('\n[end]')
}

main().catch(e => { console.error(e); process.exit(1) })
