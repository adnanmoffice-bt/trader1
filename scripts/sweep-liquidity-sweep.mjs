#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// PHASE D — Liquidity-Sweep parameter sweep
//
// First exploration (scripts/explore-microstructure.mjs) found Liquidity Sweep
// to be the only +EV microstructure primitive on the current instrument set
// (+0.101 R/trade across 1122 trades, 90d). This script sweeps:
//   - lookback (10 / 20 / 40 bars)
//   - SL multiplier (1.5 / 2.0 / 2.5 ATR)
//   - TP multiplier (1.5 / 2.0 / 3.0 / 4.0 ATR)
//   - confirmation filter ON/OFF (require swept candle to close back inside
//     by >= 25% of its range)
//
// Goal: find a parameter set with >0.20 R/trade expectancy and >300 trades
// across the 11 instruments — that becomes the candidate Phase D trigger.
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

const DAYS = parseInt(process.argv[2] ?? '180', 10)
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
    trades.push({ r: outcome, dir: t.dir })
  }
  return trades
}

function summarise(trades) {
  if (!trades.length) return { n: 0, wr: 0, expR: 0, totalR: 0 }
  const wins = trades.filter(t => t.r > 0)
  return { n: trades.length, wr: wins.length / trades.length, expR: trades.reduce((s, t) => s + t.r, 0) / trades.length, totalR: trades.reduce((s, t) => s + t.r, 0) }
}

async function main() {
  const since = new Date(Date.now() - DAYS * 86400_000).toISOString()
  const all = {}
  for (const sym of INSTRUMENTS) {
    const data = await fetchCandles(sym, since)
    if (!data || data.length < 100) { console.warn(`[${sym}] only ${data?.length ?? 0} candles`); continue }
    all[sym] = data.map(x => ({ open: +x.open, high: +x.high, low: +x.low, close: +x.close, volume: +x.volume }))
  }
  const totalCandles = Object.values(all).reduce((s, c) => s + c.length, 0)
  console.log(`\n${DAYS}d sweep — ${Object.keys(all).length} instruments, ${totalCandles} candles\n`)

  const lookbacks = [10, 20, 40]
  const slMults = [1.5, 2.0, 2.5]
  const tpMults = [1.5, 2.0, 3.0, 4.0]
  const confirmModes = [false, true]

  const rows = []
  for (const lb of lookbacks) {
    for (const sl of slMults) {
      for (const tp of tpMults) {
        for (const cf of confirmModes) {
          const allTrades = []
          for (const sym of Object.keys(all)) {
            const c = all[sym]
            const atr = atrSeries(c, 14)
            const t = detectSweeps(c, lb, cf)
            allTrades.push(...simulate(c, atr, t, sl, tp))
          }
          const s = summarise(allTrades)
          rows.push({ lb, sl, tp, cf, ...s })
        }
      }
    }
  }
  rows.sort((a, b) => b.expR - a.expR)

  console.log('━━━ TOP 15 PARAMETER COMBOS (sorted by Exp/R, ≥200 trades) ━━━')
  console.log('Lookback  SL    TP    Confirm   N     WR       Exp/R     Total R')
  console.log('-----------------------------------------------------------------')
  let printed = 0
  for (const r of rows) {
    if (r.n < 200) continue
    if (printed >= 15) break
    const wr = (r.wr * 100).toFixed(1) + '%'
    const exp = (r.expR >= 0 ? '+' : '') + r.expR.toFixed(3)
    const tot = (r.totalR >= 0 ? '+' : '') + r.totalR.toFixed(1)
    console.log(`${String(r.lb).padStart(8)}   ${r.sl.toFixed(1)}   ${r.tp.toFixed(1)}   ${r.cf ? 'YES' : 'no '}     ${String(r.n).padStart(4)}  ${wr.padStart(6)}    ${exp.padStart(7)}   ${tot.padStart(8)}`)
    printed++
  }

  console.log('\n━━━ BOTTOM 5 (worst combos — confirmation that the sweep direction matters) ━━━')
  console.log('Lookback  SL    TP    Confirm   N     WR       Exp/R     Total R')
  console.log('-----------------------------------------------------------------')
  for (const r of rows.slice().reverse().slice(0, 5)) {
    const wr = (r.wr * 100).toFixed(1) + '%'
    const exp = (r.expR >= 0 ? '+' : '') + r.expR.toFixed(3)
    const tot = (r.totalR >= 0 ? '+' : '') + r.totalR.toFixed(1)
    console.log(`${String(r.lb).padStart(8)}   ${r.sl.toFixed(1)}   ${r.tp.toFixed(1)}   ${r.cf ? 'YES' : 'no '}     ${String(r.n).padStart(4)}  ${wr.padStart(6)}    ${exp.padStart(7)}   ${tot.padStart(8)}`)
  }

  // Best param: per-instrument breakdown
  const best = rows[0]
  console.log(`\n━━━ BEST PARAMS (lookback=${best.lb}, SL=${best.sl}, TP=${best.tp}, confirm=${best.cf}) — per-instrument ━━━`)
  console.log('Instrument         N      WR        Exp/R     Total R')
  console.log('----------------------------------------------------')
  for (const sym of Object.keys(all)) {
    const c = all[sym]
    const atr = atrSeries(c, 14)
    const t = detectSweeps(c, best.lb, best.cf)
    const s = summarise(simulate(c, atr, t, best.sl, best.tp))
    if (s.n === 0) continue
    const wr = (s.wr * 100).toFixed(1) + '%'
    const exp = (s.expR >= 0 ? '+' : '') + s.expR.toFixed(3)
    const tot = (s.totalR >= 0 ? '+' : '') + s.totalR.toFixed(1)
    console.log(`${sym.padEnd(15)}  ${String(s.n).padStart(4)}  ${wr.padStart(6)}    ${exp.padStart(7)}   ${tot.padStart(8)}`)
  }

  // Long vs short split for best params
  const longs = []
  const shorts = []
  for (const sym of Object.keys(all)) {
    const c = all[sym]
    const atr = atrSeries(c, 14)
    const t = detectSweeps(c, best.lb, best.cf)
    const trades = simulate(c, atr, t, best.sl, best.tp)
    longs.push(...trades.filter(x => x.dir === 'long'))
    shorts.push(...trades.filter(x => x.dir === 'short'))
  }
  console.log('\n━━━ Direction breakdown (best params) ━━━')
  const sl_ = summarise(longs); const ss_ = summarise(shorts)
  console.log(`LONG (sweep-of-low)   N=${sl_.n}  WR=${(sl_.wr*100).toFixed(1)}%  Exp/R=${sl_.expR.toFixed(3)}  TotalR=${sl_.totalR.toFixed(1)}`)
  console.log(`SHORT (sweep-of-high) N=${ss_.n}  WR=${(ss_.wr*100).toFixed(1)}%  Exp/R=${ss_.expR.toFixed(3)}  TotalR=${ss_.totalR.toFixed(1)}`)

  console.log('\n[end]')
}

main().catch(e => { console.error(e); process.exit(1) })
