import { callAgent } from '@/lib/anthropic'
import { computeIndicators, technicalScore, detectBBSqueeze, detectEMACross, detectRSIExtreme, detectMACDCross, detectVolumeSpike, detectEMA50Breakout, quickBacktest } from '@/lib/indicators'
import { createServiceSupabase } from '@/lib/supabase'
import { sendSignalAlert } from '@/lib/telegram'
import { notifySignal as waSignal, notifyWarRoomDecision as waDecision, notifyWarRoomOpen as waOpen, notifyWarRoomDebate as waDebate, notifyWarRoomBlocked as waBlocked, notifyWarRoomScan as waScan } from '@/lib/whatsapp'
import { checkSafety } from '@/lib/safety'
import { hardRiskCheck, checkDailyLossLimit, getTradeStats, riskBasedPositionSize } from '@/lib/risk-controls'
import { AGENT_PROMPTS, AGENT_TOKEN_LIMITS, type AgentId, type PromptContext } from '@/agents/agent-prompts'
import { runPostMeetingBrief } from '@/agents/meta-agent'
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

  const cooldownMin = 15
  const { data: recentDebates } = await db.from('war_room_messages')
    .select('instrument, created_at')
    .eq('role', 'decision')
    .gte('created_at', new Date(Date.now() - cooldownMin * 60_000).toISOString())
  const coolingDown = new Set((recentDebates ?? []).map(d => d.instrument))

  const scanResults: { symbol: string; status: string }[] = []

  for (const instrument of ALL_INSTRUMENTS) {
    const meetingId = crypto.randomUUID()
    try {
      const result = await runMeeting(db, meetingId, instrument, coolingDown.has(instrument))
      scanResults.push({ symbol: instrument, status: result })
    } catch (err) {
      await say(db, meetingId, instrument, { agent: 'orchestrator', role: 'alert', message: `Error: ${String(err).slice(0, 150)}` })
      scanResults.push({ symbol: instrument, status: 'error' })
    }
  }

  const triggersFound = scanResults.filter(s => s.status !== 'no trigger' && s.status !== 'error' && s.status !== 'cooldown').length
  await waScan({
    totalScanned: ALL_INSTRUMENTS.length,
    triggersFound,
    instruments: scanResults,
  }).catch(() => {})
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEETING — Full 12-agent debate for triggered instruments
// ═══════════════════════════════════════════════════════════════════════════════

async function runMeeting(db: ReturnType<typeof createServiceSupabase>, meetingId: string, instrument: Instrument, onCooldown = false): Promise<string> {
  const conv: Msg[] = []

  const { data: candles } = await db.from('price_history').select('*')
    .eq('symbol', instrument).eq('interval', '1h')
    .order('timestamp', { ascending: false }).limit(200)

  if (!candles || candles.length < 30) {
    await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close', message: `${instrument}: insufficient data (${candles?.length ?? 0} candles). Skipped.` })
    return 'no trigger'
  }

  const ohlcv: OHLCV[] = candles.reverse().map(c => ({
    timestamp: new Date(c.timestamp).getTime(),
    open: +c.open, high: +c.high, low: +c.low, close: +c.close, volume: +c.volume,
  }))

  const ind = computeIndicators(ohlcv)
  const tech = technicalScore(ind)
  const price = ind.current_price

  // Check all trigger types — first match wins (ordered by signal quality)
  const rawTriggers = [
    { name: 'BB Squeeze Breakout', ...detectBBSqueeze(ohlcv) },
    { name: 'EMA 12/26 Cross',    ...detectEMACross(ohlcv) },
    { name: 'MACD Crossover',     ...detectMACDCross(ohlcv) },
    { name: 'RSI Extreme',        ...detectRSIExtreme(ohlcv) },
    { name: 'Volume Spike',       ...detectVolumeSpike(ohlcv) },
    { name: 'EMA 50 Breakout',    ...detectEMA50Breakout(ohlcv) },
  ].filter(t => t.triggered)

  const trigger = rawTriggers[0]?.name ?? null
  const triggerDir = rawTriggers[0]?.direction ?? null
  const allTriggers = rawTriggers.map(t => t.name).join(' + ') || null

  if (trigger && onCooldown) {
    await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
      message: `${instrument} @ $${f(price)} | ${allTriggers} detected but on cooldown (debated <15min ago). Adjourned.`,
      data: { price, trigger: allTriggers, cooldown: true },
    })
    return 'cooldown'
  }

  if (!trigger) {
    await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
      message: `${instrument} @ $${f(price)} | RSI:${ind.rsi.toFixed(0)} MACD:${ind.macd.histogram > 0 ? '+' : '-'}${Math.abs(ind.macd.histogram).toFixed(2)} BB:${(ind.bb.percentB * 100).toFixed(0)}% Vol:${ind.volume_ratio.toFixed(1)}x EMA:${price > ind.ema_50 ? '↑' : '↓'} | No trigger. Adjourned.`,
      data: { price, rsi: ind.rsi, macd_hist: ind.macd.histogram, bb_pctb: ind.bb.percentB, volume_ratio: ind.volume_ratio, trigger: null },
    })
    return 'no trigger'
  }

  // ═══ FULL DEBATE — all 12 agents participate ═══

  const triggerLabel = rawTriggers.length > 1 ? `${allTriggers} (${rawTriggers.length} signals)` : trigger
  await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'open',
    message: `MEETING: ${instrument} @ $${f(price)}. ${triggerLabel} detected → ${triggerDir?.toUpperCase()}. RSI:${ind.rsi.toFixed(0)} ATR:${ind.atr.toFixed(2)} Vol:${ind.volume_ratio.toFixed(1)}x. Calling all agents.`,
    data: { price, rsi: ind.rsi, atr: ind.atr, trigger: allTriggers, triggerDir, triggerCount: rawTriggers.length },
  })

  await waOpen({
    instrument, price, trigger: allTriggers ?? trigger, direction: triggerDir ?? 'long',
    rsi: ind.rsi, atr: ind.atr, volumeRatio: ind.volume_ratio, triggerCount: rawTriggers.length,
  }).catch(() => {})

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

  // Get news context
  const { data: news } = await db.from('news').select('headline, sentiment').order('published_at', { ascending: false }).limit(5)
  const newsCtx = (news ?? []).map(n => `${n.headline} [${n.sentiment}]`).join('; ') || 'No recent news.'

  // Build shared prompt context for all agents
  const promptCtx: PromptContext = {
    instrument, triggerDir, price,
    rsi: ind.rsi, atr: ind.atr, bbPercentB: ind.bb.percentB,
    ema20: ind.ema_20, ema50: ind.ema_50, ema200: ind.ema_200,
    macdHist: ind.macd.histogram, volumeRatio: ind.volume_ratio,
    priceCtx, newsCtx, tradeHist,
    openPositions: openPos ?? 0, recentLosses, trigger: allTriggers ?? trigger,
  }

  // ── 1. MACRO AGENT ──
  await agentSpeak(db, meetingId, instrument, conv, 'macro-agent', promptCtx,
    `${convoStr()}\n\nCurrent date: ${new Date().toLocaleDateString('en')}. Asset: ${instrument}. Direction: ${triggerDir}.`)

  // ── 2. CORRELATION AGENT ──
  await agentSpeak(db, meetingId, instrument, conv, 'correlation-agent', promptCtx,
    `${convoStr()}\n\nAll asset prices right now: ${priceCtx}\n\nDoes cross-asset data support ${triggerDir} on ${instrument}?`)

  // ── 3. BULL AGENT (ICT) ──
  await agentSpeak(db, meetingId, instrument, conv, 'bull-agent', promptCtx,
    `${convoStr()}\n\nMake the case FOR ${triggerDir?.toUpperCase()} ${instrument} at $${f(price)}. RSI:${ind.rsi.toFixed(0)} ATR:${ind.atr.toFixed(2)} BB%B:${(ind.bb.percentB * 100).toFixed(0)}% EMA20:${ind.ema_20.toFixed(2)} EMA50:${ind.ema_50.toFixed(2)} EMA200:${ind.ema_200.toFixed(2)} MACD:${ind.macd.histogram > 0 ? '+' : ''}${ind.macd.histogram.toFixed(2)} Vol:${ind.volume_ratio.toFixed(1)}x`)

  // ── 4. BEAR AGENT (Wyckoff) ──
  await agentSpeak(db, meetingId, instrument, conv, 'bear-agent', promptCtx,
    `${convoStr()}\n\nStress-test this trade. RSI:${ind.rsi.toFixed(0)} ATR:${ind.atr.toFixed(2)} BB%B:${(ind.bb.percentB * 100).toFixed(0)}% EMA20:${ind.ema_20.toFixed(2)} EMA50:${ind.ema_50.toFixed(2)} EMA200:${ind.ema_200.toFixed(2)} Vol:${ind.volume_ratio.toFixed(1)}x. What could go wrong?`)

  // ── 5. SCALPER AGENT ──
  await agentSpeak(db, meetingId, instrument, conv, 'scalper-agent', promptCtx,
    `${convoStr()}\n\nIs there a scalp opportunity on ${instrument} at $${f(price)} right now? RSI:${ind.rsi.toFixed(0)} ATR:${ind.atr.toFixed(2)} BB%B:${(ind.bb.percentB * 100).toFixed(0)}%`)

  // ── 6. TREND AGENT ──
  await agentSpeak(db, meetingId, instrument, conv, 'trend-agent', promptCtx,
    `${convoStr()}\n\nEMA20:${ind.ema_20.toFixed(2)} EMA50:${ind.ema_50.toFixed(2)} EMA200:${ind.ema_200.toFixed(2)} Price:$${f(price)} RSI:${ind.rsi.toFixed(0)} MACD hist:${ind.macd.histogram.toFixed(2)}. Trend picture for ${instrument}?`)

  // ── 7. MARKET ANALYST ──
  await agentSpeak(db, meetingId, instrument, conv, 'market-analyst', promptCtx,
    `${convoStr()}\n\nRecent news: ${newsCtx}\n\nSentiment assessment for ${instrument}?`)

  // ── 8. SIGNAL GENERATOR ──
  await agentSpeak(db, meetingId, instrument, conv, 'signal-generator', promptCtx,
    `${convoStr()}\n\nGenerate the signal for ${instrument} at $${f(price)}, ATR=${ind.atr.toFixed(2)}. Full debate above — synthesize into precise trade levels.`)

  // ── 9. RISK MANAGER ──
  await agentSpeak(db, meetingId, instrument, conv, 'risk-manager', promptCtx,
    `${convoStr()}\n\nRisk decision for ${instrument}? Open positions: ${openPos ?? 0}/3. Recent losses: ${recentLosses}/10.`)

  // ── 10. TRADE REVIEWER ──
  await agentSpeak(db, meetingId, instrument, conv, 'trade-reviewer', promptCtx,
    `${convoStr()}\n\nRecent trade history: ${tradeHist}\n\nPerformance context for ${instrument}?`)

  // ── 11. MASTER AGENT ──
  await agentSpeak(db, meetingId, instrument, conv, 'master-agent', promptCtx,
    `${convoStr()}\n\nSummarize the full debate. List each agent's stance. Tally the votes. Give your weighted recommendation.`)

  // ── WhatsApp: Send debate summary to the team ──
  const debateAgents = conv
    .filter(m => m.role === 'speak' && m.agent !== 'orchestrator')
    .map(m => {
      const bullish = /bullish|long|buy|support|for|approve|momentum|breakout|upside/i.test(m.message)
      const bearish = /bearish|reject|against|caution|risk|short|sell|overbought|trap|downside/i.test(m.message)
      const stance = bullish && !bearish ? 'bullish' as const : bearish && !bullish ? 'bearish' as const : 'neutral' as const
      return { name: m.agent, stance, summary: m.message.slice(0, 80) }
    })
  await waDebate({ instrument, agents: debateAgents }).catch(() => {})

  // ── 12. ORCHESTRATOR FINAL DECISION ──
  const orchDbPrompt = await getActivePrompt(db, 'orchestrator')
  const orchDefaultPrompt = AGENT_PROMPTS['orchestrator'](promptCtx)
  const decisionResponse = await callAgent<string>({
    system: orchDbPrompt ?? orchDefaultPrompt,
    user: `${convoStr()}\n\nFinal decision for ${instrument}. You have heard all 11 agents. Make your call.`,
    maxTokens: AGENT_TOKEN_LIMITS['orchestrator'],
    timeoutMs: 30000,
  })

  const isExecute = /execut|approv|proceed|go ahead|take the trade/i.test(decisionResponse)

  // Count votes from the conversation
  const voteFor = conv.filter(m => /bullish|long|buy|support|agree|for|execute|approve/i.test(m.message) && m.agent !== 'orchestrator').length
  const voteAgainst = conv.filter(m => /bearish|reject|against|caution|risk|wait|pass/i.test(m.message) && m.agent !== 'orchestrator').length

  await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'decision',
    message: decisionResponse,
    data: { execute: isExecute, trigger, direction: triggerDir, votesFor: voteFor, votesAgainst: voteAgainst, agentCount: 12 },
  })

  // Build agent stances for meta-agent brief
  const agentStances = conv
    .filter(m => m.role === 'speak' && m.agent !== 'orchestrator')
    .map(m => {
      const b = /bullish|long|buy|support|for|approve|execute/i.test(m.message)
      const br = /bearish|short|sell|reject|against|caution|risk/i.test(m.message)
      return { agent: m.agent, stance: (b && !br ? 'bull' : br && !b ? 'bear' : 'neutral') as 'bull' | 'bear' | 'neutral' }
    })

  // Execute if approved — but must pass hard risk checks first
  if (isExecute && triggerDir) {
    const slMult = 2.5
    const tpMult = trigger === 'BB Squeeze Breakout' ? 4 : 5
    const slDist = ind.atr * slMult
    const tpDist = ind.atr * tpMult
    const entry = price
    const sl = triggerDir === 'long' ? entry - slDist : entry + slDist
    const tp = triggerDir === 'long' ? entry + tpDist : entry - tpDist
    const rr = Math.round((tpDist / slDist) * 100) / 100

    // ── HARD RISK GATE — same rules as runRiskManager in agents/index.ts ──
    const riskCheck = hardRiskCheck(rr, entry, sl, openPos ?? 0)
    if (!riskCheck.allowed) {
      await speak(db, meetingId, instrument, conv, { agent: 'risk-manager', role: 'decision',
        message: `HARD REJECT: ${riskCheck.reason}`,
      })
      await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
        message: `BLOCKED by risk rules: ${riskCheck.reason}. Meeting closed.`,
      })
      await waBlocked({ instrument, reason: riskCheck.reason, blocker: 'Risk Manager' }).catch(() => {})
      await runPostMeetingBrief({ instrument, decision: 'blocked', votesFor: voteFor, votesAgainst: voteAgainst, trigger: allTriggers ?? trigger, agentStances }).catch(() => {})
      return 'blocked'
    }

    // ── DAILY LOSS LIMIT CHECK ──
    const { data: portfolio } = await db.from('portfolio').select('capital').eq('is_demo', false).single()
    const capitalAed = portfolio?.capital ?? 5000
    const dailyCheck = await checkDailyLossLimit(capitalAed)
    if (!dailyCheck.allowed) {
      await speak(db, meetingId, instrument, conv, { agent: 'risk-manager', role: 'decision',
        message: `DAILY LIMIT: ${dailyCheck.reason}`,
      })
      await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
        message: `BLOCKED by daily loss limit. Meeting closed.`,
      })
      await waBlocked({ instrument, reason: dailyCheck.reason, blocker: 'Daily Loss Limit' }).catch(() => {})
      await runPostMeetingBrief({ instrument, decision: 'blocked', votesFor: voteFor, votesAgainst: voteAgainst, trigger: allTriggers ?? trigger, agentStances }).catch(() => {})
      return 'blocked'
    }

    // ── QUICK BACKTEST — reject if strategy fails on recent data ──
    const strategyType = trigger === 'BB Squeeze Breakout' ? 'BB_SQUEEZE' as const : 'EMA_CROSS' as const
    const bt = quickBacktest(ohlcv, strategyType, slMult, tpMult)
    if (!bt.passed) {
      await speak(db, meetingId, instrument, conv, { agent: 'risk-manager', role: 'decision',
        message: `BACKTEST FAIL: ${strategyType} win rate ${(bt.winRate * 100).toFixed(0)}% (${bt.wins}W/${bt.losses}L) on recent data — below 35% threshold`,
      })
      await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
        message: `BLOCKED by backtest validation. Meeting closed.`,
      })
      await waBlocked({ instrument, reason: `Backtest failed: ${bt.wins}W/${bt.losses}L (${(bt.winRate * 100).toFixed(0)}%)`, blocker: 'Backtest Validation' }).catch(() => {})
      await runPostMeetingBrief({ instrument, decision: 'blocked', votesFor: voteFor, votesAgainst: voteAgainst, trigger: allTriggers ?? trigger, agentStances }).catch(() => {})
      return 'blocked'
    }

    // ── KELLY-WEIGHTED CONFIDENCE ──
    const stats = await getTradeStats()
    const dynamicConf = stats.totalTrades >= 10
      ? Math.round(80 * (0.5 + stats.winRate * 0.5))
      : 80

    const { data: saved } = await db.from('signals').insert({
      instrument, direction: triggerDir,
      entry_price: entry, stop_loss: sl, take_profit_1: tp,
      take_profit_2: triggerDir === 'long' ? entry + tpDist * 1.5 : entry - tpDist * 1.5,
      confidence: dynamicConf, risk_reward: rr,
      reasoning: `War Room 12-agent consensus (${voteFor}/${voteAgainst}) ${trigger} | BT:${bt.wins}W/${bt.losses}L Kelly:${(stats.kellyFraction * 100).toFixed(1)}%`,
      ai_analysis: decisionResponse, news_sentiment: 'neutral',
      technical_score: tech.score, status: 'active',
    }).select().single()

    if (saved) {
      await sendSignalAlert(saved as Signal).catch(() => {})
      await waSignal(saved as Signal).catch(() => {})
    }

    await waDecision({
      instrument, decision: decisionResponse, execute: true,
      direction: triggerDir, entry, sl, tp, rr,
      votesFor: voteFor, votesAgainst: voteAgainst,
      trigger: allTriggers ?? undefined,
      backtestWins: bt.wins, backtestLosses: bt.losses,
      kelly: stats.kellyFraction,
    }).catch(() => {})

    await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
      message: `EXECUTED: ${triggerDir.toUpperCase()} ${instrument} @ $${f(entry)} | SL:$${f(sl)} TP:$${f(tp)} R:R ${rr}x | Vote: ${voteFor}-${voteAgainst} | BT:${bt.wins}W/${bt.losses}L | Kelly:${(stats.kellyFraction * 100).toFixed(1)}%. Meeting closed.`,
    })
    await runPostMeetingBrief({ instrument, decision: 'executed', direction: triggerDir, entry, sl, tp, rr, votesFor: voteFor, votesAgainst: voteAgainst, trigger: allTriggers ?? trigger, agentStances }).catch(() => {})
    return 'executed'
  } else {
    await waDecision({
      instrument, decision: decisionResponse, execute: false,
      votesFor: voteFor, votesAgainst: voteAgainst,
      trigger: allTriggers ?? undefined,
    }).catch(() => {})

    await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
      message: `REJECTED: No trade on ${instrument}. Vote: ${voteFor} for, ${voteAgainst} against. Meeting closed.`,
    })
    await runPostMeetingBrief({ instrument, decision: 'rejected', votesFor: voteFor, votesAgainst: voteAgainst, trigger: allTriggers ?? trigger, agentStances }).catch(() => {})
    return 'rejected'
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function getActivePrompt(db: ReturnType<typeof createServiceSupabase>, agentId: string): Promise<string | null> {
  try {
    const { data } = await db.from('agent_knowledge')
      .select('content').eq('agent_id', agentId).eq('type', 'prompt').eq('active', true)
      .order('version', { ascending: false }).limit(1).single()
    return data?.content ?? null
  } catch { return null }
}

async function agentSpeak(
  db: ReturnType<typeof createServiceSupabase>,
  meetingId: string, instrument: Instrument, conv: Msg[],
  agentId: AgentId, promptCtx: PromptContext, userMsg: string,
) {
  try {
    const dbPrompt = await getActivePrompt(db, agentId)
    const defaultPrompt = AGENT_PROMPTS[agentId](promptCtx)
    const system = dbPrompt ?? defaultPrompt
    const maxTokens = AGENT_TOKEN_LIMITS[agentId] ?? 1200
    const response = await callAgent<string>({ system, user: userMsg, maxTokens, timeoutMs: 30000 })
    await speak(db, meetingId, instrument, conv, { agent: agentId, role: 'speak', message: response })
  } catch (err) {
    await speak(db, meetingId, instrument, conv, { agent: agentId, role: 'alert', message: `[timeout/error] ${String(err).slice(0, 80)}` })
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
