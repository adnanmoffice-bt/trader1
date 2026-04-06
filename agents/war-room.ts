import { callAgent } from '@/lib/anthropic'
import { computeIndicators, technicalScore, detectBBSqueeze, detectEMACross } from '@/lib/indicators'
import { createServiceSupabase } from '@/lib/supabase'
import { sendSignalAlert } from '@/lib/telegram'
import { checkSafety } from '@/lib/safety'
import type { Instrument, OHLCV, Signal } from '@/types'

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const ALL_INSTRUMENTS: Instrument[] = [
  'BTC/USD', 'ETH/USD', 'SOL/USD', 'BNB/USD', 'DOGE/USD', 'AVAX/USD', 'LINK/USD',
  'XAU/USD', 'XAG/USD', 'BRENT', 'WTI',
  'EUR/USD', 'GBP/USD', 'USD/JPY',
  'SPY', 'QQQ',
]

interface Msg { agent: string; role: string; message: string; data?: Record<string, unknown> }

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY
// ═══════════════════════════════════════════════════════════════════════════════

export async function runWarRoom(): Promise<void> {
  const db = createServiceSupabase()

  const safety = await checkSafety()
  if (!safety.safe) {
    await say(db, crypto.randomUUID(), null, { agent: 'orchestrator', role: 'alert', message: `WAR ROOM BLOCKED: ${safety.reason}` })
    return
  }

  // Scan ALL instruments — quick scan first, full meeting only on triggers
  for (const instrument of ALL_INSTRUMENTS) {
    const meetingId = crypto.randomUUID()
    try {
      await runMeeting(db, meetingId, instrument)
    } catch (err) {
      await say(db, meetingId, instrument, { agent: 'orchestrator', role: 'alert', message: `Error: ${String(err).slice(0, 150)}` })
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEETING — Full 12-agent debate for triggered instruments
// ═══════════════════════════════════════════════════════════════════════════════

async function runMeeting(db: ReturnType<typeof createServiceSupabase>, meetingId: string, instrument: Instrument) {
  const conv: Msg[] = []

  // Get candles
  const { data: candles } = await db.from('price_history').select('*')
    .eq('symbol', instrument).eq('interval', '1h')
    .order('timestamp', { ascending: false }).limit(200)

  if (!candles || candles.length < 30) {
    await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close', message: `${instrument}: insufficient data (${candles?.length ?? 0} candles). Skipped.` })
    return
  }

  const ohlcv: OHLCV[] = candles.reverse().map(c => ({
    timestamp: new Date(c.timestamp).getTime(),
    open: +c.open, high: +c.high, low: +c.low, close: +c.close, volume: +c.volume,
  }))

  const ind = computeIndicators(ohlcv)
  const tech = technicalScore(ind)
  const bbSig = detectBBSqueeze(ohlcv)
  const emaCross = detectEMACross(ohlcv)
  const price = ind.current_price
  const trigger = bbSig.triggered ? 'BB Squeeze Breakout' : emaCross.triggered ? 'EMA 12/26 Cross' : null
  const triggerDir = bbSig.triggered ? bbSig.direction : emaCross.triggered ? emaCross.direction : null

  // Quick scan — no trigger = short meeting
  if (!trigger) {
    await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
      message: `${instrument} @ $${f(price)} | RSI:${ind.rsi.toFixed(0)} MACD:${ind.macd.histogram > 0 ? '+' : '-'} BB:${(ind.bb.percentB * 100).toFixed(0)}% | No trigger. Adjourned.`,
      data: { price, rsi: ind.rsi, trigger: null },
    })
    return
  }

  // ═══ FULL DEBATE — all 12 agents participate ═══

  await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'open',
    message: `MEETING: ${instrument} @ $${f(price)}. ${trigger} detected → ${triggerDir?.toUpperCase()}. RSI:${ind.rsi.toFixed(0)} ATR:${ind.atr.toFixed(2)} Vol:${ind.volume_ratio.toFixed(1)}x. Calling all agents.`,
    data: { price, rsi: ind.rsi, atr: ind.atr, trigger, triggerDir },
  })

  const convoStr = () => conv.map(m => `[${m.agent.toUpperCase()}]: ${m.message}`).join('\n')

  // Get cross-asset context for Correlation Agent
  const { data: allPrices } = await db.from('market_data').select('symbol, price, change_pct_24h').limit(20)
  const priceCtx = (allPrices ?? []).map(p => `${p.symbol}: $${f(+p.price)} (${(+p.change_pct_24h) >= 0 ? '+' : ''}${(+p.change_pct_24h).toFixed(1)}%)`).join(', ')

  // Get recent trade history for Trade Reviewer
  const { data: pastTrades } = await db.from('demo_trades').select('instrument, direction, pnl_aed, exit_reason')
    .not('exit_time', 'is', null).order('exit_time', { ascending: false }).limit(10)
  const tradeHist = (pastTrades ?? []).map(t => `${t.instrument} ${t.direction} → ${t.exit_reason} (${+t.pnl_aed >= 0 ? '+' : ''}${(+t.pnl_aed).toFixed(0)})`).join(', ') || 'No history.'

  // Get open positions
  const { count: openPos } = await db.from('positions').select('*', { count: 'exact', head: true })
  const recentLosses = (pastTrades ?? []).filter(t => +t.pnl_aed < 0).length

  // ── 1. MACRO AGENT ──
  await agentSpeak(db, meetingId, instrument, conv, 'macro-agent',
    `You are the Macro Economist in a trading War Room. Analyze macro conditions: Fed policy, interest rates, geopolitical risks, risk-on/risk-off environment. How does the macro picture support or undermine this ${triggerDir} trade on ${instrument}? 2-3 sentences max.`,
    `${convoStr()}\n\nCurrent date: ${new Date().toLocaleDateString('en')}. Asset: ${instrument}. Direction: ${triggerDir}.`)

  // ── 2. CORRELATION AGENT ──
  await agentSpeak(db, meetingId, instrument, conv, 'correlation-agent',
    `You are the Cross-Asset Correlation Agent. Check if other correlated assets confirm or contradict this trade. If BTC moves, does ETH follow? If Gold rises, does USD weaken? 2-3 sentences max.`,
    `${convoStr()}\n\nAll asset prices right now: ${priceCtx}\n\nDoes cross-asset data support ${triggerDir} on ${instrument}?`)

  // ── 3. BULL AGENT ──
  await agentSpeak(db, meetingId, instrument, conv, 'bull-agent',
    `You are the Bull Agent. Your job is to make the STRONGEST possible case FOR this trade. Find every bullish signal, momentum indicator, and reason to enter. Be passionate but data-driven. 2-3 sentences.`,
    `${convoStr()}\n\nMake the case FOR ${triggerDir?.toUpperCase()} ${instrument} at $${f(price)}.`)

  // ── 4. BEAR AGENT ──
  await agentSpeak(db, meetingId, instrument, conv, 'bear-agent',
    `You are the Bear Agent. Your job is to find every reason NOT to take this trade. Look for risks, overbought/oversold extremes, potential traps, and failure scenarios. Be the devil's advocate. Challenge what the Bull Agent said. 2-3 sentences.`,
    `${convoStr()}\n\nMake the case AGAINST this trade. What could go wrong?`)

  // ── 5. SCALPER AGENT ──
  await agentSpeak(db, meetingId, instrument, conv, 'scalper-agent',
    `You are the Scalper Agent focused on short-term 1-4 hour trades. Given the current RSI ${ind.rsi.toFixed(0)}, ATR ${ind.atr.toFixed(2)}, and BB %B ${(ind.bb.percentB * 100).toFixed(0)}%, is there a quick scalping opportunity? Suggest tight entry, SL, TP for a fast trade. 2-3 sentences.`,
    `${convoStr()}\n\nIs there a scalp opportunity on ${instrument} right now?`)

  // ── 6. TREND AGENT ──
  await agentSpeak(db, meetingId, instrument, conv, 'trend-agent',
    `You are the Trend Following Agent. Look at the bigger picture: EMA20 vs EMA50 vs EMA200 alignment, multi-day momentum. Is this a new trend starting or a false breakout? Should we hold for days or is this just noise? 2-3 sentences.`,
    `${convoStr()}\n\nEMA20:${ind.ema_20.toFixed(2)} EMA50:${ind.ema_50.toFixed(2)} EMA200:${ind.ema_200.toFixed(2)}. What's the trend picture for ${instrument}?`)

  // ── 7. MARKET ANALYST ──
  const { data: news } = await db.from('news').select('headline, sentiment').order('published_at', { ascending: false }).limit(5)
  const newsCtx = (news ?? []).map(n => `${n.headline} [${n.sentiment}]`).join('; ') || 'No recent news.'
  await agentSpeak(db, meetingId, instrument, conv, 'market-analyst',
    `You are the Market Analyst. Synthesize news sentiment and market conditions. How does current news flow support or contradict the proposed trade? 2-3 sentences.`,
    `${convoStr()}\n\nRecent news: ${newsCtx}\n\nSentiment assessment for ${instrument}?`)

  // ── 8. SIGNAL GENERATOR ──
  await agentSpeak(db, meetingId, instrument, conv, 'signal-generator',
    `You are the Signal Generator. Based on the full debate so far, generate a SPECIFIC trade signal. Include: direction, entry price, stop loss (use 2.5x ATR = ${(ind.atr * 2.5).toFixed(2)}), take profit (use 4-5x ATR), and confidence %. Reference what other agents said. 2-3 sentences.`,
    `${convoStr()}\n\nGenerate the signal for ${instrument} at $${f(price)}, ATR=${ind.atr.toFixed(2)}.`)

  // ── 9. RISK MANAGER ──
  await agentSpeak(db, meetingId, instrument, conv, 'risk-manager',
    `You are the Risk Manager. Review everything said. Open positions: ${openPos ?? 0}/3 max. Recent losses: ${recentLosses}/10. Max risk: 2%. Min R:R: 1.5:1. APPROVE, MODIFY, or REJECT the proposed trade. State conditions. 2-3 sentences.`,
    `${convoStr()}\n\nRisk decision for ${instrument}?`)

  // ── 10. TRADE REVIEWER ──
  await agentSpeak(db, meetingId, instrument, conv, 'trade-reviewer',
    `You are the Trade Reviewer. Look at our recent performance and give context. Are we on a winning streak or losing? Are we good at this instrument? Any patterns in our past trades that are relevant? 2-3 sentences.`,
    `${convoStr()}\n\nRecent trade history: ${tradeHist}\n\nPerformance context?`)

  // ── 11. MASTER AGENT (meta-analysis) ──
  await agentSpeak(db, meetingId, instrument, conv, 'master-agent',
    `You are the Master Agent. You've heard ALL other agents. Summarize the debate: count how many agents are FOR vs AGAINST this trade. Identify the strongest arguments on each side. Give a FINAL RECOMMENDATION with a confidence-weighted vote tally. 2-3 sentences.`,
    `${convoStr()}\n\nSummarize the debate and tally the votes.`)

  // ── 12. ORCHESTRATOR FINAL DECISION ──
  const decisionResponse = await callAgent<string>({
    system: `You are the Orchestrator making the FINAL DECISION. Based on the Master Agent's vote tally and ALL agents' input, decide: EXECUTE, MODIFY, or REJECT. Be decisive. State the exact action and why. 2-3 sentences.`,
    user: `${convoStr()}\n\nFinal decision for ${instrument}. State clearly: EXECUTE, MODIFY, or REJECT.`,
    maxTokens: 150, timeoutMs: 15000,
  })

  const isExecute = /execut|approv|proceed|go ahead|take the trade/i.test(decisionResponse)

  // Count votes from the conversation
  const voteFor = conv.filter(m => /bullish|long|buy|support|agree|for|execute|approve/i.test(m.message) && m.agent !== 'orchestrator').length
  const voteAgainst = conv.filter(m => /bearish|reject|against|caution|risk|wait|pass/i.test(m.message) && m.agent !== 'orchestrator').length

  await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'decision',
    message: decisionResponse,
    data: { execute: isExecute, trigger, direction: triggerDir, votesFor: voteFor, votesAgainst: voteAgainst, agentCount: 12 },
  })

  // Execute if approved
  if (isExecute && triggerDir) {
    const slDist = ind.atr * 2.5
    const tpDist = ind.atr * (trigger === 'BB Squeeze Breakout' ? 4 : 5)
    const entry = price
    const sl = triggerDir === 'long' ? entry - slDist : entry + slDist
    const tp = triggerDir === 'long' ? entry + tpDist : entry - tpDist
    const rr = Math.round((tpDist / slDist) * 100) / 100

    const { data: saved } = await db.from('signals').insert({
      instrument, direction: triggerDir,
      entry_price: entry, stop_loss: sl, take_profit_1: tp,
      take_profit_2: triggerDir === 'long' ? entry + tpDist * 1.5 : entry - tpDist * 1.5,
      confidence: 80, risk_reward: rr,
      reasoning: `War Room 12-agent consensus (${voteFor} for, ${voteAgainst} against): ${trigger}`,
      ai_analysis: decisionResponse, news_sentiment: 'neutral',
      technical_score: tech.score, status: 'active',
    }).select().single()

    if (saved) await sendSignalAlert(saved as Signal).catch(() => {})

    await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
      message: `EXECUTED: ${triggerDir.toUpperCase()} ${instrument} @ $${f(entry)} | SL:$${f(sl)} TP:$${f(tp)} R:R ${rr}x | Vote: ${voteFor}-${voteAgainst}. Meeting closed.`,
    })
  } else {
    await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
      message: `REJECTED: No trade on ${instrument}. Vote: ${voteFor} for, ${voteAgainst} against. Meeting closed.`,
    })
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function agentSpeak(
  db: ReturnType<typeof createServiceSupabase>,
  meetingId: string, instrument: Instrument, conv: Msg[],
  agent: string, system: string, user: string,
) {
  try {
    const response = await callAgent<string>({ system, user, maxTokens: 150, timeoutMs: 15000 })
    await speak(db, meetingId, instrument, conv, { agent, role: 'speak', message: response })
  } catch (err) {
    await speak(db, meetingId, instrument, conv, { agent, role: 'alert', message: `[timeout/error] ${String(err).slice(0, 80)}` })
  }
}

async function speak(db: ReturnType<typeof createServiceSupabase>, meetingId: string, instrument: string | null, conv: Msg[], msg: Msg) {
  conv.push(msg)
  await say(db, meetingId, instrument, msg)
}

async function say(db: ReturnType<typeof createServiceSupabase>, meetingId: string, instrument: string | null, msg: Msg) {
  await db.from('war_room_messages').insert({
    meeting_id: meetingId, agent: msg.agent, role: msg.role,
    message: msg.message, data: msg.data ?? null, instrument,
  }).then(({ error }) => {
    if (error) {
      return db.from('agent_logs').insert({
        agent: msg.agent,
        level: msg.role === 'decision' ? 'ok' : msg.role === 'alert' ? 'warn' : 'info',
        message: `[WAR ROOM] ${msg.message}`,
        metadata: { meeting_id: meetingId, role: msg.role, ...(msg.data ?? {}) },
      })
    }
  })
}

function f(n: number): string {
  return n >= 10000 ? n.toLocaleString('en', { maximumFractionDigits: 0 }) : n >= 100 ? n.toFixed(2) : n.toFixed(2)
}

// Re-export for backwards compat
export { runWarRoom as runOrchestrator }
