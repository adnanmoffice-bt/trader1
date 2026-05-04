#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// PHASE D — Variant 5-fold walk-forward: try filters / restrictions on top of
// the base liquidity-sweep trigger to find a configuration that survives OOS.
//
// kfold-liquidity-sweep.mjs verdict: vanilla sweep median OOS +0.029 (FAIL).
// Variants tested here, all on 365d real data, 5-fold anchored walk-forward:
//
//   V0  baseline             liquidity-sweep, all instruments
//   V1  CHOCH-inversion      sweep + veto if recent CHOCH points opposite
//   V2  trend-aligned        sweep-of-low only in 1H uptrend; sweep-of-high
//                            only in 1H downtrend (200-EMA filter)
//   V3  counter-trend        opposite of V2 (mean-reversion bias)
//   V4  top-5 instruments    AVAX, MATIC, NEAR, BTC, DOGE only
//   V5  top-3 instruments    AVAX, MATIC, NEAR only
//   V6  ATR band             only when ATR-pct of price in [0.5%, 3.5%]
//   V7  V1+V4 combo          CHOCH inversion AND top-5 instruments
//
// Variant fixed-param choice: from the V0 fold-1 train we pick the most
// "regularised" param set (lookback=40, SL=2.5, TP=4.0, confirm=YES) — this
// was the only OOS-stable point in the previous (47d) walk-forward and is a
// reasonable a-priori choice that we will NOT re-optimise per fold (avoids
// the curve-fit problem we saw on V0).
//
// Pass criteria identical to kfold-liquidity-sweep.mjs:
//   - median OOS Exp/R >= +0.05
//   - >= 3/5 folds positive
//   - mean OOS WR > 48%
//   - total OOS n >= 200
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

const ALL_INSTRUMENTS = ['BTC/USD', 'ETH/USD', 'DOGE/USD', 'AVAX/USD', 'LINK/USD', 'ADA/USD', 'DOT/USD', 'MATIC/USD', 'NEAR/USD', 'APT/USD']
const TOP5 = ['AVAX/USD', 'MATIC/USD', 'NEAR/USD', 'BTC/USD', 'DOGE/USD']
const TOP3 = ['AVAX/USD', 'MATIC/USD', 'NEAR/USD']

// Fixed params (no per-fold re-optimisation).
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

function ema(values, period) {
  const k = 2 / (period + 1)
  const out = new Array(values.length).fill(0)
  out[0] = values[0]
  for (let i = 1; i < values.length; i++) out[i] = values[i] * k + out[i - 1] * (1 - k)
  return out
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

// CHOCH detection at index i (look back ≤80 candles). Returns 'up' / 'down' / null.
function chochAt(c, i, lookback = 80) {
  const start = Math.max(3, i - lookback)
  const swings = []
  for (let j = start; j <= i - 3; j++) {
    const w = c.slice(Math.max(0, j - 3), j + 4)
    if (w.length < 7) continue
    const isHigh = w.every(x => x.high <= c[j].high) && w.some(x => x.high < c[j].high)
    const isLow = w.every(x => x.low >= c[j].low) && w.some(x => x.low > c[j].low)
    if (isHigh) swings.push({ idx: j, type: 'high', price: c[j].high })
    if (isLow) swings.push({ idx: j, type: 'low', price: c[j].low })
  }
  if (swings.length < 4) return null
  const recent = swings.slice(-4)
  const dirs = recent.map(s => s.type).join('-')
  if (dirs === 'high-low-high-low' && recent[3].price < recent[1].price) return 'down'
  if (dirs === 'low-high-low-high' && recent[3].price > recent[1].price) return 'up'
  return null
}

function applyVariantFilter(c, atr, triggers, variant) {
  if (variant === 'V0') return triggers
  // V1: CHOCH inversion — veto if recent CHOCH opposes trigger direction
  if (variant === 'V1') return triggers.filter(t => {
    const choch = chochAt(c, t.idx, 80)
    if (t.dir === 'long' && choch === 'down') return false
    if (t.dir === 'short' && choch === 'up') return false
    return true
  })
  // V2: trend-aligned (with 1H 200-EMA)
  if (variant === 'V2') {
    const closes = c.map(x => x.close)
    const e200 = ema(closes, 200)
    return triggers.filter(t => {
      if (t.idx < 200) return false
      const above = c[t.idx].close > e200[t.idx]
      return (t.dir === 'long' && above) || (t.dir === 'short' && !above)
    })
  }
  // V3: counter-trend (mean-reversion)
  if (variant === 'V3') {
    const closes = c.map(x => x.close)
    const e200 = ema(closes, 200)
    return triggers.filter(t => {
      if (t.idx < 200) return false
      const above = c[t.idx].close > e200[t.idx]
      return (t.dir === 'long' && !above) || (t.dir === 'short' && above)
    })
  }
  // V6: ATR band 0.5% — 3.5% of price
  if (variant === 'V6') return triggers.filter(t => {
    const a = atr[t.idx]
    const p = c[t.idx].close
    if (a <= 0 || p <= 0) return false
    const pct = (a / p) * 100
    return pct >= 0.5 && pct <= 3.5
  })
  // V4 / V5 / V7 are filters at the symbol level, not per-trigger, handled outside.
  return triggers
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

function median(arr) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const VARIANTS = [
  { id: 'V0', label: 'baseline (sweep all)',     instruments: ALL_INSTRUMENTS },
  { id: 'V1', label: '+ CHOCH inversion veto',   instruments: ALL_INSTRUMENTS },
  { id: 'V2', label: '+ trend-aligned (1H 200EMA)', instruments: ALL_INSTRUMENTS },
  { id: 'V3', label: '+ counter-trend (1H 200EMA)', instruments: ALL_INSTRUMENTS },
  { id: 'V4', label: '+ top-5 instruments',      instruments: TOP5 },
  { id: 'V5', label: '+ top-3 instruments',      instruments: TOP3 },
  { id: 'V6', label: '+ ATR band 0.5%-3.5%',    instruments: ALL_INSTRUMENTS },
  { id: 'V7', label: '+ CHOCH inv + top-5',      instruments: TOP5, extraFilter: 'V1' },
]

async function loadFold(syms, trainStart, trainEnd, testStart, testEnd) {
  const train = {}, test = {}
  for (const sym of syms) {
    train[sym] = await fetchCandles(sym, trainStart, trainEnd)
    test[sym] = await fetchCandles(sym, testStart, testEnd)
  }
  return { train, test }
}

function runVariant(symData, variant) {
  const all = []
  for (const sym of Object.keys(symData)) {
    const c = symData[sym]
    if (c.length < 80) continue
    const atr = atrSeries(c, 14)
    const baseTriggers = detectSweeps(c, FIXED.lb, FIXED.cf)
    const filterId = variant.extraFilter ?? variant.id
    const filtered = applyVariantFilter(c, atr, baseTriggers, filterId)
    all.push(...simulate(c, atr, filtered, FIXED.sl, FIXED.tp))
  }
  return summarise(all)
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

  console.log('\n5-fold WF — variants on top of FIXED params (lb=40 sl=2.5 tp=4.0 confirm=YES)')
  console.log(`No per-fold re-optimisation. Pass: median OOS >= +0.05, >=3/5 folds positive, WR > 48%, n>=200\n`)

  // Pre-load all data per variant (cache by full universe)
  const fullData = {}
  for (let i = 0; i < folds.length; i++) {
    const f = folds[i]
    fullData[i] = await loadFold(ALL_INSTRUMENTS, dayBack(f.trainStart), dayBack(f.trainEnd), dayBack(f.testStart), dayBack(f.testEnd))
  }

  console.log('━━━ VARIANT SUMMARY (5 folds, fixed params, OOS only) ━━━')
  console.log('ID   Filter description                    Med Exp/R  Mean Exp/R  Pos folds   Mean WR   Total n')
  console.log('-----------------------------------------------------------------------------------------------')

  const allResults = []
  for (const variant of VARIANTS) {
    const oosExps = []
    const oosWrs = []
    const oosNs = []
    for (let i = 0; i < folds.length; i++) {
      const data = fullData[i]
      // Filter by instrument set if needed
      const test = {}
      for (const sym of variant.instruments) if (data.test[sym]) test[sym] = data.test[sym]
      const oos = runVariant(test, variant)
      oosExps.push(oos.expR)
      oosWrs.push(oos.wr)
      oosNs.push(oos.n)
    }
    const med = median(oosExps)
    const mean = oosExps.reduce((s, x) => s + x, 0) / oosExps.length
    const wr = oosWrs.reduce((s, x) => s + x, 0) / oosWrs.length
    const pos = oosExps.filter(x => x > 0).length
    const totN = oosNs.reduce((s, x) => s + x, 0)
    allResults.push({ id: variant.id, label: variant.label, med, mean, wr, pos, totN, oosExps })
    const m = (med >= 0 ? '+' : '') + med.toFixed(3)
    const mn = (mean >= 0 ? '+' : '') + mean.toFixed(3)
    console.log(`${variant.id}   ${variant.label.padEnd(36)}  ${m.padStart(8)}   ${mn.padStart(8)}    ${pos}/5         ${(wr*100).toFixed(1).padStart(4)}%    ${String(totN).padStart(5)}`)
  }

  // Per-fold detail for the best variant
  allResults.sort((a, b) => b.med - a.med)
  const winner = allResults[0]
  console.log(`\n━━━ BEST VARIANT: ${winner.id} (${winner.label}) — per-fold detail ━━━`)
  console.log('Fold  OOS Exp/R')
  for (let i = 0; i < winner.oosExps.length; i++) {
    const v = winner.oosExps[i]
    console.log(`${(i + 1).toString().padStart(2)}    ${(v >= 0 ? '+' : '') + v.toFixed(3)}`)
  }

  // Verdict for the best variant
  const passMed = winner.med >= 0.05
  const passFolds = winner.pos >= 3
  const passWr = winner.wr > 0.48
  const passN = winner.totN >= 200
  const allPass = passMed && passFolds && passWr && passN
  console.log(`\n━━━ VERDICT (best variant: ${winner.id}) ━━━`)
  console.log(`  Median OOS Exp/R >= +0.05?  ${passMed ? 'PASS' : 'FAIL'}  (${winner.med.toFixed(3)})`)
  console.log(`  >=3/5 folds positive?       ${passFolds ? 'PASS' : 'FAIL'}  (${winner.pos}/5)`)
  console.log(`  Mean OOS WR > 48%?          ${passWr ? 'PASS' : 'FAIL'}  (${(winner.wr*100).toFixed(1)}%)`)
  console.log(`  Total OOS n >= 200?         ${passN ? 'PASS' : 'FAIL'}  (${winner.totN})`)
  console.log(`\n  RESULT: ${allPass ? 'PASS — wire as DEMO-ONLY trigger for 30d before live consideration.' : 'FAIL — even the best variant does not clear the bar. Trigger family is not edge.'}`)

  console.log('\n[end]')
}

main().catch(e => { console.error(e); process.exit(1) })
