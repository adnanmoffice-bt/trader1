/**
 * APEX Trading Strategy Backtester
 * Tests 6 strategies on 6 months of hourly BTC/ETH data
 * Run: npx tsx scripts/backtest.ts
 */

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES & CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
interface Trade { entry: number; exit: number; dir: 'long' | 'short'; entryTime: number; exitTime: number; pnl: number; pnlPct: number }
interface StrategyResult {
  name: string
  trades: Trade[]
  totalReturn: number
  annualizedReturn: number
  sharpe: number
  sortino: number
  maxDrawdown: number
  calmar: number
  winRate: number
  profitFactor: number
  avgWin: number
  avgLoss: number
  avgHoldHours: number
  tradesPerMonth: number
}

const FEE = 0.001       // 0.1% per trade (entry + exit = 0.2% round trip)
const CAPITAL = 10000    // $10,000 starting capital
const RISK_PER_TRADE = 0.02 // 2% risk per trade

// ═══════════════════════════════════════════════════════════════════════════════
// DATA FETCHING
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchCandles(symbol: string, interval: string, months: number): Promise<Candle[]> {
  const BINANCE = 'https://api.binance.com/api/v3/klines'
  const endMs = Date.now()
  const startMs = endMs - months * 30 * 24 * 3600 * 1000
  const all: Candle[] = []
  let cursor = startMs

  while (cursor < endMs) {
    const url = `${BINANCE}?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${endMs}&limit=1000`
    const res = await fetch(url)
    const data: number[][] = await res.json()
    if (!data.length) break

    for (const k of data) {
      all.push({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })
    }
    cursor = data[data.length - 1][6] + 1
    await new Promise(r => setTimeout(r, 100))
  }

  console.log(`  Fetched ${all.length} ${interval} candles for ${symbol}`)
  return all
}

// ═══════════════════════════════════════════════════════════════════════════════
// INDICATORS
// ═══════════════════════════════════════════════════════════════════════════════

function ema(data: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const result = [data[0]]
  for (let i = 1; i < data.length; i++) result.push(data[i] * k + result[i - 1] * (1 - k))
  return result
}

function sma(data: number[], period: number): number[] {
  const result: number[] = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += data[j]
    result.push(sum / period)
  }
  return result
}

function rsi(closes: number[], period = 14): number[] {
  const result: number[] = new Array(closes.length).fill(50)
  if (closes.length < period + 1) return result

  const changes = closes.slice(1).map((c, i) => c - closes[i])
  let avgGain = 0, avgLoss = 0
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i]
    else avgLoss += Math.abs(changes[i])
  }
  avgGain /= period
  avgLoss /= period

  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + Math.max(changes[i], 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-changes[i], 0)) / period
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    result[i + 1] = 100 - 100 / (1 + rs)
  }
  return result
}

function macd(closes: number[]): { macd: number[]; signal: number[]; hist: number[] } {
  const e12 = ema(closes, 12)
  const e26 = ema(closes, 26)
  const macdLine = e12.map((v, i) => v - e26[i])
  const signalLine = ema(macdLine, 9)
  const hist = macdLine.map((v, i) => v - signalLine[i])
  return { macd: macdLine, signal: signalLine, hist }
}

function bb(closes: number[], period = 20, mult = 2): { upper: number[]; mid: number[]; lower: number[]; width: number[]; pctB: number[] } {
  const mid = sma(closes, period)
  const upper: number[] = [], lower: number[] = [], width: number[] = [], pctB: number[] = []
  for (let i = 0; i < closes.length; i++) {
    if (isNaN(mid[i])) { upper.push(NaN); lower.push(NaN); width.push(NaN); pctB.push(NaN); continue }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += (closes[j] - mid[i]) ** 2
    const sd = Math.sqrt(sum / period)
    upper.push(mid[i] + mult * sd)
    lower.push(mid[i] - mult * sd)
    width.push((upper[i] - lower[i]) / mid[i])
    pctB.push(upper[i] !== lower[i] ? (closes[i] - lower[i]) / (upper[i] - lower[i]) : 0.5)
  }
  return { upper, mid, lower, width, pctB }
}

function atr(candles: Candle[], period = 14): number[] {
  const result: number[] = [candles[0].h - candles[0].l]
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - candles[i - 1].c), Math.abs(candles[i].l - candles[i - 1].c))
    result.push(tr)
  }
  return ema(result, period)
}

function hurst(closes: number[], maxLag = 100): number {
  const n = Math.min(closes.length, maxLag)
  if (n < 20) return 0.5
  const returns = closes.slice(1).map((c, i) => Math.log(c / closes[i]))
  const lags = [2, 4, 8, 16, 32, 64].filter(l => l < n)
  const rs: number[] = []
  for (const lag of lags) {
    const chunks = Math.floor(returns.length / lag)
    let sumRS = 0
    for (let c = 0; c < chunks; c++) {
      const chunk = returns.slice(c * lag, (c + 1) * lag)
      const mean = chunk.reduce((a, b) => a + b, 0) / chunk.length
      const cumDev = chunk.map((v, i) => chunk.slice(0, i + 1).reduce((a, b) => a + (b - mean), 0))
      const R = Math.max(...cumDev) - Math.min(...cumDev)
      const S = Math.sqrt(chunk.reduce((a, b) => a + (b - mean) ** 2, 0) / chunk.length) || 1e-10
      sumRS += Math.log(R / S)
    }
    rs.push(sumRS / chunks)
  }
  // Linear regression of log(RS) vs log(lag)
  const logLags = lags.map(l => Math.log(l))
  const n2 = logLags.length
  const sx = logLags.reduce((a, b) => a + b, 0)
  const sy = rs.reduce((a, b) => a + b, 0)
  const sxy = logLags.reduce((a, l, i) => a + l * rs[i], 0)
  const sx2 = logLags.reduce((a, l) => a + l * l, 0)
  return (n2 * sxy - sx * sy) / (n2 * sx2 - sx * sx)
}

// ═══════════════════════════════════════════════════════════════════════════════
// STRATEGY IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function simulateTrades(candles: Candle[], signals: Array<{ i: number; dir: 'long' | 'short'; sl: number; tp: number }>): Trade[] {
  const trades: Trade[] = []
  for (const sig of signals) {
    const entry = candles[sig.i].c * (1 + (sig.dir === 'long' ? FEE : -FEE))
    for (let j = sig.i + 1; j < candles.length; j++) {
      const price = sig.dir === 'long' ? candles[j].l : candles[j].h
      const hitSL = sig.dir === 'long' ? price <= sig.sl : price >= sig.sl
      const hitTP = sig.dir === 'long' ? candles[j].h >= sig.tp : candles[j].l <= sig.tp

      if (hitSL || hitTP) {
        const exitPrice = hitSL ? sig.sl : sig.tp
        const exit = exitPrice * (1 + (sig.dir === 'long' ? -FEE : FEE))
        const pnl = sig.dir === 'long' ? (exit - entry) / entry : (entry - exit) / entry
        trades.push({
          entry: candles[sig.i].c, exit: exitPrice, dir: sig.dir,
          entryTime: candles[sig.i].t, exitTime: candles[j].t,
          pnl, pnlPct: pnl * 100,
        })
        break
      }

      // Max hold: 48 candles (48 hours)
      if (j - sig.i >= 48) {
        const exit = candles[j].c * (1 + (sig.dir === 'long' ? -FEE : FEE))
        const pnl = sig.dir === 'long' ? (exit - entry) / entry : (entry - exit) / entry
        trades.push({
          entry: candles[sig.i].c, exit: candles[j].c, dir: sig.dir,
          entryTime: candles[sig.i].t, exitTime: candles[j].t,
          pnl, pnlPct: pnl * 100,
        })
        break
      }
    }
  }
  return trades
}

// Strategy 1: EMA Crossover (12/26)
function strategyEMACross(candles: Candle[]): Trade[] {
  const closes = candles.map(c => c.c)
  const ema12 = ema(closes, 12)
  const ema26 = ema(closes, 26)
  const atrArr = atr(candles, 14)

  const signals: Array<{ i: number; dir: 'long' | 'short'; sl: number; tp: number }> = []
  let lastSignal = 0

  for (let i = 30; i < candles.length - 50; i++) {
    if (i - lastSignal < 12) continue // Min 12h between trades

    const cross_up = ema12[i] > ema26[i] && ema12[i - 1] <= ema26[i - 1]
    const cross_dn = ema12[i] < ema26[i] && ema12[i - 1] >= ema26[i - 1]
    const a = atrArr[i]

    if (cross_up) {
      signals.push({ i, dir: 'long', sl: closes[i] - 2.5 * a, tp: closes[i] + 5 * a })
      lastSignal = i
    } else if (cross_dn) {
      signals.push({ i, dir: 'short', sl: closes[i] + 2.5 * a, tp: closes[i] - 5 * a })
      lastSignal = i
    }
  }
  return simulateTrades(candles, signals)
}

// Strategy 2: RSI Mean Reversion
function strategyRSIMeanRev(candles: Candle[]): Trade[] {
  const closes = candles.map(c => c.c)
  const rsiArr = rsi(closes, 14)
  const atrArr = atr(candles, 14)
  const ema50 = ema(closes, 50)

  const signals: Array<{ i: number; dir: 'long' | 'short'; sl: number; tp: number }> = []
  let lastSignal = 0

  for (let i = 60; i < candles.length - 50; i++) {
    if (i - lastSignal < 8) continue

    const a = atrArr[i]

    // Oversold bounce: RSI crosses up above 30, price above EMA50 (uptrend)
    if (rsiArr[i] > 30 && rsiArr[i - 1] <= 30 && closes[i] > ema50[i]) {
      signals.push({ i, dir: 'long', sl: closes[i] - 2 * a, tp: closes[i] + 3 * a })
      lastSignal = i
    }
    // Overbought reversal: RSI crosses below 70, price below EMA50 (downtrend)
    if (rsiArr[i] < 70 && rsiArr[i - 1] >= 70 && closes[i] < ema50[i]) {
      signals.push({ i, dir: 'short', sl: closes[i] + 2 * a, tp: closes[i] - 3 * a })
      lastSignal = i
    }
  }
  return simulateTrades(candles, signals)
}

// Strategy 3: MACD Histogram Divergence
function strategyMACDHist(candles: Candle[]): Trade[] {
  const closes = candles.map(c => c.c)
  const { hist } = macd(closes)
  const atrArr = atr(candles, 14)
  const ema200 = ema(closes, 200)

  const signals: Array<{ i: number; dir: 'long' | 'short'; sl: number; tp: number }> = []
  let lastSignal = 0

  for (let i = 210; i < candles.length - 50; i++) {
    if (i - lastSignal < 10) continue

    const a = atrArr[i]

    // Histogram crosses above 0 + above EMA200 (trend confirmation)
    if (hist[i] > 0 && hist[i - 1] <= 0 && closes[i] > ema200[i]) {
      signals.push({ i, dir: 'long', sl: closes[i] - 2 * a, tp: closes[i] + 4 * a })
      lastSignal = i
    }
    // Histogram crosses below 0 + below EMA200
    if (hist[i] < 0 && hist[i - 1] >= 0 && closes[i] < ema200[i]) {
      signals.push({ i, dir: 'short', sl: closes[i] + 2 * a, tp: closes[i] - 4 * a })
      lastSignal = i
    }
  }
  return simulateTrades(candles, signals)
}

// Strategy 4: Bollinger Band Squeeze Breakout
function strategyBBSqueeze(candles: Candle[]): Trade[] {
  const closes = candles.map(c => c.c)
  const { upper, lower, width } = bb(closes, 20, 2)
  const atrArr = atr(candles, 14)

  const signals: Array<{ i: number; dir: 'long' | 'short'; sl: number; tp: number }> = []
  let lastSignal = 0

  for (let i = 30; i < candles.length - 50; i++) {
    if (i - lastSignal < 12) continue
    if (isNaN(width[i]) || isNaN(width[i - 10])) continue

    const a = atrArr[i]
    // Squeeze: width was narrow, now expanding
    const wasSqueezing = width.slice(i - 10, i).every(w => !isNaN(w) && w < width[i])
    const expanding = width[i] > width[i - 1] * 1.1

    if (wasSqueezing && expanding) {
      if (closes[i] > upper[i]) {
        signals.push({ i, dir: 'long', sl: closes[i] - 2.5 * a, tp: closes[i] + 4 * a })
        lastSignal = i
      } else if (closes[i] < lower[i]) {
        signals.push({ i, dir: 'short', sl: closes[i] + 2.5 * a, tp: closes[i] - 4 * a })
        lastSignal = i
      }
    }
  }
  return simulateTrades(candles, signals)
}

// Strategy 5: Multi-Timeframe (4H trend + 1H entry)
function strategyMultiTF(candles1h: Candle[]): Trade[] {
  const closes = candles1h.map(c => c.c)
  const ema20 = ema(closes, 20)
  const ema50_4h = ema(closes, 200) // 50 * 4 = 200 (simulating 4H EMA50 on 1H data)
  const rsiArr = rsi(closes, 14)
  const atrArr = atr(candles1h, 14)

  const signals: Array<{ i: number; dir: 'long' | 'short'; sl: number; tp: number }> = []
  let lastSignal = 0

  for (let i = 210; i < candles1h.length - 50; i++) {
    if (i - lastSignal < 8) continue

    const a = atrArr[i]
    const trend4h = closes[i] > ema50_4h[i] ? 'up' : 'down'

    // Long: 4H uptrend + 1H pullback to EMA20 + RSI bouncing from 40-50
    if (trend4h === 'up' && closes[i] > ema20[i] && closes[i - 1] <= ema20[i - 1] && rsiArr[i] > 40 && rsiArr[i] < 60) {
      signals.push({ i, dir: 'long', sl: closes[i] - 2 * a, tp: closes[i] + 4 * a })
      lastSignal = i
    }
    // Short: 4H downtrend + 1H bounce off EMA20 + RSI dropping from 50-60
    if (trend4h === 'down' && closes[i] < ema20[i] && closes[i - 1] >= ema20[i - 1] && rsiArr[i] > 40 && rsiArr[i] < 60) {
      signals.push({ i, dir: 'short', sl: closes[i] + 2 * a, tp: closes[i] - 4 * a })
      lastSignal = i
    }
  }
  return simulateTrades(candles1h, signals)
}

// Strategy 6: Regime-Aware Hybrid (best of research)
function strategyRegimeHybrid(candles: Candle[]): Trade[] {
  const closes = candles.map(c => c.c)
  const ema12 = ema(closes, 12)
  const ema26 = ema(closes, 26)
  const rsiArr = rsi(closes, 14)
  const { hist } = macd(closes)
  const { pctB } = bb(closes, 20, 2)
  const atrArr = atr(candles, 14)

  const signals: Array<{ i: number; dir: 'long' | 'short'; sl: number; tp: number }> = []
  let lastSignal = 0

  for (let i = 210; i < candles.length - 50; i++) {
    if (i - lastSignal < 6) continue

    // Detect regime using Hurst exponent on last 200 candles
    const window = closes.slice(Math.max(0, i - 200), i + 1)
    const H = hurst(window)
    const a = atrArr[i]

    if (H > 0.55) {
      // TRENDING regime → use momentum (EMA cross + MACD confirmation)
      const crossUp = ema12[i] > ema26[i] && ema12[i - 1] <= ema26[i - 1] && hist[i] > 0
      const crossDn = ema12[i] < ema26[i] && ema12[i - 1] >= ema26[i - 1] && hist[i] < 0
      if (crossUp) { signals.push({ i, dir: 'long', sl: closes[i] - 2 * a, tp: closes[i] + 5 * a }); lastSignal = i }
      if (crossDn) { signals.push({ i, dir: 'short', sl: closes[i] + 2 * a, tp: closes[i] - 5 * a }); lastSignal = i }
    } else if (H < 0.45) {
      // MEAN REVERTING regime → use RSI + BB
      if (rsiArr[i] < 30 && !isNaN(pctB[i]) && pctB[i] < 0.1) {
        signals.push({ i, dir: 'long', sl: closes[i] - 1.5 * a, tp: closes[i] + 2.5 * a })
        lastSignal = i
      }
      if (rsiArr[i] > 70 && !isNaN(pctB[i]) && pctB[i] > 0.9) {
        signals.push({ i, dir: 'short', sl: closes[i] + 1.5 * a, tp: closes[i] - 2.5 * a })
        lastSignal = i
      }
    }
    // H between 0.45-0.55: random walk → no trade
  }
  return simulateTrades(candles, signals)
}

// ═══════════════════════════════════════════════════════════════════════════════
// METRICS
// ═══════════════════════════════════════════════════════════════════════════════

function calculateMetrics(name: string, trades: Trade[], months: number): StrategyResult {
  if (trades.length === 0) {
    return { name, trades, totalReturn: 0, annualizedReturn: 0, sharpe: 0, sortino: 0, maxDrawdown: 0, calmar: 0, winRate: 0, profitFactor: 0, avgWin: 0, avgLoss: 0, avgHoldHours: 0, tradesPerMonth: 0 }
  }

  const wins = trades.filter(t => t.pnl > 0)
  const losses = trades.filter(t => t.pnl <= 0)
  const winRate = wins.length / trades.length

  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0

  // Compounded return
  let equity = 1
  let peak = 1
  let maxDD = 0
  const equityCurve: number[] = []
  for (const t of trades) {
    equity *= (1 + t.pnl * RISK_PER_TRADE / Math.abs(t.pnl > 0 ? t.pnl : -t.pnl || 0.01))
    // Simplified: use fixed risk sizing
    equity += t.pnl * RISK_PER_TRADE * CAPITAL / CAPITAL
    equityCurve.push(equity)
    if (equity > peak) peak = equity
    const dd = (peak - equity) / peak
    if (dd > maxDD) maxDD = dd
  }

  // Recalculate properly with fixed risk
  equity = CAPITAL
  peak = CAPITAL
  maxDD = 0
  for (const t of trades) {
    const riskAmt = equity * RISK_PER_TRADE
    const positionPnl = riskAmt * (t.pnl / Math.abs(t.pnl > 0 ? t.pnl : 0.01))
    // Actually: if we risk 2% per trade, and the trade's R:R plays out
    const slDist = Math.abs(t.entry - (t.pnl > 0 ? t.entry * 0.975 : t.entry * 1.025)) // Approximate
    const actualPnl = t.pnl * equity * RISK_PER_TRADE
    equity += actualPnl
    if (equity > peak) peak = equity
    const dd = (peak - equity) / peak
    if (dd > maxDD) maxDD = dd
  }

  const totalReturn = (equity - CAPITAL) / CAPITAL
  const years = months / 12
  const annualizedReturn = Math.pow(1 + totalReturn, 1 / years) - 1

  // Sharpe & Sortino (annualized)
  const returns = trades.map(t => t.pnl)
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length
  const stdDev = Math.sqrt(returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / returns.length) || 0.001
  const downDev = Math.sqrt(returns.filter(r => r < 0).reduce((s, r) => s + r ** 2, 0) / Math.max(returns.filter(r => r < 0).length, 1)) || 0.001

  const tradesPerYear = trades.length / years
  const sharpe = (meanReturn / stdDev) * Math.sqrt(tradesPerYear)
  const sortino = (meanReturn / downDev) * Math.sqrt(tradesPerYear)
  const calmar = maxDD > 0 ? annualizedReturn / maxDD : 0

  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0
  const avgHold = trades.reduce((s, t) => s + (t.exitTime - t.entryTime), 0) / trades.length / 3600000

  return {
    name, trades, totalReturn: totalReturn * 100, annualizedReturn: annualizedReturn * 100,
    sharpe, sortino, maxDrawdown: maxDD * 100, calmar,
    winRate: winRate * 100, profitFactor, avgWin, avgLoss, avgHoldHours: avgHold,
    tradesPerMonth: trades.length / months,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  APEX TRADING STRATEGY BACKTESTER')
  console.log('  Testing 6 strategies on 6 months of hourly data')
  console.log('  Capital: $10,000 | Risk/trade: 2% | Fees: 0.1%/side')
  console.log('═══════════════════════════════════════════════════════════\n')

  const MONTHS = 6

  console.log('📥 Fetching historical data...')
  const btc = await fetchCandles('BTCUSDT', '1h', MONTHS)
  const eth = await fetchCandles('ETHUSDT', '1h', MONTHS)
  console.log('')

  const strategies: Array<{ name: string; fn: (c: Candle[]) => Trade[] }> = [
    { name: 'EMA Cross 12/26', fn: strategyEMACross },
    { name: 'RSI Mean Reversion', fn: strategyRSIMeanRev },
    { name: 'MACD + EMA200', fn: strategyMACDHist },
    { name: 'BB Squeeze Breakout', fn: strategyBBSqueeze },
    { name: 'Multi-TF (4H+1H)', fn: strategyMultiTF },
    { name: 'Regime Hybrid (Hurst)', fn: strategyRegimeHybrid },
  ]

  const allResults: StrategyResult[] = []

  for (const { name, fn } of strategies) {
    console.log(`🔬 Testing: ${name}`)

    const btcTrades = fn(btc)
    const ethTrades = fn(eth)
    const combined = [...btcTrades, ...ethTrades].sort((a, b) => a.entryTime - b.entryTime)

    const result = calculateMetrics(name, combined, MONTHS)
    allResults.push(result)

    console.log(`   BTC: ${btcTrades.length} trades | ETH: ${ethTrades.length} trades | Combined: ${combined.length}`)
  }

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('  RESULTS (sorted by Sharpe Ratio)')
  console.log('═══════════════════════════════════════════════════════════\n')

  allResults.sort((a, b) => b.sharpe - a.sharpe)

  for (const r of allResults) {
    const medal = allResults.indexOf(r) === 0 ? '🏆' : allResults.indexOf(r) === 1 ? '🥈' : allResults.indexOf(r) === 2 ? '🥉' : '  '
    console.log(`${medal} ${r.name}`)
    console.log(`   Return: ${r.totalReturn >= 0 ? '+' : ''}${r.totalReturn.toFixed(1)}% | Annual: ${r.annualizedReturn >= 0 ? '+' : ''}${r.annualizedReturn.toFixed(1)}%`)
    console.log(`   Sharpe: ${r.sharpe.toFixed(2)} | Sortino: ${r.sortino.toFixed(2)} | Calmar: ${r.calmar.toFixed(2)}`)
    console.log(`   Max DD: -${r.maxDrawdown.toFixed(1)}% | Win Rate: ${r.winRate.toFixed(1)}%`)
    console.log(`   Profit Factor: ${r.profitFactor.toFixed(2)} | Avg Win: +${r.avgWin.toFixed(2)}% | Avg Loss: ${r.avgLoss.toFixed(2)}%`)
    console.log(`   Trades: ${r.trades.length} (${r.tradesPerMonth.toFixed(1)}/mo) | Avg Hold: ${r.avgHoldHours.toFixed(1)}h`)
    console.log('')
  }

  const best = allResults[0]
  console.log('═══════════════════════════════════════════════════════════')
  console.log(`  WINNER: ${best.name}`)
  console.log(`  Sharpe ${best.sharpe.toFixed(2)} | Return ${best.totalReturn.toFixed(1)}% | Max DD ${best.maxDrawdown.toFixed(1)}%`)
  console.log('═══════════════════════════════════════════════════════════')
}

main().catch(console.error)
