// scripts/backtest-gate-stack.mjs
//
// Walk-forward backtest of the APEX deterministic gate stack against 6 months
// of 1H Binance Spot candles. Read-only — no DB writes, no exchange writes.
//
// What's tested:
//   - 5 trigger detectors (EMA12/26 cross, MACD cross, RSI extreme, EMA50
//     breakout, volume spike). BB squeeze blacklisted to match production.
//   - Long-only (shorts blacklisted to match production).
//   - RANGING regime gate, ATR sanity, MTF confluence, session-of-day gate.
//   - SL = 2.0 ATR, TP1 = 3.0 ATR (= +1.5R). TP2 = 5.0 ATR (= +2.5R).
//   - Correlation dedup (BTC<->ETH hard pair) using simulated portfolio.
//   - Trend filter (use 4H trend as a proxy since we don't have ARIMA in JS).
//
// What's NOT tested (no historical data / non-deterministic / out-of-scope
// for a foundation backtest — these only ADD filters in production, never
// loosen, so the live system should be at least as good as this number):
//   - Derivatives (funding / OI / L:S) — Binance only exposes ~7 days
//   - News-impact veto — no historical RSS archive
//   - CME gap — possible but adds complexity, deferred
//   - On-chain — stub anyway
//   - Macro (VIX / DXY / yield curve / events) — historical data feasible,
//     deferred to v2 of the backtest
//   - Forecast veto (ARIMA + Monte Carlo) — port to JS deferred
//   - 12-agent debate vote margin / orchestrator conviction — non-deterministic
//   - Daily-loss-limit / position-cap / recovery-mode — out of scope for
//     edge measurement (these protect capital, they don't generate edge)
//
// Modes (all 3 run by default for side-by-side comparison):
//   baseline    = old config: TP=4.5 ATR, no new gates
//   filtered    = TP=4.5 ATR + all new deterministic gates (filters only)
//   new         = TP=3.0 ATR + all new deterministic gates (filters + TP change)
//
// Usage:
//   node scripts/backtest-gate-stack.mjs                       (default: 180 days, all 3 modes)
//   node scripts/backtest-gate-stack.mjs --days=90             (90 days)
//   node scripts/backtest-gate-stack.mjs --instruments=BTC,ETH (subset)
//   node scripts/backtest-gate-stack.mjs --sweep               (TP/SL multiplier sweep)

const args = Object.fromEntries(
  process.argv.slice(2).flatMap(a => {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      return [[k, v ?? true]]
    }
    return []
  }),
)

const DAYS = Number(args.days ?? 180)
const SWEEP = !!args.sweep
const INSTRUMENT_FILTER = args.instruments ? String(args.instruments).split(',').map(s => s.trim().toUpperCase()) : null

// Match production ALL_INSTRUMENTS in agents/war-room.ts
const ALL_INSTRUMENTS = [
  ['BTC/USD', 'BTCUSDT'],
  ['ETH/USD', 'ETHUSDT'],
  ['XAU/USD', 'PAXGUSDT'],
  ['DOGE/USD', 'DOGEUSDT'],
  ['AVAX/USD', 'AVAXUSDT'],
  ['LINK/USD', 'LINKUSDT'],
  ['ADA/USD', 'ADAUSDT'],
  ['DOT/USD', 'DOTUSDT'],
  ['MATIC/USD', 'POLUSDT'],
  ['NEAR/USD', 'NEARUSDT'],
  ['APT/USD', 'APTUSDT'],
]

const INSTRUMENTS = INSTRUMENT_FILTER
  ? ALL_INSTRUMENTS.filter(([apex]) => INSTRUMENT_FILTER.includes(apex.split('/')[0]))
  : ALL_INSTRUMENTS

// ─── Binance candle fetch (paginated) ────────────────────────────────────────

async function fetchKlines(symbol, days) {
  const endMs = Date.now()
  const startMs = endMs - days * 24 * 3600 * 1000
  const all = []
  let cursor = startMs
  // Each request = 1000 1H candles ≈ 41.6 days
  while (cursor < endMs) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&startTime=${cursor}&limit=1000`
    const res = await fetch(url, { headers: { 'User-Agent': 'apex-backtest/1.0' } })
    if (!res.ok) throw new Error(`Binance ${symbol} ${res.status}`)
    const rows = await res.json()
    if (!Array.isArray(rows) || rows.length === 0) break
    for (const r of rows) {
      all.push({
        timestamp: r[0],
        open: parseFloat(r[1]),
        high: parseFloat(r[2]),
        low: parseFloat(r[3]),
        close: parseFloat(r[4]),
        volume: parseFloat(r[5]),
      })
    }
    cursor = rows[rows.length - 1][0] + 3_600_000 // next hour
    if (rows.length < 1000) break
  }
  return all
}

// ─── Indicator math (ported from lib/indicators.ts) ──────────────────────────

const avg = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0
const round = (n) => Math.round(n * 100) / 100

function ema(prices, period) {
  const k = 2 / (period + 1)
  const out = [prices[0]]
  for (let i = 1; i < prices.length; i++) out.push(prices[i] * k + out[i - 1] * (1 - k))
  return out
}
const emaLast = (p, n) => ema(p, n).at(-1)

function rsi(prices, period = 14) {
  if (prices.length < period + 1) return NaN
  const ch = prices.slice(1).map((p, i) => p - prices[i])
  const g = ch.map(c => c > 0 ? c : 0)
  const l = ch.map(c => c < 0 ? -c : 0)
  let ag = avg(g.slice(0, period)), al = avg(l.slice(0, period))
  for (let i = period; i < ch.length; i++) {
    ag = (ag * (period - 1) + g[i]) / period
    al = (al * (period - 1) + l[i]) / period
  }
  if (al === 0) return 100
  return 100 - 100 / (1 + ag / al)
}

function atr(candles, period = 14) {
  if (candles.length < period + 1) return 0
  const trs = candles.slice(1).map((c, i) => {
    const prev = candles[i].close
    return Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev))
  })
  let v = avg(trs.slice(0, period))
  for (let i = period; i < trs.length; i++) v = (v * (period - 1) + trs[i]) / period
  return v
}

function bbPercentB(prices, period = 20, mult = 2) {
  const slice = prices.slice(-period)
  const m = avg(slice)
  const sd = Math.sqrt(slice.reduce((s, v) => s + (v - m) ** 2, 0) / slice.length)
  const u = m + mult * sd, l = m - mult * sd
  return l < u ? (prices.at(-1) - l) / (u - l) : 0.5
}

function volumeRatio(candles, period = 20) {
  const vols = candles.map(c => c.volume)
  const a = avg(vols.slice(-period - 1, -1))
  return a > 0 ? vols.at(-1) / a : 1
}

// ─── Trigger detectors ───────────────────────────────────────────────────────

function detectEMACross(candles) {
  if (candles.length < 30) return null
  const c = candles.map(x => x.close)
  const e12 = ema(c, 12), e26 = ema(c, 26)
  const n = c.length - 1
  if (e12[n] > e26[n] && e12[n - 1] <= e26[n - 1]) return 'long'
  if (e12[n] < e26[n] && e12[n - 1] >= e26[n - 1]) return 'short'
  return null
}
function detectMACDCross(candles) {
  if (candles.length < 30) return null
  const c = candles.map(x => x.close)
  const eF = ema(c, 12), eS = ema(c, 26)
  const macdLine = eF.map((v, i) => v - eS[i])
  const sig = ema(macdLine, 9)
  const n = macdLine.length - 1
  if (macdLine[n] > sig[n] && macdLine[n - 1] <= sig[n - 1]) return 'long'
  if (macdLine[n] < sig[n] && macdLine[n - 1] >= sig[n - 1]) return 'short'
  return null
}
function detectRSIExtreme(candles) {
  if (candles.length < 30) return null
  const c = candles.map(x => x.close)
  const r = rsi(c)
  const rPrev = rsi(c.slice(0, -1))
  if (isNaN(r) || isNaN(rPrev)) return null
  if (r <= 25 && rPrev > 25) return 'long'
  if (r >= 75 && rPrev < 75) return 'short'
  return null
}
function detectEMA50Breakout(candles) {
  if (candles.length < 55) return null
  const c = candles.map(x => x.close)
  const e50 = ema(c, 50)
  const n = c.length - 1
  if (c[n] > e50[n] && c[n - 1] <= e50[n - 1]) return 'long'
  if (c[n] < e50[n] && c[n - 1] >= e50[n - 1]) return 'short'
  return null
}
function detectVolumeSpike(candles) {
  if (candles.length < 25) return null
  if (volumeRatio(candles) < 2.5) return null
  const last = candles.at(-1)
  return last.close > last.open ? 'long' : 'short'
}

// ─── Regime + MTF (ported) ───────────────────────────────────────────────────

function detectRegime(candles) {
  if (candles.length < 50) return { regime: 'ranging', strength: 0 }
  const c = candles.map(x => x.close)
  const e20 = emaLast(c, 20), e50 = emaLast(c, 50)
  const r = rsi(c)
  const a = atr(candles)
  const price = c.at(-1)
  const avgPrice = avg(c.slice(-20))
  const volPct = avgPrice > 0 ? a / avgPrice * 100 : 0
  if (volPct > 4) return { regime: 'volatile', strength: Math.min(volPct / 4, 2) }
  const spread = (e20 - e50) / e50 * 100
  const rv = isNaN(r) ? 50 : r
  if (spread > 1 && rv > 50 && price > e20) return { regime: 'trending_up', strength: Math.min(spread / 2, 2) }
  if (spread < -1 && rv < 50 && price < e20) return { regime: 'trending_down', strength: Math.min(Math.abs(spread) / 2, 2) }
  return { regime: 'ranging', strength: Math.max(0, 1 - Math.abs(spread)) }
}

function aggregateCandles(c, factor) {
  const out = []
  for (let i = 0; i + factor <= c.length; i += factor) {
    const ch = c.slice(i, i + factor)
    out.push({
      timestamp: ch[0].timestamp,
      open: ch[0].open,
      high: Math.max(...ch.map(x => x.high)),
      low: Math.min(...ch.map(x => x.low)),
      close: ch.at(-1).close,
      volume: ch.reduce((s, x) => s + x.volume, 0),
    })
  }
  return out
}
function trendOf(candles) {
  if (candles.length < 50) return 'flat'
  const c = candles.map(x => x.close)
  const e20 = emaLast(c, 20), e50 = emaLast(c, 50)
  const price = c.at(-1)
  if (e20 > e50 * 1.002 && price > e20) return 'up'
  if (e20 < e50 * 0.998 && price < e20) return 'down'
  return 'flat'
}
function mtfConfluence(candles1h) {
  const c4h = aggregateCandles(candles1h, 4)
  const c1d = aggregateCandles(candles1h, 24)
  const t4 = trendOf(c4h), t1 = trendOf(c1d)
  return { t4, t1, longCount: (t4 === 'up' ? 1 : 0) + (t1 === 'up' ? 1 : 0) }
}

// ─── Session gate (Dubai hour) ───────────────────────────────────────────────

function dubaiHour(timestamp) {
  return (new Date(timestamp).getUTCHours() + 4) % 24
}
function isAsiaChop(timestamp) {
  const h = dubaiHour(timestamp)
  return h >= 2 && h < 9
}

// ─── Correlation peers (BTC<->ETH hard pair) ─────────────────────────────────

function correlatedPeers(instrument) {
  if (instrument === 'BTC/USD') return ['ETH/USD']
  if (instrument === 'ETH/USD') return ['BTC/USD']
  return []
}

// ─── Per-instrument backtest ─────────────────────────────────────────────────

function backtestInstrument({ apex, candles, mode, openPositions, openLog, opts }) {
  const trades = []
  // mode: 'baseline' (no new gates), 'filtered' (gates ON, TP=4.5), 'new' (gates ON, TP=3.0)
  // 'custom' allows opts to override slMult / tpMult
  const useNewGates = mode !== 'baseline'
  const slMult = opts?.slMult ?? 2.0
  const tpMult = opts?.tpMult ?? (mode === 'new' ? 3.0 : 4.5)
  const lookahead = 10 * 24  // up to 10 days to find resolution

  for (let i = 60; i < candles.length - 1; i++) {
    const window = candles.slice(0, i + 1)
    const last = window.at(-1)
    const price = last.close

    // Triggers
    const triggers = []
    const ec = detectEMACross(window); if (ec) triggers.push({ name: 'EMA 12/26 Cross', dir: ec })
    const mc = detectMACDCross(window); if (mc) triggers.push({ name: 'MACD Crossover', dir: mc })
    const re = detectRSIExtreme(window); if (re) triggers.push({ name: 'RSI Extreme', dir: re })
    const eb = detectEMA50Breakout(window); if (eb) triggers.push({ name: 'EMA 50 Breakout', dir: eb })
    const vs = detectVolumeSpike(window); if (vs) triggers.push({ name: 'Volume Spike', dir: vs })

    // Filter to LONG only (production policy)
    const longs = triggers.filter(t => t.dir === 'long')
    if (longs.length === 0) continue
    const triggerName = longs[0].name
    const triggerCount = longs.length

    // RANGING gate (production: weak ranges allow single STRONG trigger)
    const reg = detectRegime(window)
    const STRONG = ['EMA 12/26 Cross', 'MACD Crossover', 'EMA 50 Breakout']
    const weakRange = reg.regime === 'ranging' && reg.strength < 0.5
    const hasStrong = longs.some(t => STRONG.includes(t.name))
    const allowWeakSingle = weakRange && hasStrong && longs.length >= 1
    if (reg.regime === 'ranging' && longs.length < 2 && !allowWeakSingle) continue

    const a = atr(window)
    if (a <= 0) continue
    const atrPct = (a / price) * 100

    // NEW: ATR sanity gate
    if (useNewGates && (atrPct < 0.3 || atrPct > 5)) continue

    // NEW: MTF veto (single 1H trigger AND both 4H and 1D bearish)
    if (useNewGates && triggerCount === 1) {
      const mtf = mtfConfluence(window)
      if (mtf.longCount === 0) continue
    }

    // NEW: Session gate (block Asia-chop unless 3+ triggers)
    if (useNewGates && isAsiaChop(last.timestamp) && triggerCount < 3) continue

    // Trend filter (production: skip LONG if 4H trend is down — proxy for forecast.smoothedTrend)
    const c4h = aggregateCandles(window, 4)
    if (c4h.length >= 50 && trendOf(c4h) === 'down') continue

    // NEW: correlation dedup (BTC<->ETH only)
    if (useNewGates) {
      const peers = correlatedPeers(apex)
      // Check if any peer has an open same-direction position
      const peerOpenLong = peers.some(p => openPositions.has(p))
      // Also: if a same-dir trade was opened in the last 4 hours on a peer
      const fourHoursAgo = last.timestamp - 4 * 3600_000
      const peerRecentLong = openLog.some(o => peers.includes(o.instrument) && o.dir === 'long' && o.openedAt >= fourHoursAgo)
      if (peerOpenLong || peerRecentLong) continue
    }

    // We don't have an open-position tracker for this instrument in this loop;
    // assume single-position-per-instrument by skipping if the previous trade
    // is still unresolved when this trigger fires.
    const prev = trades[trades.length - 1]
    if (prev && prev.exitIdx == null) continue
    if (prev && prev.exitIdx >= i) continue  // overlap

    // Entry
    const entry = price
    const sl = entry - a * slMult
    const tp1 = entry + a * tpMult

    // Walk forward to find SL or TP hit
    let exitIdx = null, exitPrice = null, exitReason = null
    for (let j = i + 1; j < Math.min(i + lookahead, candles.length); j++) {
      const c = candles[j]
      // SL takes priority on the same bar (conservative)
      if (c.low <= sl) { exitIdx = j; exitPrice = sl; exitReason = 'SL'; break }
      if (c.high >= tp1) { exitIdx = j; exitPrice = tp1; exitReason = 'TP'; break }
    }
    if (exitIdx == null) continue  // unresolved at end of data window — skip

    const pnlR = (exitPrice - entry) / (entry - sl)  // R-multiple
    const pnlPct = ((exitPrice - entry) / entry) * 100
    const holdHours = (candles[exitIdx].timestamp - last.timestamp) / 3_600_000

    trades.push({
      i, exitIdx,
      timestamp: last.timestamp,
      exitTimestamp: candles[exitIdx].timestamp,
      entry, exitPrice, sl, tp1,
      pnlR, pnlPct, holdHours,
      exitReason, triggerName, triggerCount,
      regime: reg.regime,
      atrPct,
      dubaiHour: dubaiHour(last.timestamp),
    })

    // Track in cross-instrument open log for correlation dedup of subsequent triggers
    openLog.push({ instrument: apex, dir: 'long', openedAt: last.timestamp, closedAt: candles[exitIdx].timestamp })
  }

  return trades
}

// ─── Aggregate stats ────────────────────────────────────────────────────────

function summarize(trades) {
  if (trades.length === 0) {
    return { count: 0, wins: 0, losses: 0, winRate: 0, expectancyR: 0, totalR: 0, avgWinR: 0, avgLossR: 0, maxDDR: 0, avgHoldH: 0 }
  }
  const wins = trades.filter(t => t.pnlR > 0)
  const losses = trades.filter(t => t.pnlR <= 0)
  const totalR = trades.reduce((s, t) => s + t.pnlR, 0)
  const avgWinR = wins.length ? avg(wins.map(t => t.pnlR)) : 0
  const avgLossR = losses.length ? avg(losses.map(t => t.pnlR)) : 0
  const expectancyR = totalR / trades.length

  // Max drawdown (R-units, equity curve)
  let peak = 0, equity = 0, maxDDR = 0
  for (const t of trades) {
    equity += t.pnlR
    if (equity > peak) peak = equity
    const dd = peak - equity
    if (dd > maxDDR) maxDDR = dd
  }

  return {
    count: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: wins.length / trades.length,
    expectancyR,
    totalR,
    avgWinR,
    avgLossR,
    maxDDR,
    avgHoldH: avg(trades.map(t => t.holdHours)),
  }
}

// ─── Run ────────────────────────────────────────────────────────────────────

console.log(`\n=== APEX backtest — ${DAYS}d, ${INSTRUMENTS.length} instruments ===`)
console.log(SWEEP ? '   Mode: SL × TP multiplier sweep (filtered)' : '   Modes: BASELINE / FILTERED / NEW (3-way compare)')

const candleCache = {}
console.log('Fetching candles...')
for (const [apex, binance] of INSTRUMENTS) {
  process.stdout.write(`  ${apex.padEnd(12)} `)
  try {
    const c = await fetchKlines(binance, DAYS)
    candleCache[apex] = c
    const first = c[0] ? new Date(c[0].timestamp).toISOString().slice(0, 10) : '?'
    const last = c.at(-1) ? new Date(c.at(-1).timestamp).toISOString().slice(0, 10) : '?'
    console.log(`${c.length} candles (${first} → ${last})`)
  } catch (e) {
    console.log(`ERROR: ${e.message}`)
  }
}

function runMode(modeName, opts = null) {
  const openLog = []
  const openPositions = new Set()
  const allTrades = {}

  const order = INSTRUMENTS
    .filter(([apex]) => candleCache[apex]?.length > 0)
    .sort((a, b) => candleCache[a[0]][0].timestamp - candleCache[b[0]][0].timestamp)

  for (const [apex] of order) {
    const trades = backtestInstrument({ apex, candles: candleCache[apex], mode: modeName, openPositions, openLog, opts })
    allTrades[apex] = trades
  }

  return allTrades
}

function pad(s, n) { return String(s).padEnd(n) }
function padN(n, w) { return String(n).padStart(w) }

function printResults(label, allTrades) {
  console.log(`\n━━━ ${label} ━━━`)
  console.log(`  ${pad('Instrument', 14)} ${pad('Trades', 8)} ${pad('Wins', 6)} ${pad('Losses', 8)} ${pad('WR', 8)} ${pad('Avg±R', 9)} ${pad('TotalR', 9)} ${pad('Max DD R', 10)} ${pad('Avg Hold', 9)}`)
  console.log(`  ${'-'.repeat(83)}`)

  const allArr = []
  for (const [apex, trades] of Object.entries(allTrades)) {
    const s = summarize(trades)
    allArr.push(...trades)
    console.log(`  ${pad(apex, 14)} ${padN(s.count, 6)}  ${padN(s.wins, 5)} ${padN(s.losses, 6)}   ${(s.winRate * 100).toFixed(1).padStart(5)}%   ${(s.expectancyR >= 0 ? '+' : '') + s.expectancyR.toFixed(2)}    ${(s.totalR >= 0 ? '+' : '') + s.totalR.toFixed(1).padStart(6)}    ${s.maxDDR.toFixed(1).padStart(5)}      ${s.avgHoldH.toFixed(1).padStart(5)}h`)
  }
  console.log(`  ${'-'.repeat(83)}`)
  const tot = summarize(allArr)
  console.log(`  ${pad('TOTAL', 14)} ${padN(tot.count, 6)}  ${padN(tot.wins, 5)} ${padN(tot.losses, 6)}   ${(tot.winRate * 100).toFixed(1).padStart(5)}%   ${(tot.expectancyR >= 0 ? '+' : '') + tot.expectancyR.toFixed(2)}    ${(tot.totalR >= 0 ? '+' : '') + tot.totalR.toFixed(1).padStart(6)}    ${tot.maxDDR.toFixed(1).padStart(5)}      ${tot.avgHoldH.toFixed(1).padStart(5)}h`)

  // Translate R into USD on $5,000 capital with 1.5% risk per trade
  const riskUsdPerTrade = 5000 * 0.015  // $75
  const totalUsd = tot.totalR * riskUsdPerTrade
  const expectancyUsd = tot.expectancyR * riskUsdPerTrade
  console.log(`\n  In USD on $5,000 capital, 1.5% risk per trade ($${riskUsdPerTrade}/R):`)
  console.log(`  Expected per trade: ${expectancyUsd >= 0 ? '+' : ''}$${expectancyUsd.toFixed(2)}`)
  console.log(`  Total over ${DAYS} days: ${totalUsd >= 0 ? '+' : ''}$${totalUsd.toFixed(0)}`)
  console.log(`  Annualized (extrapolated): ${(totalUsd * (365 / DAYS)).toFixed(0) >= 0 ? '+' : ''}$${Math.round(totalUsd * (365 / DAYS))}`)
  console.log(`  Max drawdown: ${(tot.maxDDR * riskUsdPerTrade).toFixed(0)} USD (= ${(tot.maxDDR * 1.5).toFixed(1)}% of capital)`)
  return tot
}

if (SWEEP) {
  console.log('\n━━━ TP × SL SWEEP (filters ON) ━━━')
  console.log(`  ${pad('SL×ATR', 9)} ${pad('TP×ATR', 9)} ${pad('R:R', 6)} ${pad('Trades', 8)} ${pad('WR', 8)} ${pad('Avg±R', 9)} ${pad('TotalR', 9)} ${pad('Verdict', 8)}`)
  console.log(`  ${'-'.repeat(66)}`)
  const slMults = [1.5, 2.0, 2.5, 3.0]
  const tpMults = [2.0, 3.0, 4.0, 4.5, 5.0, 6.0, 7.5]
  let bestExp = -Infinity, bestCfg = null
  for (const slMult of slMults) {
    for (const tpMult of tpMults) {
      if (tpMult <= slMult) continue
      const trades = runMode('filtered', { slMult, tpMult })
      const all = []
      for (const t of Object.values(trades)) all.push(...t)
      const s = summarize(all)
      const rr = (tpMult / slMult).toFixed(2)
      const verdict = s.expectancyR > 0.05 ? 'PASS' : s.expectancyR > 0 ? 'mrg' : 'FAIL'
      console.log(`  ${padN(slMult, 7)}   ${padN(tpMult, 7)}   ${rr.padStart(4)}   ${padN(s.count, 6)}   ${(s.winRate * 100).toFixed(1).padStart(5)}%  ${(s.expectancyR >= 0 ? '+' : '') + s.expectancyR.toFixed(3)}    ${(s.totalR >= 0 ? '+' : '') + s.totalR.toFixed(1).padStart(6)}    ${verdict}`)
      if (s.expectancyR > bestExp) { bestExp = s.expectancyR; bestCfg = { slMult, tpMult, summary: s } }
    }
  }
  console.log(`\n  Best config: SL=${bestCfg.slMult}×ATR, TP=${bestCfg.tpMult}×ATR (R:R ${(bestCfg.tpMult/bestCfg.slMult).toFixed(2)})`)
  console.log(`  Expectancy: ${bestCfg.summary.expectancyR >= 0 ? '+' : ''}${bestCfg.summary.expectancyR.toFixed(3)} R/trade  WR: ${(bestCfg.summary.winRate * 100).toFixed(1)}%  TotalR: ${bestCfg.summary.totalR >= 0 ? '+' : ''}${bestCfg.summary.totalR.toFixed(1)}`)
  console.log(`\n  In USD on $5,000 capital, 1.5% risk per trade ($75/R):`)
  console.log(`  Annualized (extrapolated): $${Math.round(bestCfg.summary.totalR * 75 * (365 / DAYS))}`)
} else {
  const baselineTot = printResults('BASELINE (TP=4.5 ATR, no new gates)', runMode('baseline'))
  const filteredTot = printResults('FILTERED (TP=4.5 ATR, all new gates ON)', runMode('filtered'))
  const newTot = printResults('NEW (TP=3.0 ATR, all new gates ON)', runMode('new'))

  console.log(`\n━━━ DELTA TABLE ━━━`)
  console.log(`  ${pad('Mode', 22)} ${pad('Trades', 8)} ${pad('WR', 8)} ${pad('Exp/R', 9)} ${pad('TotalR', 9)} ${pad('MaxDD R', 9)}`)
  console.log(`  ${'-'.repeat(66)}`)
  for (const [name, s] of [['BASELINE (TP4.5)', baselineTot], ['FILTERED (TP4.5)', filteredTot], ['NEW (TP3.0)', newTot]]) {
    console.log(`  ${pad(name, 22)} ${padN(s.count, 6)}   ${(s.winRate * 100).toFixed(1).padStart(5)}%  ${(s.expectancyR >= 0 ? '+' : '') + s.expectancyR.toFixed(3)}    ${(s.totalR >= 0 ? '+' : '') + s.totalR.toFixed(1).padStart(6)}     ${s.maxDDR.toFixed(1).padStart(5)}`)
  }

  console.log(`\n━━━ VERDICT ━━━`)
  const winner = [
    { name: 'NEW (TP3.0)', s: newTot },
    { name: 'FILTERED (TP4.5)', s: filteredTot },
    { name: 'BASELINE (TP4.5)', s: baselineTot },
  ].sort((a, b) => b.s.expectancyR - a.s.expectancyR)[0]

  if (winner.s.expectancyR > 0.05) {
    console.log(`  PASS — best config "${winner.name}" has expectancy ${winner.s.expectancyR.toFixed(3)} R/trade.`)
    console.log(`  Run \`--sweep\` to find the optimal SL/TP multipliers.`)
  } else if (winner.s.expectancyR > 0) {
    console.log(`  MARGINAL — best config "${winner.name}" has weakly positive expectancy (${winner.s.expectancyR.toFixed(3)} R/trade).`)
    console.log(`  After fees (~0.13 R per round-trip) this is likely net-negative. Run \`--sweep\` for better SL/TP.`)
  } else {
    console.log(`  FAIL — all 3 modes have NEGATIVE expectancy.`)
    console.log(`  Best is "${winner.name}" at ${winner.s.expectancyR.toFixed(3)} R/trade — still loses.`)
    console.log(`  Conclusion: the underlying triggers are not edge-positive on the current instrument set.`)
    console.log(`  DO NOT enable real execution. Recommended actions:`)
    console.log(`    1. Run \`--sweep\` to test other SL/TP combos before declaring failure`)
    console.log(`    2. If sweep also fails: trigger logic itself needs replacement, not more filters`)
    console.log(`    3. Keep paper mode active. Run a 30-day rolling expectancy gate as kill-switch.`)
  }
}

console.log('\n=== BACKTEST COMPLETE ===\n')
