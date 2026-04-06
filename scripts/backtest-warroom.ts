/**
 * APEX War Room Historical Backtest
 * Walks through 6 months of real Binance candles, detects triggers,
 * runs 12-agent AI debates, verifies outcomes, stores in Supabase.
 * 
 * Run: npx tsx scripts/backtest-warroom.ts
 */

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.local
const envPath = resolve(process.cwd(), '.env.local')
try {
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
} catch {}

// ═══ CONFIG ═══
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const MONTHS = 6
const STEP = 6          // check every 6 candles (6 hours) to find more triggers
const MAX_HOLD = 48     // max 48h hold
const SL_MULT = 2.5
const TP_MULT = 4.0
const MODEL = 'claude-sonnet-4-20250514'

const claude = new Anthropic({ apiKey: ANTHROPIC_KEY })
const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

// ═══ FETCH DATA ═══
async function fetchCandles(symbol: string): Promise<Candle[]> {
  const BASE = 'https://api.binance.com/api/v3/klines'
  const endMs = Date.now(), startMs = endMs - MONTHS * 30 * 24 * 3600_000
  const all: Candle[] = []
  let cursor = startMs
  while (cursor < endMs) {
    const res = await fetch(`${BASE}?symbol=${symbol}&interval=1h&startTime=${cursor}&endTime=${endMs}&limit=1000`)
    const data: number[][] = await res.json()
    if (!data.length) break
    for (const k of data) all.push({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })
    cursor = data[data.length - 1][6] + 1
    await sleep(100)
  }
  console.log(`  Fetched ${all.length} candles for ${symbol}`)
  return all
}

// ═══ INDICATORS ═══
function ema(d: number[], p: number): number[] { const k = 2 / (p + 1), r = [d[0]]; for (let i = 1; i < d.length; i++) r.push(d[i] * k + r[i - 1] * (1 - k)); return r }
function sma(d: number[], p: number): number[] { return d.map((_, i) => i < p - 1 ? NaN : d.slice(i - p + 1, i + 1).reduce((a, b) => a + b) / p) }
function rsi(c: number[], p = 14): number {
  if (c.length < p + 1) return 50
  const ch = c.slice(1).map((v, i) => v - c[i])
  let ag = 0, al = 0
  for (let i = 0; i < p; i++) { if (ch[i] > 0) ag += ch[i]; else al += Math.abs(ch[i]) }
  ag /= p; al /= p
  for (let i = p; i < ch.length; i++) { ag = (ag * (p - 1) + Math.max(ch[i], 0)) / p; al = (al * (p - 1) + Math.max(-ch[i], 0)) / p }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al)
}
function atr(candles: Candle[], p = 14): number {
  const trs = candles.slice(1).map((c, i) => Math.max(c.h - c.l, Math.abs(c.h - candles[i].c), Math.abs(c.l - candles[i].c)))
  const e = ema(trs, p); return e[e.length - 1]
}
function bbWidth(closes: number[], p = 20): number[] {
  return closes.map((_, i) => {
    if (i < p - 1) return 0
    const sl = closes.slice(i - p + 1, i + 1), m = sl.reduce((a, b) => a + b) / p
    const sd = Math.sqrt(sl.reduce((a, v) => a + (v - m) ** 2, 0) / p)
    return m > 0 ? (4 * sd) / m : 0
  })
}
function bbPctB(closes: number[], p = 20): number {
  const sl = closes.slice(-p), m = sl.reduce((a, b) => a + b) / p
  const sd = Math.sqrt(sl.reduce((a, v) => a + (v - m) ** 2, 0) / p)
  const u = m + 2 * sd, l = m - 2 * sd
  return u !== l ? (closes[closes.length - 1] - l) / (u - l) : 0.5
}

function detectBBSqueeze(closes: number[]): { triggered: boolean; dir: 'long' | 'short' | null } {
  const w = bbWidth(closes)
  if (w.length < 12) return { triggered: false, dir: null }
  const cur = w[w.length - 1], prev = w[w.length - 2] ?? cur
  const expanding = cur > prev * 1.1
  const wasNarrow = w.slice(-10, -1).every(v => v < cur)
  if (wasNarrow && expanding) {
    const pctB = bbPctB(closes)
    if (pctB > 1.0) return { triggered: true, dir: 'long' }
    if (pctB < 0.0) return { triggered: true, dir: 'short' }
  }
  return { triggered: false, dir: null }
}

function detectEMACross(closes: number[]): { triggered: boolean; dir: 'long' | 'short' | null } {
  const e12 = ema(closes, 12), e26 = ema(closes, 26), n = closes.length - 1
  if (e12[n] > e26[n] && e12[n - 1] <= e26[n - 1]) return { triggered: true, dir: 'long' }
  if (e12[n] < e26[n] && e12[n - 1] >= e26[n - 1]) return { triggered: true, dir: 'short' }
  return { triggered: false, dir: null }
}

// ═══ AI AGENT CALL ═══
async function askAgent(system: string, user: string): Promise<string> {
  try {
    const r = await claude.messages.create({
      model: MODEL, max_tokens: 150, system, messages: [{ role: 'user', content: user }],
    })
    return r.content.filter(b => b.type === 'text').map(b => b.text).join('')
  } catch (e) {
    return `[error: ${String(e).slice(0, 60)}]`
  }
}

// ═══ STORE MESSAGE ═══
async function storeMsg(meetingId: string, instrument: string, agent: string, role: string, message: string, data: Record<string, unknown> | null, ts: Date) {
  await db.from('war_room_messages').insert({
    meeting_id: meetingId, agent, role, message, data, instrument, created_at: ts.toISOString(),
  })
}

// ═══ CHECK TRADE OUTCOME ═══
function checkOutcome(candles: Candle[], entryIdx: number, dir: 'long' | 'short', entry: number, sl: number, tp: number): { win: boolean; exitPrice: number; exitIdx: number; reason: string } {
  for (let j = entryIdx + 1; j < Math.min(candles.length, entryIdx + MAX_HOLD); j++) {
    const hitSL = dir === 'long' ? candles[j].l <= sl : candles[j].h >= sl
    const hitTP = dir === 'long' ? candles[j].h >= tp : candles[j].l <= tp
    if (hitTP) return { win: true, exitPrice: tp, exitIdx: j, reason: 'TARGET HIT' }
    if (hitSL) return { win: false, exitPrice: sl, exitIdx: j, reason: 'STOP HIT' }
  }
  const exitIdx = Math.min(candles.length - 1, entryIdx + MAX_HOLD)
  const exitPrice = candles[exitIdx].c
  const pnl = dir === 'long' ? exitPrice - entry : entry - exitPrice
  return { win: pnl > 0, exitPrice, exitIdx, reason: 'TIMEOUT' }
}

// ═══ MAIN BACKTEST ═══
async function main() {
  console.log('═══════════════════════════════════════════════════════')
  console.log('  APEX WAR ROOM HISTORICAL BACKTEST')
  console.log(`  Period: ${MONTHS} months | Step: ${STEP}h | SL: ${SL_MULT}xATR | TP: ${TP_MULT}xATR`)
  console.log('═══════════════════════════════════════════════════════\n')

  console.log('Fetching historical data...')
  const btc = await fetchCandles('BTCUSDT')
  const eth = await fetchCandles('ETHUSDT')

  const datasets: Array<{ symbol: string; candles: Candle[] }> = [
    { symbol: 'BTC/USD', candles: btc },
    { symbol: 'ETH/USD', candles: eth },
  ]

  let totalMeetings = 0, totalTriggers = 0, totalExecuted = 0, totalWins = 0, totalLosses = 0, totalPnlUsd = 0

  for (const { symbol, candles } of datasets) {
    console.log(`\nProcessing ${symbol} (${candles.length} candles)...`)

    for (let i = 200; i < candles.length - MAX_HOLD; i += STEP) {
      const window = candles.slice(Math.max(0, i - 200), i + 1)
      const closes = window.map(c => c.c)
      const price = closes[closes.length - 1]
      const ts = new Date(candles[i].t)
      const meetingId = crypto.randomUUID()

      const bb = detectBBSqueeze(closes)
      const ec = detectEMACross(closes)
      const trigger = bb.triggered ? 'BB Squeeze' : ec.triggered ? 'EMA Cross' : null
      const dir = bb.triggered ? bb.dir : ec.triggered ? ec.dir : null

      totalMeetings++

      if (!trigger || !dir) {
        // Quick scan — no AI needed
        if (totalMeetings % 100 === 0) process.stdout.write('.')
        await storeMsg(meetingId, symbol, 'orchestrator', 'close',
          `${symbol} @ $${f(price)} | RSI:${rsi(closes).toFixed(0)} | No trigger. Adjourned.`, null, ts)
        continue
      }

      totalTriggers++
      const atrVal = atr(window)
      const rsiVal = rsi(closes)
      const pctB = bbPctB(closes)
      const e20 = ema(closes, 20), e50 = ema(closes, 50)

      console.log(`\n  [${ts.toISOString().slice(0, 16)}] ${symbol} ${trigger} → ${dir.toUpperCase()} @ $${f(price)}`)

      // ═══ FULL 12-AGENT DEBATE ═══
      await storeMsg(meetingId, symbol, 'orchestrator', 'open',
        `MEETING: ${symbol} @ $${f(price)}. ${trigger} detected → ${dir.toUpperCase()}. RSI:${rsiVal.toFixed(0)} ATR:${atrVal.toFixed(2)} BB%B:${(pctB * 100).toFixed(0)}%. Date: ${ts.toLocaleDateString('en')}.`,
        { price, rsi: rsiVal, atr: atrVal, trigger, dir }, ts)

      const conv: string[] = [`[ORCHESTRATOR]: ${symbol} @ $${f(price)}. ${trigger} → ${dir.toUpperCase()}. RSI:${rsiVal.toFixed(0)}, ATR:${atrVal.toFixed(2)}, BB%B:${(pctB * 100).toFixed(0)}%.`]

      const agents: Array<{ id: string; system: string; extra: string }> = [
        { id: 'macro-agent', system: 'You are the Macro Economist. Analyze macro conditions for this date. 2 sentences max.', extra: `Date: ${ts.toLocaleDateString('en')}. ${symbol} ${dir}.` },
        { id: 'correlation-agent', system: 'You are the Correlation Agent. How do correlated assets support this trade? 2 sentences.', extra: '' },
        { id: 'bull-agent', system: 'You are the Bull Agent. Make the STRONGEST case FOR this trade. 2 sentences.', extra: '' },
        { id: 'bear-agent', system: 'You are the Bear Agent. Make the case AGAINST. Find every risk. Challenge the Bull. 2 sentences.', extra: '' },
        { id: 'scalper-agent', system: `You are the Scalper. Short-term view. RSI:${rsiVal.toFixed(0)} ATR:${atrVal.toFixed(2)}. Quick scalp opportunity? 2 sentences.`, extra: '' },
        { id: 'trend-agent', system: `You are the Trend Agent. EMA20:${e20[e20.length-1]?.toFixed(2)} EMA50:${e50[e50.length-1]?.toFixed(2)}. Is this a real trend or fake? 2 sentences.`, extra: '' },
        { id: 'market-analyst', system: 'You are the Market Analyst. Sentiment assessment. 2 sentences.', extra: '' },
        { id: 'signal-generator', system: `You are the Signal Generator. Give entry, SL (${SL_MULT}xATR=${(atrVal*SL_MULT).toFixed(2)}), TP (${TP_MULT}xATR=${(atrVal*TP_MULT).toFixed(2)}), confidence. 2 sentences.`, extra: '' },
        { id: 'risk-manager', system: 'You are the Risk Manager. Approve, modify, or reject. Max 2% risk, min 1.5 R:R. 2 sentences.', extra: '' },
        { id: 'trade-reviewer', system: 'You are the Trade Reviewer. Any patterns in recent performance to consider? 2 sentences.', extra: '' },
        { id: 'master-agent', system: 'You are the Master Agent. Tally votes FOR vs AGAINST. Give final recommendation. 2 sentences.', extra: '' },
      ]

      for (const a of agents) {
        const response = await askAgent(a.system, conv.join('\n') + '\n' + a.extra)
        conv.push(`[${a.id.toUpperCase()}]: ${response}`)
        await storeMsg(meetingId, symbol, a.id, 'speak', response, null, new Date(ts.getTime() + agents.indexOf(a) * 1000))
        await sleep(200) // rate limit
      }

      // Orchestrator decision
      const decision = await askAgent(
        'You are the Orchestrator. Based on all agents, decide: EXECUTE or REJECT. 2 sentences.',
        conv.join('\n') + '\nFinal decision?'
      )
      const isExecute = /execut|approv|proceed|go ahead/i.test(decision)
      conv.push(`[ORCHESTRATOR DECISION]: ${decision}`)

      // Check real outcome
      const slDist = atrVal * SL_MULT, tpDist = atrVal * TP_MULT
      const entry = price
      const sl = dir === 'long' ? entry - slDist : entry + slDist
      const tp = dir === 'long' ? entry + tpDist : entry - tpDist
      const outcome = checkOutcome(candles, i, dir, entry, sl, tp)
      const pnlUsd = dir === 'long' ? outcome.exitPrice - entry : entry - outcome.exitPrice
      const pnlAed = pnlUsd * 3.6725

      if (isExecute) {
        totalExecuted++
        if (outcome.win) totalWins++; else totalLosses++
        totalPnlUsd += pnlUsd
      }

      const voteFor = conv.filter(m => /bullish|long|buy|support|for|execute|approve|momentum|strong/i.test(m)).length
      const voteAgainst = conv.filter(m => /bearish|reject|against|caution|risk|wait|overbought|weak/i.test(m)).length

      await storeMsg(meetingId, symbol, 'orchestrator', 'decision', decision,
        { execute: isExecute, trigger, direction: dir, votesFor: voteFor, votesAgainst: voteAgainst, agentCount: 12 },
        new Date(ts.getTime() + 12000))

      // Outcome annotation
      const outcomeMsg = isExecute
        ? `OUTCOME: ${dir.toUpperCase()} ${symbol} @ $${f(entry)} → ${outcome.reason} @ $${f(outcome.exitPrice)}. P&L: ${pnlAed >= 0 ? '+' : ''}${pnlAed.toFixed(0)} AED (${outcome.win ? 'WIN' : 'LOSS'}). Held ${outcome.exitIdx - i}h.`
        : `OUTCOME: Trade was REJECTED by War Room. If executed, would have been ${outcome.win ? 'WIN' : 'LOSS'} (${pnlAed >= 0 ? '+' : ''}${pnlAed.toFixed(0)} AED).`

      await storeMsg(meetingId, symbol, 'orchestrator', 'close', outcomeMsg,
        { win: outcome.win, pnlAed, pnlUsd, exitPrice: outcome.exitPrice, reason: outcome.reason, executed: isExecute },
        new Date(ts.getTime() + 13000))

      console.log(`    ${isExecute ? 'EXECUTED' : 'REJECTED'} | Actual: ${outcome.reason} ${outcome.win ? 'WIN' : 'LOSS'} ${pnlAed >= 0 ? '+' : ''}${pnlAed.toFixed(0)} AED | Vote: ${voteFor}-${voteAgainst}`)

      await sleep(500) // rate limit between meetings
    }
  }

  console.log('\n═══════════════════════════════════════════════════════')
  console.log('  BACKTEST RESULTS')
  console.log('═══════════════════════════════════════════════════════')
  console.log(`  Total meetings scanned: ${totalMeetings}`)
  console.log(`  Triggers detected: ${totalTriggers}`)
  console.log(`  Trades executed: ${totalExecuted}`)
  console.log(`  Wins: ${totalWins} | Losses: ${totalLosses}`)
  console.log(`  Win rate: ${totalExecuted > 0 ? (totalWins / totalExecuted * 100).toFixed(1) : '—'}%`)
  console.log(`  Total P&L: $${totalPnlUsd.toFixed(2)} (AED ${(totalPnlUsd * 3.6725).toFixed(0)})`)
  console.log('═══════════════════════════════════════════════════════')
}

function f(n: number) { return n >= 10000 ? n.toLocaleString('en', { maximumFractionDigits: 0 }) : n.toFixed(2) }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

main().catch(console.error)
