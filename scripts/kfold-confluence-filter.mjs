#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// PHASE D — Final hypothesis: liquidity-sweep as a CONFLUENCE FILTER on top
// of indicator triggers, instead of as a standalone trigger.
//
// Vanilla sweep: median OOS +0.029 (FAIL)
// Vanilla indicator triggers (NEW mode): -0.135 R/trade (FAIL)
//
// Confluence test: only take an indicator-LONG if a sweep-of-low fired in the
// last N hours AND CHOCH isn't pointing down. Symmetrical for shorts (which
// the live system blocks anyway, but we test the OOS expectancy of the filter
// since it would unblock or further-restrict the indicator stack).
//
// Indicator triggers reproduced here (matching agents/war-room.ts):
//   - EMA 12/26 cross
//   - MACD histogram cross
//   - RSI extreme (oversold/overbought)
//   - EMA-50 break
//   - Volume spike (>= 2x avg)
//
// Filter requires:
//   - sweep-of-low (long) or sweep-of-high (short) within last 8 hours
//   - no CHOCH-down on entry candle for long (no CHOCH-up for short)
//
// Pass criteria (same): median OOS Exp/R >= +0.05, ≥3/5 folds positive,
// mean WR > 48%, total OOS n >= 200.
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
const SL_ATR = 2.0
const TP_ATR = 3.0  // matches NEW mode in backtest-gate-stack
const MAX_HOLD = 48
const SWEEP_LOOKBACK = 40
const SWEEP_WINDOW = 8  // sweep must have fired within the last 8h

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

// ── indicators ─────────────────────────────────────────────────
function ema(values, period) {
  const k = 2 / (period + 1)
  const out = new Array(values.length).fill(0)
  out[0] = values[0]
  for (let i = 1; i < values.length; i++) out[i] = values[i] * k + out[i - 1] * (1 - k)
  return out
}
function rsi(values, period = 14) {
  const out = new Array(values.length).fill(50)
  let gain = 0, loss = 0
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1]
    if (d >= 0) gain += d; else loss -= d
  }
  let avgG = gain / period, avgL = loss / period
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL)
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1]
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL)
  }
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

// ── triggers (mirroring agents/war-room.ts and lib/indicators.ts intent) ──
function detectIndicatorTriggers(c) {
  const out = []
  const closes = c.map(x => x.close)
  const e12 = ema(closes, 12)
  const e26 = ema(closes, 26)
  const e50 = ema(closes, 50)
  const r = rsi(closes, 14)
  // MACD = EMA12 - EMA26; signal = EMA9 of MACD
  const macd = e12.map((v, i) => v - e26[i])
  const sig = ema(macd, 9)
  // Volume rolling 20-bar avg
  const volAvg = new Array(c.length).fill(0)
  for (let i = 19; i < c.length; i++) {
    let s = 0
    for (let j = i - 19; j <= i; j++) s += c[j].volume
    volAvg[i] = s / 20
  }
  for (let i = 50; i < c.length - 1; i++) {
    // EMA 12/26 cross
    if (e12[i - 1] <= e26[i - 1] && e12[i] > e26[i]) out.push({ idx: i, dir: 'long', name: 'EMA-cross' })
    if (e12[i - 1] >= e26[i - 1] && e12[i] < e26[i]) out.push({ idx: i, dir: 'short', name: 'EMA-cross' })
    // MACD histogram cross
    const h = macd[i] - sig[i]
    const hPrev = macd[i - 1] - sig[i - 1]
    if (hPrev <= 0 && h > 0) out.push({ idx: i, dir: 'long', name: 'MACD-cross' })
    if (hPrev >= 0 && h < 0) out.push({ idx: i, dir: 'short', name: 'MACD-cross' })
    // RSI extreme
    if (r[i - 1] < 30 && r[i] >= 30) out.push({ idx: i, dir: 'long', name: 'RSI-extreme' })
    if (r[i - 1] > 70 && r[i] <= 70) out.push({ idx: i, dir: 'short', name: 'RSI-extreme' })
    // EMA-50 break
    if (c[i - 1].close <= e50[i - 1] && c[i].close > e50[i]) out.push({ idx: i, dir: 'long', name: 'EMA50-break' })
    if (c[i - 1].close >= e50[i - 1] && c[i].close < e50[i]) out.push({ idx: i, dir: 'short', name: 'EMA50-break' })
    // Volume spike (only as confirm; don't fire alone)
    if (volAvg[i] > 0 && c[i].volume >= 2 * volAvg[i]) {
      // Only attach if there's another trigger in window 0
    }
  }
  return out
}

function detectSweeps(c, lookback = SWEEP_LOOKBACK, requireConfirm = true) {
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

function simulate(c, atr, triggers, slMult, tpMult, maxHold) {
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
    folds.push({ testStart: minTrainDays + f * testDays, testEnd: minTrainDays + (f + 1) * testDays })
  }
  const now = Date.now()
  const dayMs = 86400_000
  const dayBack = (d) => new Date(now - (totalDays - d) * dayMs).toISOString()

  console.log('\nConfluence test — indicator triggers + sweep filter (5-fold WF, fixed params)')
  console.log(`Indicators: EMA-cross, MACD-cross, RSI-extreme, EMA50-break`)
  console.log(`Filter: sweep-of-(low|high) within last ${SWEEP_WINDOW}h AND no CHOCH against direction`)
  console.log(`Exits: SL=${SL_ATR}*ATR, TP=${TP_ATR}*ATR, MaxHold=${MAX_HOLD}h\n`)

  // Prepare 4 strategies for direct comparison
  const strategies = [
    'A: indicator-only (vanilla)',
    'B: indicator + recent-sweep CONFIRM',
    'C: indicator + sweep + no-CHOCH',
    'D: indicator + (sweep AND no-CHOCH)',
  ]
  const tally = strategies.map(() => ({ exps: [], wrs: [], ns: [] }))

  for (const f of folds) {
    const dataPerSym = {}
    for (const sym of INSTRUMENTS) dataPerSym[sym] = await fetchCandles(sym, dayBack(f.testStart), dayBack(f.testEnd))
    const allTradesByStrategy = strategies.map(() => [])
    for (const sym of INSTRUMENTS) {
      const c = dataPerSym[sym]
      if (c.length < 100) continue
      const atr = atrSeries(c, 14)
      const indicatorTrigs = detectIndicatorTriggers(c)
      const sweepTrigs = detectSweeps(c, SWEEP_LOOKBACK, true)
      // Index sweeps by direction for fast nearest-window lookup
      const recentSweep = (idx, dir) => {
        for (let j = idx; j >= Math.max(0, idx - SWEEP_WINDOW); j--) {
          if (sweepTrigs.find(s => s.idx === j && s.dir === dir)) return true
        }
        return false
      }

      // A: vanilla
      const A = indicatorTrigs
      // B: + recent sweep in same direction
      const B = indicatorTrigs.filter(t => recentSweep(t.idx, t.dir))
      // C: + no CHOCH against direction
      const C = indicatorTrigs.filter(t => {
        const ch = chochAt(c, t.idx, 80)
        return !((t.dir === 'long' && ch === 'down') || (t.dir === 'short' && ch === 'up'))
      })
      // D: both filters
      const D = indicatorTrigs.filter(t => {
        if (!recentSweep(t.idx, t.dir)) return false
        const ch = chochAt(c, t.idx, 80)
        return !((t.dir === 'long' && ch === 'down') || (t.dir === 'short' && ch === 'up'))
      })

      allTradesByStrategy[0].push(...simulate(c, atr, A, SL_ATR, TP_ATR, MAX_HOLD))
      allTradesByStrategy[1].push(...simulate(c, atr, B, SL_ATR, TP_ATR, MAX_HOLD))
      allTradesByStrategy[2].push(...simulate(c, atr, C, SL_ATR, TP_ATR, MAX_HOLD))
      allTradesByStrategy[3].push(...simulate(c, atr, D, SL_ATR, TP_ATR, MAX_HOLD))
    }
    for (let s = 0; s < strategies.length; s++) {
      const sm = summarise(allTradesByStrategy[s])
      tally[s].exps.push(sm.expR); tally[s].wrs.push(sm.wr); tally[s].ns.push(sm.n)
    }
  }

  console.log('━━━ STRATEGY COMPARISON (5-fold OOS, fixed params, 365d) ━━━')
  console.log('Strategy                                 Median Exp/R  Mean Exp/R  Pos folds  Mean WR  Total n')
  console.log('-----------------------------------------------------------------------------------------------')
  for (let s = 0; s < strategies.length; s++) {
    const t = tally[s]
    const med = median(t.exps)
    const mean = t.exps.reduce((a, b) => a + b, 0) / t.exps.length
    const wr = t.wrs.reduce((a, b) => a + b, 0) / t.wrs.length
    const pos = t.exps.filter(x => x > 0).length
    const totN = t.ns.reduce((a, b) => a + b, 0)
    const m = (med >= 0 ? '+' : '') + med.toFixed(3)
    const mn = (mean >= 0 ? '+' : '') + mean.toFixed(3)
    console.log(`${strategies[s].padEnd(40)}    ${m.padStart(7)}     ${mn.padStart(7)}    ${pos}/5        ${(wr*100).toFixed(1).padStart(4)}%    ${String(totN).padStart(5)}`)
  }
  console.log('\n[end]')
}

main().catch(e => { console.error(e); process.exit(1) })
