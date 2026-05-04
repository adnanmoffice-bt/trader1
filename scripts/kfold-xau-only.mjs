#!/usr/bin/env node
// XAU/USD-only run of the per-gate study. After backfilling 365d of
// PAXGUSDT 1H candles, we want to know: does the trigger family +
// gate stack work for gold the same way it works for crypto?
//
// Modifications vs kfold-per-gate-impact.mjs:
//   - INSTRUMENTS = ['XAU/USD'] only
//   - Fee adjustment: subtract 0.30% (= ~10% of avg 0.33% ATR move) per
//     trade to reflect PAXGUSDT round-trip slippage. This is the most
//     conservative correction we can make without spread quotes.
//   - Both raw (no fee) and fee-adjusted Exp/R reported side by side.

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

const SL_ATR = 2.0
const TP_ATR = 3.0
const MAX_HOLD = 48
// PAXGUSDT round-trip slippage estimate: 0.10% spread + 0.05% Binance taker
// fee × 2 sides = 0.20% round-trip. In R-multiple terms: at avg ATR=0.33% of
// price, SL distance = 2×ATR = 0.66% of price. So 0.20% slippage =
// 0.20/0.66 = 0.30 R per round trip. Subtracted from every closed trade.
const FEE_R_PAXG = 0.30

async function fetchCandles(symbol) {
  const all = []
  let offset = 0
  while (true) {
    const url = `${URL_}/rest/v1/price_history?symbol=eq.${encodeURIComponent(symbol)}&interval=eq.1h&order=timestamp.asc&limit=1000&offset=${offset}&select=timestamp,open,high,low,close,volume`
    const r = await fetch(url, { headers })
    const rows = await r.json()
    if (!Array.isArray(rows) || rows.length === 0) break
    all.push(...rows)
    if (rows.length < 1000) break
    offset += 1000
  }
  return all.map(x => ({ ts: new Date(x.timestamp).getTime(), open: +x.open, high: +x.high, low: +x.low, close: +x.close, volume: +x.volume }))
}

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
function mtfAt(c, i) {
  if (i < 200) return { longConfluenceCount: 0 }
  const win = c.slice(i - 199, i + 1)
  const trend = (window) => {
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
      out.push({ open: chunk[0].open, high: Math.max(...chunk.map(x => x.high)), low: Math.min(...chunk.map(x => x.low)), close: chunk.at(-1).close })
    }
    return out
  }
  const t4 = trend(aggregate(win, 4))
  const t1d = trend(aggregate(win, 24))
  const longCount = (t4 === 'up' ? 1 : 0) + (t1d === 'up' ? 1 : 0)
  return { longConfluenceCount: longCount }
}
function trendDownAt(c, i) {
  if (i < 60) return false
  const closes = c.slice(0, i + 1).map(x => x.close)
  const e50 = ema(closes, 50)
  return e50.at(-1) < (e50.at(-9) ?? e50.at(-1))
}

function detectAllTriggersAt(c, i) {
  if (i < 50) return []
  const closes = c.slice(0, i + 1).map(x => x.close)
  const e12 = ema(closes, 12)
  const e26 = ema(closes, 26)
  const e50 = ema(closes, 50)
  const r = rsiSeries(closes, 14)
  const macd = e12.map((v, k) => v - e26[k])
  const sig = ema(macd, 9)
  const triggers = []
  if (e12[i - 1] <= e26[i - 1] && e12[i] > e26[i]) triggers.push({ name: 'EMA12-26', direction: 'long' })
  if (e12[i - 1] >= e26[i - 1] && e12[i] < e26[i]) triggers.push({ name: 'EMA12-26', direction: 'short' })
  const h = macd[i] - sig[i]
  const hPrev = macd[i - 1] - sig[i - 1]
  if (hPrev <= 0 && h > 0) triggers.push({ name: 'MACD', direction: 'long' })
  if (hPrev >= 0 && h < 0) triggers.push({ name: 'MACD', direction: 'short' })
  if (r[i - 1] < 30 && r[i] >= 30) triggers.push({ name: 'RSI', direction: 'long' })
  if (r[i - 1] > 70 && r[i] <= 70) triggers.push({ name: 'RSI', direction: 'short' })
  if (c[i - 1].close <= e50[i - 1] && c[i].close > e50[i]) triggers.push({ name: 'EMA50', direction: 'long' })
  if (c[i - 1].close >= e50[i - 1] && c[i].close < e50[i]) triggers.push({ name: 'EMA50', direction: 'short' })
  return triggers
}

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
    return mtfAt(ctx.candles, ctx.idx).longConfluenceCount === 0
  },
  'trend-filtered': (ctx) => ctx.dir === 'long' && trendDownAt(ctx.candles, ctx.idx),
  'long-only-mode': (ctx) => ctx.dir === 'short',
}

function runStrategy(c, atr, activeGates) {
  const trades = []
  for (let i = 50; i < c.length - 1; i++) {
    const triggers = detectAllTriggersAt(c, i)
    if (triggers.length === 0) continue
    const dir = triggers[0].direction
    const ctx = { candles: c, idx: i, triggers, dir, atr }
    let blocked = false
    for (const g of activeGates) if (GATES[g](ctx)) { blocked = true; break }
    if (blocked) continue
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
    trades.push({ r: outcome, dir })
  }
  return trades
}

function summarise(trades, feeR = 0) {
  if (!trades.length) return { n: 0, wr: 0, expR: 0, expRfee: 0 }
  const sumR = trades.reduce((s, t) => s + t.r, 0)
  return {
    n: trades.length,
    wr: trades.filter(t => t.r > 0).length / trades.length,
    expR: sumR / trades.length,
    expRfee: (sumR / trades.length) - feeR,
  }
}

async function main() {
  const c = await fetchCandles('XAU/USD')
  const cBtc = await fetchCandles('BTC/USD')
  const atr = atrSeries(c, 14)
  const atrBtc = atrSeries(cBtc, 14)
  console.log(`\nXAU/USD per-gate study — 365d, fee adjustment ${FEE_R_PAXG}R per round trip`)
  console.log(`(BTC/USD shown for comparison; BTC fees ~0.06R round-trip ignored)\n`)
  console.log('Strategy                       n      WR      Exp/R    Exp/R-fee   (BTC: n      WR      Exp/R)')
  console.log('---------------------------------------------------------------------------------------------')
  const strategies = [
    { name: 'NO GATES', gates: [] },
    { name: 'long-only-mode (rule)', gates: ['long-only-mode'] },
    { name: 'long-only + trend-filtered', gates: ['long-only-mode', 'trend-filtered'] },
    { name: 'long-only + mtf-veto', gates: ['long-only-mode', 'mtf-veto'] },
    { name: 'long-only + trend + mtf', gates: ['long-only-mode', 'trend-filtered', 'mtf-veto'] },
    { name: 'long-only + atr-extreme', gates: ['long-only-mode', 'atr-extreme'] },
    { name: 'long-only + regime-ranging', gates: ['long-only-mode', 'regime-ranging'] },
    { name: 'CURRENT WAR-ROOM (~all)', gates: ['long-only-mode', 'trend-filtered', 'mtf-veto', 'atr-extreme'] },
  ]
  for (const s of strategies) {
    const xauT = runStrategy(c, atr, s.gates)
    const btcT = runStrategy(cBtc, atrBtc, s.gates)
    const xau = summarise(xauT, FEE_R_PAXG)
    const btc = summarise(btcT, 0.06)
    const xauExp = (xau.expR >= 0 ? '+' : '') + xau.expR.toFixed(3)
    const xauFee = (xau.expRfee >= 0 ? '+' : '') + xau.expRfee.toFixed(3)
    const btcExp = (btc.expR >= 0 ? '+' : '') + btc.expR.toFixed(3)
    console.log(`${s.name.padEnd(30)} ${String(xau.n).padStart(5)}   ${(xau.wr*100).toFixed(1).padStart(4)}%   ${xauExp.padStart(7)}    ${xauFee.padStart(7)}    (${String(btc.n).padStart(4)}   ${(btc.wr*100).toFixed(1).padStart(4)}%   ${btcExp.padStart(7)})`)
  }
  console.log('\n[end]')
}

main().catch(e => { console.error(e); process.exit(1) })
