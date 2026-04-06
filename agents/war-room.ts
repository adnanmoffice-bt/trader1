import { callAgent } from '@/lib/anthropic'
import { computeIndicators, technicalScore, detectBBSqueeze, detectEMACross, detectRSIExtreme, detectMACDCross, detectVolumeSpike, detectEMA50Breakout, quickBacktest } from '@/lib/indicators'
import { createServiceSupabase } from '@/lib/supabase'
import { sendSignalAlert } from '@/lib/telegram'
import { notifySignal as waSignal, notifyWarRoomDecision as waDecision, notifyWarRoomOpen as waOpen, notifyWarRoomDebate as waDebate, notifyWarRoomBlocked as waBlocked, notifyWarRoomScan as waScan } from '@/lib/whatsapp'
import { checkSafety } from '@/lib/safety'
import { hardRiskCheck, checkDailyLossLimit, getTradeStats, riskBasedPositionSize } from '@/lib/risk-controls'
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

  // ── 1. MACRO AGENT ──
  await agentSpeak(db, meetingId, instrument, conv, 'macro-agent',
    `You are the Macro Economist in a trading War Room. Provide a structured macro analysis:

1. THESIS: State the current macro regime (risk-on, risk-off, transitional) and why
2. KEY FACTORS: Fed policy stance, interest rate trajectory, inflation data, geopolitical risks
3. ASSET IMPACT: How does this macro environment specifically affect ${instrument}?
4. TRADE ALIGNMENT: Does the macro picture support or undermine a ${triggerDir} trade? Give a clear directional bias with reasoning
5. CONFIDENCE: Rate your macro conviction (low/medium/high) with explanation`,
    `${convoStr()}\n\nCurrent date: ${new Date().toLocaleDateString('en')}. Asset: ${instrument}. Direction: ${triggerDir}.`)

  // ── 2. CORRELATION AGENT ──
  await agentSpeak(db, meetingId, instrument, conv, 'correlation-agent',
    `You are the Cross-Asset Correlation Analyst. Perform a thorough cross-asset analysis:

1. CORRELATIONS: Which assets typically move with ${instrument}? Are they confirming or diverging right now?
2. INTERMARKET SIGNALS: Check DXY/USD strength, bond yields, equity risk appetite, commodity trends
3. DIVERGENCES: Flag any unusual divergences that could signal a reversal or acceleration
4. SECTOR ROTATION: Is money flowing into or out of this asset class?
5. VERDICT: Does cross-asset analysis support or contradict the proposed ${triggerDir} trade?`,
    `${convoStr()}\n\nAll asset prices right now: ${priceCtx}\n\nDoes cross-asset data support ${triggerDir} on ${instrument}?`)

  // ── 3. BULL AGENT ──
  await agentSpeak(db, meetingId, instrument, conv, 'bull-agent',
    `You are the Bull Advocate in a trading War Room. Make the STRONGEST possible case FOR this trade with rigorous analysis:

1. ARGUMENT 1: Your best technical reason to enter (cite specific indicator values and price levels)
2. ARGUMENT 2: A momentum or structure-based reason (trend, breakout pattern, volume confirmation)
3. ARGUMENT 3: A risk-reward or catalyst-based reason (upcoming events, historical patterns)
4. PRICE TARGETS: Where could this trade realistically go? Cite support/resistance levels
5. COUNTERPOINT: Acknowledge the strongest bear argument and explain why it's wrong

Be passionate but every claim must reference data from the indicators provided.`,
    `${convoStr()}\n\nMake the case FOR ${triggerDir?.toUpperCase()} ${instrument} at $${f(price)}.`)

  // ── 4. BEAR AGENT ──
  await agentSpeak(db, meetingId, instrument, conv, 'bear-agent',
    `You are the Bear Advocate and Devil's Advocate. Your job is to stress-test this trade and find every reason it could fail:

1. RISK 1: The biggest technical risk (cite specific levels where this trade breaks down)
2. RISK 2: A structural or momentum risk (divergences, exhaustion signals, trap patterns)
3. RISK 3: An external risk (macro headwinds, correlation breakdown, liquidity concerns)
4. WORST CASE: What happens if this trade goes wrong? Where is the pain point?
5. DIRECT REBUTTAL: Challenge the Bull Agent's strongest argument with specific counter-evidence

Be aggressive but data-driven. Your job is to protect capital, not be optimistic.`,
    `${convoStr()}\n\nMake the case AGAINST this trade. What could go wrong?`)

  // ── 5. SCALPER AGENT ──
  await agentSpeak(db, meetingId, instrument, conv, 'scalper-agent',
    `You are the Scalper Agent specializing in short-term 1-4 hour trades. Analyze the immediate price action:

1. MICROSTRUCTURE: Current RSI ${ind.rsi.toFixed(0)}, ATR ${ind.atr.toFixed(2)}, BB %B ${(ind.bb.percentB * 100).toFixed(0)}%. What does this tell you about short-term momentum?
2. ENTRY ZONE: Exact price level for entry and why (support bounce, breakout confirmation, mean reversion)
3. TIGHT LEVELS: Specific SL and TP for a 1-4 hour trade (use 1-1.5x ATR for SL, 2-3x for TP)
4. TIMING: Is NOW the right moment or should we wait for a pullback/confirmation?
5. SCALP vs SWING: Given current volatility, is this better as a quick scalp or should it be held longer?`,
    `${convoStr()}\n\nIs there a scalp opportunity on ${instrument} right now?`)

  // ── 6. TREND AGENT ──
  await agentSpeak(db, meetingId, instrument, conv, 'trend-agent',
    `You are the Trend Analysis Agent. Assess the multi-timeframe trend structure:

1. EMA STACK: EMA20:${ind.ema_20.toFixed(2)} vs EMA50:${ind.ema_50.toFixed(2)} vs EMA200:${ind.ema_200.toFixed(2)}. Are they aligned (bullish/bearish) or mixed? Price relative to each?
2. TREND PHASE: Is this early trend, mature trend, exhaustion, or range-bound? What evidence supports this?
3. MOMENTUM: Is momentum accelerating or decelerating? Any divergences between price and momentum indicators?
4. KEY LEVELS: What are the critical support/resistance levels that would confirm or invalidate the trend?
5. HOLD DURATION: Based on trend strength, should this be a multi-day swing trade or is the trend too weak/noisy?`,
    `${convoStr()}\n\nEMA20:${ind.ema_20.toFixed(2)} EMA50:${ind.ema_50.toFixed(2)} EMA200:${ind.ema_200.toFixed(2)}. What's the trend picture for ${instrument}?`)

  // ── 7. MARKET ANALYST ──
  const { data: news } = await db.from('news').select('headline, sentiment').order('published_at', { ascending: false }).limit(5)
  const newsCtx = (news ?? []).map(n => `${n.headline} [${n.sentiment}]`).join('; ') || 'No recent news.'
  await agentSpeak(db, meetingId, instrument, conv, 'market-analyst',
    `You are the Market Sentiment Analyst. Provide a comprehensive sentiment assessment:

1. NEWS FLOW: Analyze the recent headlines — what narrative is the market pricing in?
2. SENTIMENT GAUGE: Is market sentiment overly bullish (contrarian sell signal) or overly bearish (contrarian buy)?
3. INSTITUTIONAL FLOW: Based on price action and volume, are institutions buying or selling?
4. CATALYST WATCH: Any upcoming events (earnings, Fed meetings, economic data) that could move this asset?
5. SENTIMENT VERDICT: Does the sentiment picture support or contradict the proposed ${triggerDir} trade?`,
    `${convoStr()}\n\nRecent news: ${newsCtx}\n\nSentiment assessment for ${instrument}?`)

  // ── 8. SIGNAL GENERATOR ──
  await agentSpeak(db, meetingId, instrument, conv, 'signal-generator',
    `You are the Signal Generator. Synthesize the entire debate into a precise, actionable trade setup:

1. DIRECTION: LONG or SHORT (with conviction level)
2. ENTRY: Exact entry price and entry type (market, limit, stop-entry). Reference current price $${f(price)}
3. STOP LOSS: Exact SL price. ATR = ${ind.atr.toFixed(2)}, suggested SL distance = 2.5x ATR = $${(ind.atr * 2.5).toFixed(2)}. Explain why this level makes sense technically
4. TAKE PROFIT: Primary TP (4x ATR) and extended TP (5x ATR). Cite resistance/support levels that align
5. RISK:REWARD: Calculate the R:R ratio explicitly
6. CONFIDENCE: 0-100% confidence score, weighted by: how many agents agree, strength of technical signals, macro alignment
7. KEY INVALIDATION: What single event or price level would invalidate this entire setup?`,
    `${convoStr()}\n\nGenerate the signal for ${instrument} at $${f(price)}, ATR=${ind.atr.toFixed(2)}.`)

  // ── 9. RISK MANAGER ──
  await agentSpeak(db, meetingId, instrument, conv, 'risk-manager',
    `You are the Risk Manager. Your job is to protect capital above all else. Conduct a thorough risk review:

1. POSITION SIZING: Open positions: ${openPos ?? 0}/3 max. Is there room for this trade? Portfolio concentration risk?
2. RISK BUDGET: Max risk per trade: 2% of capital. Calculate if the proposed SL respects this
3. R:R ANALYSIS: Minimum R:R required: 1.5:1. Does Signal Generator's setup meet this? If not, suggest modifications
4. DRAWDOWN CHECK: Recent losses: ${recentLosses}/10 last trades. Are we in a drawdown? Should we reduce size or skip?
5. CORRELATION RISK: Would this trade increase portfolio correlation risk with existing positions?
6. VERDICT: APPROVE (with any conditions), MODIFY (specify what to change), or REJECT (explain why)`,
    `${convoStr()}\n\nRisk decision for ${instrument}?`)

  // ── 10. TRADE REVIEWER ──
  await agentSpeak(db, meetingId, instrument, conv, 'trade-reviewer',
    `You are the Trade Reviewer and Performance Analyst. Review our track record to provide context for this decision:

1. RECENT PERFORMANCE: Analyze the recent trade history — winning streak, losing streak, or mixed?
2. INSTRUMENT HISTORY: How have we performed on ${instrument} specifically? Any patterns?
3. STRATEGY FIT: The proposed strategy type — does our history show we're good at this kind of trade?
4. BEHAVIORAL FLAGS: Are we showing signs of revenge trading, overconfidence after wins, or excessive caution after losses?
5. RECOMMENDATION: Based on performance data, should we take this trade, skip it, or adjust the size?`,
    `${convoStr()}\n\nRecent trade history: ${tradeHist}\n\nPerformance context?`)

  // ── 11. MASTER AGENT (meta-analysis) ──
  await agentSpeak(db, meetingId, instrument, conv, 'master-agent',
    `You are the Master Agent performing the meta-analysis of the entire debate. Provide a comprehensive summary:

1. VOTE TALLY: Count each agent's stance — clearly list who is FOR and who is AGAINST this trade, by name
2. BULL CASE SUMMARY: The 2-3 strongest arguments FOR the trade (cite which agents made them)
3. BEAR CASE SUMMARY: The 2-3 strongest arguments AGAINST the trade (cite which agents made them)
4. CONSENSUS QUALITY: Is this a strong consensus or deeply divided? Are the disagreements on minor details or fundamental direction?
5. WEIGHTED RECOMMENDATION: Accounting for the quality and relevance of each argument (not just vote count), what should the Orchestrator decide? EXECUTE, MODIFY, or REJECT?
6. CONFIDENCE SCORE: Overall confidence level for the recommended action`,
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
  const decisionResponse = await callAgent<string>({
    system: `You are the Orchestrator making the FINAL DECISION for the trading War Room. Based on the Master Agent's vote tally and ALL agents' input:

1. SUMMARY: Recap the key arguments from both sides (2-3 sentences)
2. WEIGHT: Which agents made the most compelling data-driven points?
3. DECISION: State clearly EXECUTE, MODIFY, or REJECT
4. RATIONALE: Why this decision, citing specific price levels, indicators, and risk factors
5. If EXECUTE: confirm direction, approximate entry zone, and key levels to watch`,
    user: `${convoStr()}\n\nFinal decision for ${instrument}. Be thorough and decisive.`,
    maxTokens: 800, timeoutMs: 25000,
  })

  const isExecute = /execut|approv|proceed|go ahead|take the trade/i.test(decisionResponse)

  // Count votes from the conversation
  const voteFor = conv.filter(m => /bullish|long|buy|support|agree|for|execute|approve/i.test(m.message) && m.agent !== 'orchestrator').length
  const voteAgainst = conv.filter(m => /bearish|reject|against|caution|risk|wait|pass/i.test(m.message) && m.agent !== 'orchestrator').length

  await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'decision',
    message: decisionResponse,
    data: { execute: isExecute, trigger, direction: triggerDir, votesFor: voteFor, votesAgainst: voteAgainst, agentCount: 12 },
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
    return 'rejected'
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
    const response = await callAgent<string>({ system, user, maxTokens: 600, timeoutMs: 25000 })
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
