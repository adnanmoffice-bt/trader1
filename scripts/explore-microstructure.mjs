#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// PHASE D — Microstructure exploration script
//
// Pulls 90 days of 1H candles per instrument from price_history and walks the
// new microstructure primitives (FVG, Order Blocks, Liquidity Sweeps,
// Structure) forward in time. For each "trigger event" it simulates a fixed
// SL/TP exit (2.0 ATR / 3.0 ATR — same params as the live backtest) and
// reports per-trigger expectancy.
//
// Read this as: "if I had only used <pattern> as the trigger, what would my
// 90-day expectancy have been?". The point is to find a single primitive
// that produces >0.20 R/trade as a starting point for replacing the current
// indicator-only triggers.
//
// Usage:  node scripts/explore-microstructure.mjs [days]
//   days = lookback window (default 90)
//
// Output:  console table per trigger family + a writeup summary at the end.
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

const DAYS = parseInt(process.argv[2] ?? '90', 10)
const INSTRUMENTS = ['BTC/USD', 'ETH/USD', 'XAU/USD', 'DOGE/USD', 'AVAX/USD', 'LINK/USD', 'ADA/USD', 'DOT/USD', 'MATIC/USD', 'NEAR/USD', 'APT/USD']
const SL_ATR = 2.0
const TP_ATR = 3.0
const MAX_HOLD_BARS = 48

// ── Microstructure primitives (mirrored from lib/microstructure.ts in JS) ──
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

function detectSwings(c, k = 3) {
  const out = []
  for (let i = k; i < c.length - k; i++) {
    const w = c.slice(i - k, i + k + 1)
    if (w.every(x => x.high <= c[i].high) && w.some(x => x.high < c[i].high)) out.push({ idx: i, type: 'high', price: c[i].high })
    if (w.every(x => x.low >= c[i].low) && w.some(x => x.low > c[i].low)) out.push({ idx: i, type: 'low', price: c[i].low })
  }
  return out
}

// Trigger detectors. Each returns array of { idx, direction, label, slMultOverride? }.
// Triggers always direction-positive in name; SL/TP applied symmetrically.

function triggers_FVG(c, atr) {
  const out = []
  for (let i = 2; i < c.length - 1; i++) {
    const a = c[i - 2], cc = c[i]
    if (a.high < cc.low && i + 1 < c.length) out.push({ idx: i + 1, direction: 'long', label: 'FVG-bullish-form' })
    if (a.low > cc.high && i + 1 < c.length) out.push({ idx: i + 1, direction: 'short', label: 'FVG-bearish-form' })
  }
  return out
}

function triggers_OrderBlockMitigation(c, atr) {
  const out = []
  // Find OBs first
  const obs = []
  for (let i = 15; i < c.length - 6; i++) {
    if (atr[i] === 0) continue
    const fwdHigh = Math.max(...c.slice(i + 1, i + 6).map(x => x.high))
    const fwdLow = Math.min(...c.slice(i + 1, i + 6).map(x => x.low))
    const upMove = fwdHigh - c[i].close
    const downMove = c[i].close - fwdLow
    const priorHigh = Math.max(...c.slice(Math.max(0, i - 10), i).map(x => x.high))
    const priorLow = Math.min(...c.slice(Math.max(0, i - 10), i).map(x => x.low))
    const isBear = c[i].close < c[i].open
    const isBull = c[i].close > c[i].open
    if (isBear && upMove >= 1.5 * atr[i] && fwdHigh > priorHigh) obs.push({ idx: i, type: 'bullish', top: c[i].open, bottom: c[i].low })
    if (isBull && downMove >= 1.5 * atr[i] && fwdLow < priorLow) obs.push({ idx: i, type: 'bearish', top: c[i].high, bottom: c[i].open })
  }
  // Trigger fires when price returns to OB zone for the first time
  for (const ob of obs) {
    for (let j = ob.idx + 6; j < c.length; j++) {
      if (c[j].low <= ob.top && c[j].high >= ob.bottom) {
        out.push({ idx: j, direction: ob.type === 'bullish' ? 'long' : 'short', label: `OB-${ob.type}-mitigation` })
        break
      }
    }
  }
  return out
}

function triggers_LiquiditySweep(c, atr, lookback = 20) {
  const out = []
  for (let i = lookback + 1; i < c.length; i++) {
    const prior = c.slice(i - lookback, i)
    const recentHigh = Math.max(...prior.map(x => x.high))
    const recentLow = Math.min(...prior.map(x => x.low))
    if (c[i].high > recentHigh && c[i].close < recentHigh) out.push({ idx: i, direction: 'short', label: 'Sweep-of-high' })
    if (c[i].low < recentLow && c[i].close > recentLow) out.push({ idx: i, direction: 'long', label: 'Sweep-of-low' })
  }
  return out
}

function triggers_StructureFlip(c) {
  const out = []
  const swings = detectSwings(c, 3)
  if (swings.length < 4) return out
  for (let s = 3; s < swings.length; s++) {
    const recent = swings.slice(s - 3, s + 1)
    const dirs = recent.map(x => x.type).join('-')
    // High-low-high-low descending => CHOCH down
    if (dirs === 'high-low-high-low' && recent[3].price < recent[1].price) {
      const idx = recent[3].idx + 1
      if (idx < c.length) out.push({ idx, direction: 'short', label: 'CHOCH-down' })
    }
    if (dirs === 'low-high-low-high' && recent[3].price > recent[1].price) {
      const idx = recent[3].idx + 1
      if (idx < c.length) out.push({ idx, direction: 'long', label: 'CHOCH-up' })
    }
  }
  return out
}

function triggers_FVGFill(c) {
  // When an unfilled bullish FVG is touched (filled) — this is the
  // canonical SMC long entry. Symmetrical for bearish.
  const out = []
  const fvgs = []
  for (let i = 2; i < c.length; i++) {
    const a = c[i - 2], cc = c[i]
    if (a.high < cc.low) fvgs.push({ formedAt: i, type: 'bullish', top: cc.low, bottom: a.high, filled: false })
    if (a.low > cc.high) fvgs.push({ formedAt: i, type: 'bearish', top: a.low, bottom: cc.high, filled: false })
  }
  for (const fvg of fvgs) {
    for (let j = fvg.formedAt + 1; j < c.length; j++) {
      if (fvg.type === 'bullish' && c[j].low <= fvg.bottom) {
        out.push({ idx: j, direction: 'long', label: 'FVG-bullish-fill' })
        break
      }
      if (fvg.type === 'bearish' && c[j].high >= fvg.top) {
        out.push({ idx: j, direction: 'short', label: 'FVG-bearish-fill' })
        break
      }
    }
  }
  return out
}

// ── Forward-test a list of triggers ──
function simulate(candles, atr, triggers) {
  const trades = []
  for (const t of triggers) {
    if (t.idx >= candles.length - 1) continue
    if (atr[t.idx] === 0) continue
    const entry = candles[t.idx].close
    const a = atr[t.idx]
    const sl = t.direction === 'long' ? entry - SL_ATR * a : entry + SL_ATR * a
    const tp = t.direction === 'long' ? entry + TP_ATR * a : entry - TP_ATR * a
    let outcome = null
    let bars = 0
    for (let j = t.idx + 1; j < Math.min(candles.length, t.idx + 1 + MAX_HOLD_BARS); j++) {
      bars = j - t.idx
      if (t.direction === 'long') {
        if (candles[j].low <= sl) { outcome = -1; break }
        if (candles[j].high >= tp) { outcome = TP_ATR / SL_ATR; break }
      } else {
        if (candles[j].high >= sl) { outcome = -1; break }
        if (candles[j].low <= tp) { outcome = TP_ATR / SL_ATR; break }
      }
    }
    if (outcome === null) {
      const exit = candles[Math.min(candles.length - 1, t.idx + MAX_HOLD_BARS)].close
      const r = t.direction === 'long' ? (exit - entry) / (entry - sl) : (entry - exit) / (sl - entry)
      outcome = r
    }
    trades.push({ label: t.label, direction: t.direction, r: outcome, bars })
  }
  return trades
}

function summarise(label, trades) {
  if (!trades.length) return { label, n: 0 }
  const wins = trades.filter(t => t.r > 0)
  const winRate = wins.length / trades.length
  const totalR = trades.reduce((s, t) => s + t.r, 0)
  const expR = totalR / trades.length
  const stddev = Math.sqrt(trades.reduce((s, t) => s + (t.r - expR) ** 2, 0) / trades.length)
  return { label, n: trades.length, winRate, expR, totalR, stddev }
}

async function main() {
  const since = new Date(Date.now() - DAYS * 86400_000).toISOString()
  const all = {}
  for (const sym of INSTRUMENTS) {
    const data = await fetchCandles(sym, since)
    if (!data || data.length < 100) { console.warn(`[${sym}] only ${data?.length ?? 0} candles, skipping`); continue }
    all[sym] = data.map(x => ({ open: +x.open, high: +x.high, low: +x.low, close: +x.close, volume: +x.volume }))
  }

  console.log(`\n═══════════════════════════════════════════════════════════════════════════════`)
  console.log(` MICROSTRUCTURE EXPLORATION — ${DAYS}d, SL=${SL_ATR}ATR, TP=${TP_ATR}ATR, MAX_HOLD=${MAX_HOLD_BARS}h`)
  console.log(` Capital model: 1.5% risk/trade ($75/R on $5k); breakeven = +0.0R/trade.`)
  console.log(`═══════════════════════════════════════════════════════════════════════════════\n`)

  const families = {
    'FVG-form': triggers_FVG,
    'FVG-fill (canonical SMC entry)': triggers_FVGFill,
    'Order-Block-mitigation': triggers_OrderBlockMitigation,
    'Liquidity-Sweep': triggers_LiquiditySweep,
    'Structure-Flip (CHOCH)': triggers_StructureFlip,
  }

  const grand = {}
  for (const [famName, fn] of Object.entries(families)) {
    grand[famName] = []
    for (const sym of Object.keys(all)) {
      const c = all[sym]
      const a = atrSeries(c, 14)
      const t = fn(c, a)
      const trades = simulate(c, a, t)
      grand[famName].push(...trades.map(x => ({ ...x, sym })))
    }
  }

  // Per-family summary
  console.log('━━━ PER-FAMILY EXPECTANCY ━━━')
  console.log('Family                                      N      WR        Exp/R     Total R')
  console.log('-------------------------------------------------------------------------------')
  for (const [famName, trades] of Object.entries(grand)) {
    const s = summarise(famName, trades)
    if (s.n === 0) { console.log(`${famName.padEnd(40)}    0      —         —         —`); continue }
    const wrPct = (s.winRate * 100).toFixed(1) + '%'
    const expR = (s.expR >= 0 ? '+' : '') + s.expR.toFixed(3)
    const totR = (s.totalR >= 0 ? '+' : '') + s.totalR.toFixed(1)
    console.log(`${famName.padEnd(40)}${String(s.n).padStart(6)}  ${wrPct.padStart(6)}    ${expR.padStart(7)}   ${totR.padStart(8)}`)
  }
  console.log()

  // Per-(family, instrument) breakdown for the top-2 families
  const byExp = Object.entries(grand)
    .map(([k, v]) => ({ k, s: summarise(k, v) }))
    .filter(x => x.s.n >= 30)
    .sort((a, b) => (b.s.expR ?? -99) - (a.s.expR ?? -99))
  if (byExp.length > 0) {
    const top = byExp.slice(0, 2)
    for (const { k } of top) {
      console.log(`━━━ ${k} — per-instrument ━━━`)
      console.log('Instrument        N      WR        Exp/R     Total R')
      console.log('---------------------------------------------------')
      const bySym = {}
      for (const t of grand[k]) {
        if (!bySym[t.sym]) bySym[t.sym] = []
        bySym[t.sym].push(t)
      }
      for (const sym of Object.keys(bySym).sort()) {
        const s = summarise(sym, bySym[sym])
        if (s.n === 0) continue
        const wrPct = (s.winRate * 100).toFixed(1) + '%'
        const expR = (s.expR >= 0 ? '+' : '') + s.expR.toFixed(3)
        const totR = (s.totalR >= 0 ? '+' : '') + s.totalR.toFixed(1)
        console.log(`${sym.padEnd(15)}${String(s.n).padStart(5)}  ${wrPct.padStart(6)}    ${expR.padStart(7)}   ${totR.padStart(8)}`)
      }
      console.log()
    }
  }

  console.log('━━━ INTERPRETATION KEY ━━━')
  console.log(' Exp/R > +0.20 = candidate trigger (worth wiring into war-room behind a gate).')
  console.log(' Exp/R > +0.10 = marginal; combine with another trigger / regime filter.')
  console.log(' Exp/R near 0  = no edge alone, but may add value as a filter on the OTHER side.')
  console.log(' Exp/R < -0.10 = trap pattern. Useful as an INVERTED filter (block long when it fires bearish).')
  console.log()
}

main().catch(e => { console.error(e); process.exit(1) })
