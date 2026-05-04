#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// PHASE D — Direction #3: funding-rate mean-reversion primitive
//
// Hypothesis: when perpetual-futures funding rate is extreme, the heavy side
// of the book pays the light side every 8h. Crowded longs (high positive
// funding) typically mark a local top; crowded shorts (low/negative funding)
// typically mark a local bottom. Mean-reversion trade.
//
// Mechanics:
//   - Funding paid every 8h on Binance perp: at UTC 00:00, 08:00, 16:00.
//   - We enter on the 1H candle that CLOSES the funding period (UTC hours 0,
//     8, 16). LONG if funding ≤ funding_long_threshold, SHORT if funding ≥
//     funding_short_threshold. SHORT path is reported but blocked by
//     workspace rule (long-only); we still measure it.
//   - Stops: SL = SL_ATR × 1H ATR, TP = TP_ATR × 1H ATR, max-hold 24h.
//
// Validation: 5-fold anchored walk-forward on 365d. For each fold we:
//   1. Sweep over a small grid of long/short thresholds + SL/TP
//   2. Pick the best train combo (n ≥ 30)
//   3. Apply OOS to the test fold
//   4. Aggregate median OOS Exp/R, % positive folds, mean WR
//
// Pass criteria same as kfold-liquidity-sweep:
//   median OOS Exp/R ≥ +0.05, ≥3/5 folds positive, mean WR > 48%, n ≥ 200.
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

const FAPI = 'https://fapi.binance.com/fapi/v1/fundingRate'
const SYMBOLS = {
  'BTC/USD': 'BTCUSDT',
  'ETH/USD': 'ETHUSDT',
  'SOL/USD': 'SOLUSDT',
  'BNB/USD': 'BNBUSDT',
  'DOGE/USD': 'DOGEUSDT',
  'AVAX/USD': 'AVAXUSDT',
  'LINK/USD': 'LINKUSDT',
  'ADA/USD': 'ADAUSDT',
  'DOT/USD': 'DOTUSDT',
  'NEAR/USD': 'NEARUSDT',
  'APT/USD': 'APTUSDT',
}
// MATIC excluded — POL/MATIC funding history changed at the rebrand. Excluded
// here to avoid spurious results from the splice point.

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const SL_ATR = 2.0
const TP_ATR = 3.0
const MAX_HOLD = 24  // bars (24h on 1H candles)

async function fetchFundingRange(binSym, startMs, endMs) {
  const out = []
  let current = startMs
  while (current < endMs) {
    const url = `${FAPI}?symbol=${binSym}&startTime=${current}&endTime=${endMs}&limit=1000`
    const res = await fetch(url)
    if (!res.ok) {
      console.error(`  ${binSym} ${res.status}: ${(await res.text()).slice(0, 120)}`)
      break
    }
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) break
    for (const r of data) out.push({ ts: r.fundingTime, rate: parseFloat(r.fundingRate) })
    if (data.length < 1000) break
    current = data[data.length - 1].fundingTime + 1
    await sleep(150)
  }
  return out
}

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
  return all.map(x => ({ ts: new Date(x.timestamp).getTime(), open: +x.open, high: +x.high, low: +x.low, close: +x.close, volume: +x.volume }))
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

function findCandleIdxAtOrAfter(c, ts) {
  // Linear scan; the input is sorted ascending and small enough.
  for (let i = 0; i < c.length; i++) if (c[i].ts >= ts) return i
  return -1
}

function simulate(c, atr, idx, dir, slMult, tpMult, maxHold) {
  if (idx >= c.length - 1 || atr[idx] === 0) return null
  const entry = c[idx].close
  const slDist = slMult * atr[idx]
  const sl = dir === 'long' ? entry - slDist : entry + slDist
  const tp = dir === 'long' ? entry + tpMult * atr[idx] : entry - tpMult * atr[idx]
  for (let j = idx + 1; j < Math.min(c.length, idx + 1 + maxHold); j++) {
    if (dir === 'long') {
      if (c[j].low <= sl) return -1
      if (c[j].high >= tp) return tpMult / slMult
    } else {
      if (c[j].high >= sl) return -1
      if (c[j].low <= tp) return tpMult / slMult
    }
  }
  const exit = c[Math.min(c.length - 1, idx + maxHold)].close
  return dir === 'long' ? (exit - entry) / slDist : (entry - exit) / slDist
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

// Strategy: at every funding event in [start,end], evaluate the funding value.
// If rate <= longThr → take a LONG at the next 1H candle close. If rate >=
// shortThr → take a SHORT at the next 1H candle close.
function strategyTrades(syms, candlesBySym, fundingBySym, atrBySym, longThr, shortThr, slMult, tpMult, side /* 'long' | 'short' | 'both' */) {
  const trades = []
  for (const sym of syms) {
    const c = candlesBySym[sym]
    const atr = atrBySym[sym]
    const fr = fundingBySym[sym]
    if (!c || !c.length || !fr || !fr.length) continue
    for (const event of fr) {
      const idx = findCandleIdxAtOrAfter(c, event.ts)
      if (idx === -1) continue
      let dir = null
      if (event.rate <= longThr && (side === 'long' || side === 'both')) dir = 'long'
      else if (event.rate >= shortThr && (side === 'short' || side === 'both')) dir = 'short'
      if (!dir) continue
      const r = simulate(c, atr, idx, dir, slMult, tpMult, MAX_HOLD)
      if (r === null) continue
      trades.push({ r, dir, sym, ts: event.ts, rate: event.rate })
    }
  }
  return trades
}

async function main() {
  const totalDays = 365
  const minTrainDays = 65
  const testDays = 60
  const folds = []
  for (let f = 0; f < 5; f++) {
    folds.push({ trainEnd: minTrainDays + f * testDays, testEnd: minTrainDays + (f + 1) * testDays })
  }
  const now = Date.now()
  const dayMs = 86400_000
  const dayBack = (d) => new Date(now - (totalDays - d) * dayMs).toISOString()

  console.log('\nFUNDING-RATE WALK-FORWARD — 5-fold, 365d, 11 perp symbols')
  console.log(`Stops: SL=${SL_ATR}*ATR  TP=${TP_ATR}*ATR  MaxHold=${MAX_HOLD}h\n`)

  // Pre-fetch all funding history (whole 365d window) once, then slice per fold
  console.log('Fetching funding history from fapi.binance.com...')
  const fundingAll = {}
  for (const [sym, binSym] of Object.entries(SYMBOLS)) {
    const t0 = Date.now()
    process.stdout.write(`  ${sym.padEnd(12)}-> ${binSym.padEnd(10)}  `)
    const fr = await fetchFundingRange(binSym, now - totalDays * dayMs, now)
    fundingAll[sym] = fr
    console.log(`${fr.length} events  (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  }

  // Pre-fetch full 365d candles + ATR
  console.log('\nFetching 365d 1H candles from price_history...')
  const candlesAll = {}, atrAll = {}
  for (const sym of Object.keys(SYMBOLS)) {
    candlesAll[sym] = await fetchCandles(sym, dayBack(0), dayBack(totalDays))
    atrAll[sym] = atrSeries(candlesAll[sym], 14)
  }
  console.log()

  // ── exploratory pass: full universe, full window, range of thresholds ──
  console.log('━━━ EXPLORATORY: full 365d, all symbols, threshold sweep ━━━')
  console.log('Side       longThr   shortThr   n      WR      Exp/R')
  console.log('-------------------------------------------------------')
  const exploreCfgs = [
    // Long-side only (mean-reversion buy when shorts pay heavily)
    { side: 'long', longThr: -0.0001, shortThr: 999 },
    { side: 'long', longThr: -0.0003, shortThr: 999 },
    { side: 'long', longThr: -0.0005, shortThr: 999 },
    { side: 'long', longThr: -0.0010, shortThr: 999 },
    // Short-side only (sell when longs pay heavily — blocked by workspace rule
    // but we measure to confirm the cross-sectional finding)
    { side: 'short', longThr: -999, shortThr: +0.0001 },
    { side: 'short', longThr: -999, shortThr: +0.0003 },
    { side: 'short', longThr: -999, shortThr: +0.0005 },
    { side: 'short', longThr: -999, shortThr: +0.0010 },
  ]
  for (const cfg of exploreCfgs) {
    const t = strategyTrades(Object.keys(SYMBOLS), candlesAll, fundingAll, atrAll, cfg.longThr, cfg.shortThr, SL_ATR, TP_ATR, cfg.side).map(x => ({ r: x.r }))
    const s = summarise(t)
    const expR = (s.expR >= 0 ? '+' : '') + s.expR.toFixed(3)
    const lt = cfg.longThr === -999 ? '   —   ' : (cfg.longThr * 100).toFixed(3) + '%'
    const st = cfg.shortThr === 999 ? '   —   ' : '+' + (cfg.shortThr * 100).toFixed(3) + '%'
    console.log(`${cfg.side.padEnd(8)}   ${lt.padStart(8)}   ${st.padStart(8)}   ${String(s.n).padStart(5)}   ${(s.wr*100).toFixed(1).padStart(4)}%   ${expR}`)
  }

  // ── 5-fold walk-forward, LONG-side only (workspace rule) ──
  console.log('\n━━━ 5-FOLD WALK-FORWARD: long-side only ━━━')
  const fundingThresholds = [-0.0001, -0.0003, -0.0005, -0.0010, -0.0020]
  console.log('Per-fold: train picks best long-threshold; OOS reports the same threshold.\n')
  console.log('Fold    Best longThr     Train n    Train Exp/R    OOS n    OOS WR    OOS Exp/R')
  console.log('-----------------------------------------------------------------------------------')
  const oosResults = []
  for (let i = 0; i < folds.length; i++) {
    const f = folds[i]
    // Slice funding events to this fold
    const trainStartMs = now - (totalDays - 0) * dayMs
    const trainEndMs = now - (totalDays - f.trainEnd) * dayMs
    const testEndMs = now - (totalDays - f.testEnd) * dayMs
    const trainFunding = {}
    const testFunding = {}
    for (const sym of Object.keys(SYMBOLS)) {
      trainFunding[sym] = fundingAll[sym].filter(e => e.ts >= trainStartMs && e.ts < trainEndMs)
      testFunding[sym] = fundingAll[sym].filter(e => e.ts >= trainEndMs && e.ts < testEndMs)
    }
    // Search train
    let best = { thr: null, expR: -999, n: 0 }
    for (const thr of fundingThresholds) {
      const t = strategyTrades(Object.keys(SYMBOLS), candlesAll, trainFunding, atrAll, thr, 999, SL_ATR, TP_ATR, 'long').map(x => ({ r: x.r }))
      const s = summarise(t)
      if (s.n >= 30 && s.expR > best.expR) best = { thr, ...s }
    }
    if (!best.thr) {
      console.log(`${i + 1}       — (no viable train combo)`)
      oosResults.push({ expR: 0, n: 0, wr: 0 }); continue
    }
    // Apply OOS
    const oosT = strategyTrades(Object.keys(SYMBOLS), candlesAll, testFunding, atrAll, best.thr, 999, SL_ATR, TP_ATR, 'long').map(x => ({ r: x.r }))
    const oos = summarise(oosT)
    oosResults.push(oos)
    const trExp = (best.expR >= 0 ? '+' : '') + best.expR.toFixed(3)
    const oosExp = (oos.expR >= 0 ? '+' : '') + oos.expR.toFixed(3)
    console.log(`${(i + 1).toString().padStart(2)}      ${(best.thr * 100).toFixed(3) + '%'.padEnd(2)}        ${String(best.n).padStart(4)}      ${trExp.padStart(7)}     ${String(oos.n).padStart(4)}     ${(oos.wr*100).toFixed(1).padStart(4)}%     ${oosExp.padStart(7)}`)
  }

  const oosExps = oosResults.map(r => r.expR)
  const oosWrs = oosResults.map(r => r.wr)
  const oosNs = oosResults.map(r => r.n)
  const med = median(oosExps)
  const mean = oosExps.reduce((s, x) => s + x, 0) / oosExps.length
  const mwr = oosWrs.reduce((s, x) => s + x, 0) / oosWrs.length
  const pos = oosExps.filter(x => x > 0).length
  const totN = oosNs.reduce((s, x) => s + x, 0)
  console.log(`\n━━━ HEADLINE ━━━`)
  console.log(`Median OOS Exp/R:  ${(med>=0?'+':'')}${med.toFixed(3)}`)
  console.log(`Mean OOS Exp/R:    ${(mean>=0?'+':'')}${mean.toFixed(3)}`)
  console.log(`Mean OOS WR:       ${(mwr*100).toFixed(1)}%`)
  console.log(`Positive folds:    ${pos}/5`)
  console.log(`Total OOS trades:  ${totN}`)

  const passMed = med >= 0.05
  const passFolds = pos >= 3
  const passWr = mwr > 0.48
  const passN = totN >= 200
  const allPass = passMed && passFolds && passWr && passN
  console.log(`\n━━━ VERDICT ━━━`)
  console.log(`  Median OOS Exp/R >= +0.05?  ${passMed ? 'PASS' : 'FAIL'}  (${med.toFixed(3)})`)
  console.log(`  >=3/5 folds positive?       ${passFolds ? 'PASS' : 'FAIL'}  (${pos}/5)`)
  console.log(`  Mean OOS WR > 48%?          ${passWr ? 'PASS' : 'FAIL'}  (${(mwr*100).toFixed(1)}%)`)
  console.log(`  Total OOS n >= 200?         ${passN ? 'PASS' : 'FAIL'}  (${totN})`)
  console.log()
  console.log(allPass
    ? '  RESULT: PASS — funding-rate is a robust standalone primitive. Recommend wiring as DEMO-ONLY for 30d.'
    : '  RESULT: FAIL — funding-rate alone does not clear the bar.')

  console.log('\n[end]')
}

main().catch(e => { console.error(e); process.exit(1) })
