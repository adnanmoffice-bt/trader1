#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// PHASE D — PER-GATE IMPACT STUDY (highest-priority research item, §9.7)
//
// Background: vanilla indicator triggers on raw price_history run roughly
// breakeven (+0.007 R/trade, 4/5 folds positive, n=15,563). The same trigger
// family wrapped in the live war-room gate stack runs at -0.135 R/trade
// (n=338). The gate stack is removing winners faster than losers.
//
// This script attributes the damage. For each gate that's testable from
// price_history alone, we compute ΔExp/R = ExpR(all-on minus G) - ExpR(all-on).
// Positive Δ means "removing this gate IMPROVES expectancy" → the gate is
// net-harmful and a candidate for removal/relaxation in agents/war-room.ts.
//
// Gates mirrored (8 of the 17 in war-room.ts; the remaining 9 require trade-
// history reconstruction, account state, or external feeds and are out of
// scope for this study):
//
//   regime-ranging         regime=ranging AND strength>=0.5 AND triggers<2 → block
//   atr-extreme            ATR%price <0.3 OR >5 → block
//   mtf-veto               long AND triggers=1 AND mtf-longConfluence=0 → block
//   macro-high-strict      [omitted — needs macro feed]
//   trend-filtered         EMA-50 slope DOWN over last 8h → block (approximation
//                          of the Markov forecast.smoothedTrend===down test)
//   cooldown-60min         60 min since last entry on same instrument → block
//   session-gate           Dubai 02:00-09:00 AND conviction<90 AND triggers<3
//                          → block. Conviction is approximated as 70 (typical
//                          single-trigger conviction, never overrides).
//   duplicate-signal       same-direction trigger on same instrument <60 min ago
//                          → block
//   long-only-mode         block all SHORT entries (system-wide policy)
//
// Triggers replicated (matching agents/war-room.ts → rawTriggers, BB-squeeze
// permanently disabled per CONTEXT.md):
//   - EMA 12/26 cross
//   - MACD-signal cross
//   - RSI 30/70 reclaim
//   - EMA-50 breakout
//   - Volume spike (≥2× 20-bar avg) — only counts if another trigger same bar
//
// Method: 5-fold anchored walk-forward on 365d real data, ATR-stops
// SL=2.0×ATR / TP=3.0×ATR / max-hold=48h (matches NEW mode in
// scripts/backtest-gate-stack.mjs). For each strategy, all 5 folds are
// concatenated to compute the headline Exp/R + WR + n.
//
// Output:
//   - Baseline rows: NO-GATES, ALL-GATES-ON
//   - Per-gate rows: ALL-EXCEPT-{G}  with ΔExp/R relative to ALL-GATES-ON
//   - Sorted descending by Δ (most-harmful gates at the top)
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
const INTERVAL = process.argv.find(a => /^--interval=/.test(a))?.split('=')[1] ?? '1h'
const HOURS_PER_BAR = INTERVAL === '4h' ? 4 : INTERVAL === '1d' ? 24 : 1
const SL_ATR = 2.0
const TP_ATR = 3.0
const MAX_HOLD = INTERVAL === '4h' ? 24 : INTERVAL === '1d' ? 7 : 48  // ~4 days, ~7 days, ~2 days respectively
const COOLDOWN_HOURS = INTERVAL === '4h' ? 4 : INTERVAL === '1d' ? 24 : 1
const DUP_HOURS = INTERVAL === '4h' ? 4 : INTERVAL === '1d' ? 24 : 1

async function fetchCandles(symbol, sinceIso, untilIso) {
  const all = []
  let offset = 0
  while (true) {
    const url = `${URL_}/rest/v1/price_history?symbol=eq.${encodeURIComponent(symbol)}&interval=eq.${INTERVAL}&timestamp=gte.${sinceIso}&timestamp=lt.${untilIso}&order=timestamp.asc&limit=1000&offset=${offset}&select=timestamp,open,high,low,close,volume`
    const r = await fetch(url, { headers })
    const rows = await r.json()
    if (!Array.isArray(rows) || rows.length === 0) break
    all.push(...rows)
    if (rows.length < 1000) break
    offset += 1000
  }
  return all.map(x => ({ timestamp: new Date(x.timestamp).getTime(), open: +x.open, high: +x.high, low: +x.low, close: +x.close, volume: +x.volume }))
}

// ── indicators ─────────────────────────────────────────────────
function ema(values, period) {
  const k = 2 / (period + 1)
  const out = new Array(values.length).fill(0)
  out[0] = values[0]
  for (let i = 1; i < values.length; i++) out[i] = values[i] * k + out[i - 1] * (1 - k)
  return out
}
function rsiSeries(values, period = 14) {
  const out = new Array(values.length).fill(50)
  if (values.length <= period) return out
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
// detectRegime mirroring lib/indicators.ts → detectRegime()
function regimeAt(c, i) {
  if (i < 50) return { regime: 'ranging', strength: 0 }
  const slice = c.slice(i - 49, i + 1)
  const closes = slice.map(x => x.close)
  const e20 = ema(closes, 20).at(-1)
  const e50 = ema(closes, 50).at(-1)
  const r = rsiSeries(closes, 14).at(-1)
  const atrV = atrSeries(slice, 14).at(-1)
  const price = closes.at(-1)
  const avgPrice = closes.slice(-20).reduce((s, x) => s + x, 0) / 20
  const volPct = avgPrice > 0 ? (atrV / avgPrice) * 100 : 0
  if (volPct > 4) return { regime: 'volatile', strength: Math.min(volPct / 4, 2) }
  const emaSpread = ((e20 - e50) / e50) * 100
  const rsiVal = isNaN(r) ? 50 : r
  if (emaSpread > 1 && rsiVal > 50 && price > e20) return { regime: 'trending_up', strength: Math.min(emaSpread / 2, 2) }
  if (emaSpread < -1 && rsiVal < 50 && price < e20) return { regime: 'trending_down', strength: Math.min(Math.abs(emaSpread) / 2, 2) }
  return { regime: 'ranging', strength: Math.max(0, 1 - Math.abs(emaSpread)) }
}
// MTF mirror: aggregate 1H to 4H and 1D, compute trend on each
function mtfAt(c, i) {
  if (i < 200) return { longConfluenceCount: 0, trend4h: 'flat', trend1d: 'flat' }
  // Use last 200 1H bars
  const win = c.slice(i - 199, i + 1)
  const trend = (window) => {
    if (window.length < 50) return 'flat'
    const closes = window.map(x => x.close)
    const e20 = ema(closes, 20).at(-1)
    const e50 = ema(closes, 50).at(-1)
    const price = closes.at(-1)
    if (e20 > e50 * 1.002 && price > e20) return 'up'
    if (e20 < e50 * 0.998 && price < e20) return 'down'
    return 'flat'
  }
  const aggregate = (arr, factor) => {
    const out = []
    for (let j = 0; j + factor <= arr.length; j += factor) {
      const chunk = arr.slice(j, j + factor)
      out.push({
        timestamp: chunk[0].timestamp,
        open: chunk[0].open,
        high: Math.max(...chunk.map(x => x.high)),
        low: Math.min(...chunk.map(x => x.low)),
        close: chunk.at(-1).close,
        volume: chunk.reduce((s, x) => s + x.volume, 0),
      })
    }
    return out
  }
  const c4h = aggregate(win, 4)
  const c1d = aggregate(win, 24)
  const t4 = trend(c4h)
  const t1d = trend(c1d)
  const longCount = (t4 === 'up' ? 1 : 0) + (t1d === 'up' ? 1 : 0)
  return { trend4h: t4, trend1d: t1d, longConfluenceCount: longCount }
}
// EMA-50 slope as proxy for forecast.smoothedTrend
function trendDownAt(c, i) {
  if (i < 60) return false
  const closes = c.slice(0, i + 1).map(x => x.close)
  const e50 = ema(closes, 50)
  const cur = e50.at(-1)
  const past = e50.at(-9) ?? cur
  return cur < past // EMA-50 trending down over last 8 bars
}

// Triggers — mirroring lib/indicators.ts trigger detectors. All long-only;
// the long-only-mode gate is the policy that drops shorts (so when that gate
// is OFF we keep them; this is the only gate where "OFF" might INCREASE n).
function detectAllTriggersAt(c, i, atr) {
  if (i < 50) return []
  const closes = c.slice(0, i + 1).map(x => x.close)
  const e12 = ema(closes, 12)
  const e26 = ema(closes, 26)
  const e50 = ema(closes, 50)
  const r = rsiSeries(closes, 14)
  const macd = e12.map((v, k) => v - e26[k])
  const sig = ema(macd, 9)
  const triggers = []
  // EMA 12/26 cross
  if (e12[i - 1] <= e26[i - 1] && e12[i] > e26[i]) triggers.push({ name: 'EMA12-26', direction: 'long' })
  if (e12[i - 1] >= e26[i - 1] && e12[i] < e26[i]) triggers.push({ name: 'EMA12-26', direction: 'short' })
  // MACD-signal cross
  const h = macd[i] - sig[i]
  const hPrev = macd[i - 1] - sig[i - 1]
  if (hPrev <= 0 && h > 0) triggers.push({ name: 'MACD', direction: 'long' })
  if (hPrev >= 0 && h < 0) triggers.push({ name: 'MACD', direction: 'short' })
  // RSI reclaim
  if (r[i - 1] < 30 && r[i] >= 30) triggers.push({ name: 'RSI', direction: 'long' })
  if (r[i - 1] > 70 && r[i] <= 70) triggers.push({ name: 'RSI', direction: 'short' })
  // EMA-50 break
  if (c[i - 1].close <= e50[i - 1] && c[i].close > e50[i]) triggers.push({ name: 'EMA50', direction: 'long' })
  if (c[i - 1].close >= e50[i - 1] && c[i].close < e50[i]) triggers.push({ name: 'EMA50', direction: 'short' })
  // Volume spike — only attached if another trigger same bar (matches volSpike "confirm only")
  if (i >= 20 && triggers.length > 0) {
    let v = 0
    for (let j = i - 19; j <= i; j++) v += c[j].volume
    const avg20 = v / 20
    if (avg20 > 0 && c[i].volume >= 2 * avg20) {
      triggers.push({ name: 'VolSpike', direction: triggers[0].direction })
    }
  }
  return triggers
}

// ── gate functions: each returns true if the gate WOULD BLOCK the entry ──
const GATES = {
  'regime-ranging': (ctx) => {
    const reg = regimeAt(ctx.candles, ctx.idx)
    return reg.regime === 'ranging' && reg.strength >= 0.5 && ctx.triggers.length < 2
  },
  'atr-extreme': (ctx) => {
    const a = ctx.atr[ctx.idx]
    const p = ctx.candles[ctx.idx].close
    if (a <= 0 || p <= 0) return true
    const pct = (a / p) * 100
    return pct < 0.3 || pct > 5
  },
  'mtf-veto': (ctx) => {
    if (ctx.dir !== 'long') return false
    if (ctx.triggers.length !== 1) return false
    const m = mtfAt(ctx.candles, ctx.idx)
    return m.longConfluenceCount === 0
  },
  'trend-filtered': (ctx) => {
    if (ctx.dir !== 'long') return false
    return trendDownAt(ctx.candles, ctx.idx)
  },
  cooldown: (ctx) => {
    if (!ctx.lastEntryAt) return false
    const ts = ctx.candles[ctx.idx].timestamp
    return ts - ctx.lastEntryAt < COOLDOWN_HOURS * 3600_000
  },
  'session-gate': (ctx) => {
    const ts = ctx.candles[ctx.idx].timestamp
    const utcH = new Date(ts).getUTCHours()
    const dubaiH = (utcH + 4) % 24
    const inAsiaChop = dubaiH >= 2 && dubaiH < 9
    if (!inAsiaChop) return false
    // Conviction approximated as 70 (single-trigger default — never overrides
    // the 90 threshold). triggers>=3 confluence override applies.
    return ctx.triggers.length < 3
  },
  'duplicate-signal': (ctx) => {
    if (!ctx.lastSameDirAt) return false
    const ts = ctx.candles[ctx.idx].timestamp
    return ts - ctx.lastSameDirAt < DUP_HOURS * 3600_000
  },
  'long-only-mode': (ctx) => ctx.dir === 'short',
}

const ALL_GATES = Object.keys(GATES)

function runStrategy(symData, activeGates) {
  const allTrades = []
  for (const sym of Object.keys(symData)) {
    const c = symData[sym]
    if (c.length < 200) continue
    const atr = atrSeries(c, 14)
    let lastEntryAt = null
    let lastLongAt = null, lastShortAt = null
    for (let i = 50; i < c.length - 1; i++) {
      const triggers = detectAllTriggersAt(c, i, atr)
      if (triggers.length === 0) continue
      // Use first (highest-priority) trigger to define direction
      const dir = triggers[0].direction
      const ctx = {
        candles: c, idx: i, triggers, dir, atr,
        lastEntryAt,
        lastSameDirAt: dir === 'long' ? lastLongAt : lastShortAt,
      }
      // Apply active gates — if ANY blocks, skip
      let blocked = false
      for (const g of activeGates) if (GATES[g](ctx)) { blocked = true; break }
      if (blocked) continue
      // Simulate trade
      if (atr[i] === 0) continue
      const entry = c[i].close
      const slDist = SL_ATR * atr[i]
      const tpDist = TP_ATR * atr[i]
      const sl = dir === 'long' ? entry - slDist : entry + slDist
      const tp = dir === 'long' ? entry + tpDist : entry - tpDist
      let outcome = null
      for (let j = i + 1; j < Math.min(c.length, i + 1 + MAX_HOLD); j++) {
        if (dir === 'long') {
          if (c[j].low <= sl) { outcome = -1; break }
          if (c[j].high >= tp) { outcome = TP_ATR / SL_ATR; break }
        } else {
          if (c[j].high >= sl) { outcome = -1; break }
          if (c[j].low <= tp) { outcome = TP_ATR / SL_ATR; break }
        }
      }
      if (outcome === null) {
        const exit = c[Math.min(c.length - 1, i + MAX_HOLD)].close
        outcome = dir === 'long' ? (exit - entry) / slDist : (entry - exit) / slDist
      }
      allTrades.push({ r: outcome, dir })
      lastEntryAt = c[i].timestamp
      if (dir === 'long') lastLongAt = c[i].timestamp; else lastShortAt = c[i].timestamp
    }
  }
  return allTrades
}

function summarise(trades) {
  if (!trades.length) return { n: 0, wr: 0, expR: 0 }
  return { n: trades.length, wr: trades.filter(t => t.r > 0).length / trades.length, expR: trades.reduce((s, t) => s + t.r, 0) / trades.length }
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

  console.log('\nPER-GATE IMPACT STUDY — 5-fold WF, 365d real data')
  console.log(`Interval: ${INTERVAL}  (${HOURS_PER_BAR}h per bar)`)
  console.log(`Triggers: EMA12-26, MACD, RSI, EMA50, VolSpike (BB-squeeze permanently disabled)`)
  console.log(`Stops: SL=${SL_ATR}*ATR  TP=${TP_ATR}*ATR  MaxHold=${MAX_HOLD} bars (~${MAX_HOLD * HOURS_PER_BAR}h)`)
  console.log(`Cooldown / dup-window: ${COOLDOWN_HOURS}h\n`)

  // Pre-load OOS test windows
  const foldData = []
  for (const f of folds) {
    const d = {}
    for (const sym of INSTRUMENTS) d[sym] = await fetchCandles(sym, dayBack(f.testStart), dayBack(f.testEnd))
    foldData.push(d)
  }
  // Helper: run a strategy across all 5 folds, concat trades
  const runCombined = (activeGates) => {
    const combined = []
    for (const d of foldData) combined.push(...runStrategy(d, activeGates))
    return summarise(combined)
  }

  // ── headline: NO-GATES vs ALL-GATES ──
  const noGates = runCombined([])
  const allGates = runCombined(ALL_GATES)

  console.log('━━━ BASELINES ━━━')
  console.log(`NO GATES         n=${String(noGates.n).padStart(6)}   WR=${(noGates.wr*100).toFixed(1).padStart(4)}%   Exp/R=${(noGates.expR>=0?'+':'')}${noGates.expR.toFixed(3)}`)
  console.log(`ALL GATES ON     n=${String(allGates.n).padStart(6)}   WR=${(allGates.wr*100).toFixed(1).padStart(4)}%   Exp/R=${(allGates.expR>=0?'+':'')}${allGates.expR.toFixed(3)}`)
  const totalGap = allGates.expR - noGates.expR
  console.log(`Gap (ALL - NONE):  ${(totalGap>=0?'+':'')}${totalGap.toFixed(3)} R/trade   (positive = gates net helpful, negative = net harmful)`)

  // ── per-gate: leave-one-out ──
  console.log('\n━━━ PER-GATE LEAVE-ONE-OUT (Δ = ExpR(without G) − ExpR(all on); positive Δ = G is harmful) ━━━')
  console.log('Gate                         n change   ExpR without G   Δ ExpR     Δ n      Verdict')
  console.log('---------------------------------------------------------------------------------------')
  const rows = []
  for (const g of ALL_GATES) {
    const without = ALL_GATES.filter(x => x !== g)
    const r = runCombined(without)
    const delta = r.expR - allGates.expR
    const dn = r.n - allGates.n
    rows.push({ gate: g, n: r.n, expR: r.expR, delta, dn })
  }
  rows.sort((a, b) => b.delta - a.delta)
  for (const r of rows) {
    const verdict = r.delta >= 0.020 ? 'HARMFUL — relax/remove' : r.delta <= -0.020 ? 'HELPFUL — keep' : 'neutral'
    const dExp = (r.delta >= 0 ? '+' : '') + r.delta.toFixed(3)
    const dN = (r.dn >= 0 ? '+' : '') + r.dn
    const expR = (r.expR >= 0 ? '+' : '') + r.expR.toFixed(3)
    console.log(`${r.gate.padEnd(28)}    ${String(r.n).padStart(5)}     ${expR.padStart(7)}      ${dExp.padStart(7)}    ${dN.padStart(6)}     ${verdict}`)
  }

  // ── solo: each gate alone vs no-gates ──
  console.log('\n━━━ SOLO IMPACT (each gate ON, all others OFF; Δ = ExpR(solo) − ExpR(no-gates)) ━━━')
  console.log('Gate                         n         ExpR solo        Δ ExpR     Δ n      Verdict (vs NO-GATES)')
  console.log('---------------------------------------------------------------------------------------')
  const soloRows = []
  for (const g of ALL_GATES) {
    const r = runCombined([g])
    const delta = r.expR - noGates.expR
    const dn = r.n - noGates.n
    soloRows.push({ gate: g, n: r.n, expR: r.expR, delta, dn })
  }
  soloRows.sort((a, b) => b.delta - a.delta)
  for (const r of soloRows) {
    const verdict = r.delta >= 0.020 ? 'HELPFUL solo' : r.delta <= -0.020 ? 'HARMFUL solo' : 'neutral solo'
    const dExp = (r.delta >= 0 ? '+' : '') + r.delta.toFixed(3)
    const dN = (r.dn >= 0 ? '+' : '') + r.dn
    const expR = (r.expR >= 0 ? '+' : '') + r.expR.toFixed(3)
    console.log(`${r.gate.padEnd(28)}    ${String(r.n).padStart(5)}     ${expR.padStart(7)}      ${dExp.padStart(7)}    ${dN.padStart(6)}     ${verdict}`)
  }

  // ── optimal-subset search: brute-force every subset that REQUIRES long-only ──
  // (workspace rule forbids shorts; we don't allow long-only-mode to be off in
  // any candidate config no matter what the backtest says.)
  console.log('\n━━━ OPTIMAL-SUBSET SEARCH (long-only-mode FORCED ON per workspace rule) ━━━')
  const optionalGates = ALL_GATES.filter(g => g !== 'long-only-mode')
  const subsets = []
  const n = optionalGates.length
  for (let mask = 0; mask < (1 << n); mask++) {
    const set = ['long-only-mode']
    for (let i = 0; i < n; i++) if (mask & (1 << i)) set.push(optionalGates[i])
    subsets.push(set)
  }
  const subsetResults = []
  for (const set of subsets) {
    const r = runCombined(set)
    subsetResults.push({ gates: set, ...r })
  }
  subsetResults.sort((a, b) => b.expR - a.expR)
  // We want enough trade volume to be statistically meaningful (n>=200)
  const viable = subsetResults.filter(r => r.n >= 200).slice(0, 8)
  console.log('Top configs by ExpR (n>=200):')
  console.log('Rank  n      WR      ExpR      Gates active (excluding long-only-mode, always on)')
  console.log('--------------------------------------------------------------------------------')
  for (let i = 0; i < viable.length; i++) {
    const r = viable[i]
    const others = r.gates.filter(g => g !== 'long-only-mode')
    const gateLabel = others.length === 0 ? '(none — long-only only)' : others.join(', ')
    const expR = (r.expR >= 0 ? '+' : '') + r.expR.toFixed(3)
    console.log(`${String(i+1).padStart(3)}   ${String(r.n).padStart(5)}   ${(r.wr*100).toFixed(1).padStart(4)}%   ${expR.padStart(7)}   ${gateLabel}`)
  }

  // ── recommendations ──
  console.log('\n━━━ RECOMMENDATIONS ━━━')
  const harmful = rows.filter(r => r.delta >= 0.020)
  const neutral = rows.filter(r => Math.abs(r.delta) < 0.020)
  const helpful = rows.filter(r => r.delta <= -0.020)
  if (harmful.length) {
    console.log('\nREMOVE / RELAX (each blocks more winners than losers):')
    for (const r of harmful) console.log(`  ${r.gate}  →  removing it lifts ExpR by ${r.delta>=0?'+':''}${r.delta.toFixed(3)} R/trade and adds ${r.dn} trades`)
  }
  if (neutral.length) {
    console.log('\nKEEP / NEUTRAL (no material expectancy impact, may have other reasons to keep e.g. risk control):')
    for (const r of neutral) console.log(`  ${r.gate}  →  Δ ${r.delta>=0?'+':''}${r.delta.toFixed(3)} R/trade`)
  }
  if (helpful.length) {
    console.log('\nKEEP — net-positive (rejecting these correctly removes more losers than winners):')
    for (const r of helpful) console.log(`  ${r.gate}  →  removing it would COST ${r.delta.toFixed(3)} R/trade`)
  }

  console.log('\n[end]')
}

main().catch(e => { console.error(e); process.exit(1) })
