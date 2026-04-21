import { callAgent, getDailyBudgetStatus } from '@/lib/anthropic'
import { computeIndicators, technicalScore, detectBBSqueeze, detectEMACross, detectRSIExtreme, detectMACDCross, detectVolumeSpike, detectEMA50Breakout, quickBacktest, detectRegime } from '@/lib/indicators'
import { createServiceSupabase } from '@/lib/supabase'
import { sendSignalAlert } from '@/lib/telegram'
import { notifySignal as waSignal, notifyWarRoomDecision as waDecision, notifyWarRoomOpen as waOpen, notifyWarRoomDebate as waDebate, notifyWarRoomBlocked as waBlocked, notifyWarRoomScan as waScan } from '@/lib/whatsapp'
import { checkSafety, getRecoveryMode } from '@/lib/safety'
import type { RecoveryMode } from '@/lib/safety'
import { hardRiskCheck, checkDailyLossLimit, getTradeStats, riskBasedPositionSize } from '@/lib/risk-controls'
import { AGENT_PROMPTS, AGENT_TOKEN_LIMITS, type AgentId, type PromptContext } from '@/agents/agent-prompts'
import { runPostMeetingBrief } from '@/agents/meta-agent'
import { buildMacroContext, formatMacroContext, type MacroSnapshot } from '@/lib/macro-context'
import { generateForecast, formatForecast } from '@/lib/forecast'
import { validateOHLCV } from '@/lib/data-quality'
import type { Instrument, OHLCV, Signal } from '@/types'

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG — Token Budget Controls
// ═══════════════════════════════════════════════════════════════════════════════

// PROFITABLE instruments only — SOL and BNB blacklisted (0% win rate over 28 trades)
// Will re-enable once system proves profitable on core instruments
const ALL_INSTRUMENTS: Instrument[] = [
  'BTC/USD', 'ETH/USD', 'XAU/USD',
  'DOGE/USD', 'AVAX/USD', 'LINK/USD',
  'ADA/USD', 'DOT/USD', 'MATIC/USD', 'NEAR/USD', 'APT/USD',
  // BLACKLISTED: 'SOL/USD' (0W/16L = -$1,344), 'BNB/USD' (0W/12L = -$1,284)
]

const COOLDOWN_MIN = 120  // 2 hours between debates on same instrument (was 30min — too fast)
const MAX_MEETINGS_PER_CYCLE = 2  // max 2 per scan cycle (was 3 — reduce trade frequency)

// Decision-makers get the FULL uncompressed conversation history.
// Debate agents get a compressed digest (each prior message ≤ 150 chars).
const FULL_CONTEXT_AGENTS: Set<AgentId> = new Set([
  'signal-generator', 'risk-manager', 'master-agent', 'orchestrator',
])

interface Msg { agent: string; role: string; message: string; data?: Record<string, unknown> }

// ═══════════════════════════════════════════════════════════════════════════════
// CONVERSATION CONTEXT — compact vs full
// ═══════════════════════════════════════════════════════════════════════════════

function fullConvo(conv: Msg[]): string {
  return conv.map(m => `[${m.agent.toUpperCase()}]: ${m.message}`).join('\n')
}

function compactConvo(conv: Msg[]): string {
  return conv.map(m => {
    const text = m.message.length > 150 ? m.message.slice(0, 147) + '...' : m.message
    return `[${m.agent.toUpperCase()}]: ${text}`
  }).join('\n')
}

function convoFor(conv: Msg[], agentId: AgentId): string {
  return FULL_CONTEXT_AGENTS.has(agentId) ? fullConvo(conv) : compactConvo(conv)
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY
// ═══════════════════════════════════════════════════════════════════════════════

export async function runWarRoom(): Promise<void> {
  const db = createServiceSupabase()

  // ── BUDGET GATE — hard stop when daily AI spend is exhausted ──
  const budget = await getDailyBudgetStatus()
  if (budget.exhausted) {
    await say(db, crypto.randomUUID(), null, {
      agent: 'orchestrator', role: 'alert',
      message: `WAR ROOM PAUSED: Daily AI budget exhausted ($${budget.spent.toFixed(2)}/$${budget.budget.toFixed(2)}). Resumes tomorrow.`,
    })
    return
  }

  const safety = await checkSafety()
  if (!safety.safe) {
    await say(db, crypto.randomUUID(), null, { agent: 'orchestrator', role: 'alert', message: `WAR ROOM BLOCKED: ${safety.reason}` })
    return
  }

  const recovery = getRecoveryMode(safety.drawdownPct)
  if (recovery.active) {
    await say(db, crypto.randomUUID(), null, {
      agent: 'orchestrator', role: 'alert',
      message: `⚠️ ${recovery.message} | Max risk: ${(recovery.maxRiskPct * 100).toFixed(1)}% | Max positions: ${recovery.maxPositions} | Min confidence: ${recovery.minConfidence}% | Min R:R: ${recovery.minRR}x`,
    })
  }

  // ── MACRO CONTEXT — live world state for all agents ──
  const macro = await buildMacroContext()
  const macroText = formatMacroContext(macro)

  // ── NO-TRADE GATE — extreme conditions block all meetings ──
  if (macro.riskLevel === 'EXTREME' && macro.noTradeReason) {
    await say(db, crypto.randomUUID(), null, {
      agent: 'orchestrator', role: 'alert',
      message: `WAR ROOM PAUSED: ${macro.noTradeReason} | VIX:${macro.vix ?? '?'} F&G:${macro.fearGreed ?? '?'} Risk:${macro.riskLevel}`,
    })
    return
  }

  // ── PHASE 6: MARKET REGIME FILTER ──

  // Loss streak pause: if last 3 closed trades were all losses, wait 2 hours
  const { data: recentClosedTrades } = await db.from('demo_trades')
    .select('pnl, exit_time')
    .not('exit_time', 'is', null)
    .order('exit_time', { ascending: false })
    .limit(3)
  const lastThreeLosses = (recentClosedTrades ?? []).length >= 3
    && recentClosedTrades!.every(t => +(t.pnl ?? 0) <= 0)
  if (lastThreeLosses) {
    const lastClose = recentClosedTrades![0].exit_time
    const hoursSinceLastLoss = lastClose ? (Date.now() - new Date(lastClose).getTime()) / 3600_000 : 999
    if (hoursSinceLastLoss < 2) {
      await say(db, crypto.randomUUID(), null, {
        agent: 'orchestrator', role: 'alert',
        message: `WAR ROOM PAUSED: 3 consecutive losses. Mandatory 2h cooldown (${(2 - hoursSinceLastLoss).toFixed(1)}h remaining). Protecting capital.`,
      })
      return
    }
  }

  // High-impact event proximity: pause only if event is within next 4h (not 24h).
  // Audit 2026-04-21: old code paused war-room for 24+ hours straight because
  // US calendar always has 2+ "high-impact" events in a rolling 24h window
  // (Fed speeches, Jobless Claims, PMI). Tighten to actually-imminent events.
  const now = Date.now()
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000
  const imminentHighImpact = (macro.upcomingEvents ?? []).filter(e => {
    if (e.impact !== 'high') return false
    const eventDate = e.date ? new Date(e.date).getTime() : NaN
    if (!Number.isFinite(eventDate)) return false
    const minutesUntil = (eventDate - now) / 60_000
    return minutesUntil >= 0 && minutesUntil <= FOUR_HOURS_MS / 60_000
  })
  if (imminentHighImpact.length > 0) {
    const ev = imminentHighImpact[0]
    const minutesUntil = Math.round((new Date(ev.date).getTime() - now) / 60_000)
    await say(db, crypto.randomUUID(), null, {
      agent: 'orchestrator', role: 'alert',
      message: `WAR ROOM PAUSED: high-impact event "${ev.title}" in ${minutesUntil}min. Resumes after release.`,
    })
    return
  }

  const { data: recentDebates } = await db.from('war_room_messages')
    .select('instrument, created_at')
    .eq('role', 'decision')
    .eq('agent', 'orchestrator')
    .gte('created_at', new Date(Date.now() - COOLDOWN_MIN * 60_000).toISOString())
  const coolingDown = new Set((recentDebates ?? []).map(d => d.instrument))

  const scanResults: { symbol: string; status: string }[] = []
  let meetingsHeld = 0

  // Rotate scan order so tail instruments aren't always starved by meeting cap
  const rotateIdx = new Date().getUTCHours() % ALL_INSTRUMENTS.length
  const rotatedInstruments = [...ALL_INSTRUMENTS.slice(rotateIdx), ...ALL_INSTRUMENTS.slice(0, rotateIdx)]

  for (const instrument of rotatedInstruments) {
    const meetingId = crypto.randomUUID()
    try {
      const budgetNow = await getDailyBudgetStatus()
      const atMeetingCap = meetingsHeld >= MAX_MEETINGS_PER_CYCLE
      const budgetLow = budgetNow.remaining < 0.30

      const result = await runMeeting(db, meetingId, instrument, coolingDown.has(instrument), atMeetingCap || budgetLow, macroText, macro, recovery)
      scanResults.push({ symbol: instrument, status: result })

      if (result !== 'no trigger' && result !== 'cooldown' && result !== 'error' && result !== 'budget-capped') {
        meetingsHeld++
      }
    } catch (err) {
      await say(db, meetingId, instrument, { agent: 'orchestrator', role: 'alert', message: `Error: ${String(err).slice(0, 150)}` })
      scanResults.push({ symbol: instrument, status: 'error' })
    }
  }

  const triggersFound = scanResults.filter(s => s.status !== 'no trigger' && s.status !== 'error' && s.status !== 'cooldown' && s.status !== 'budget-capped').length
  const budgetEnd = await getDailyBudgetStatus()
  await waScan({
    totalScanned: ALL_INSTRUMENTS.length,
    triggersFound,
    instruments: scanResults,
    budgetSpent: budgetEnd.spent,
    budgetRemaining: budgetEnd.remaining,
  } as Parameters<typeof waScan>[0]).catch(e => console.error('[war-room] waScan WhatsApp error:', e))
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEETING — Full 12-agent debate for triggered instruments
// ═══════════════════════════════════════════════════════════════════════════════

async function runMeeting(
  db: ReturnType<typeof createServiceSupabase>,
  meetingId: string, instrument: Instrument,
  onCooldown = false, capReached = false,
  macroText = '', macro: MacroSnapshot | null = null,
  recovery: RecoveryMode = { active: false, drawdownPct: 0, maxRiskPct: 0.02, maxPositions: 3, minConfidence: 70, minRR: 2.0, message: 'Normal' },
): Promise<string> {
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

  // Data quality gate
  const dq = validateOHLCV(ohlcv, instrument)
  if (!dq.valid) {
    await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
      message: `${instrument}: DATA QUALITY FAIL — ${dq.issues.join('; ')}. Skipped.`,
    })
    return 'data-quality'
  }

  const ind = computeIndicators(ohlcv)
  const tech = technicalScore(ind)
  const regime = detectRegime(ohlcv)
  const price = ind.current_price

  // ── Quantitative forecast: ARIMA, Monte Carlo, Seasonality, Vol regime ──
  const forecast = generateForecast(instrument, ohlcv)
  const forecastText = formatForecast(forecast)

  // ── PHASE 5: Check trigger performance — auto-disable triggers with <30% win rate ──
  const { data: triggerStats } = await db.from('demo_trades')
    .select('signal_reason, pnl')
    .not('exit_time', 'is', null)
    .gte('created_at', new Date(Date.now() - 14 * 86400_000).toISOString())

  const triggerWinRates: Record<string, { wins: number; total: number }> = {}
  for (const t of triggerStats ?? []) {
    const reason = String(t.signal_reason ?? '')
    for (const name of ['BB Squeeze Breakout', 'EMA 12/26 Cross', 'MACD Crossover', 'RSI Extreme', 'Volume Spike', 'EMA 50 Breakout']) {
      if (reason.includes(name)) {
        if (!triggerWinRates[name]) triggerWinRates[name] = { wins: 0, total: 0 }
        triggerWinRates[name].total++
        if (+(t.pnl ?? 0) > 0) triggerWinRates[name].wins++
      }
    }
  }

  const disabledTriggers = new Set<string>()
  for (const [name, stats] of Object.entries(triggerWinRates)) {
    if (stats.total >= 8 && (stats.wins / stats.total) < 0.30) {
      disabledTriggers.add(name)
    }
  }

  // HARD DISABLE: BB_SQUEEZE is catastrophic (2W/31L = -$3,211). Never use it.
  disabledTriggers.add('BB Squeeze Breakout')

  const rawTriggers = [
    // BB_SQUEEZE REMOVED — 6% win rate, destroyed $3,211
    { name: 'EMA 12/26 Cross',    ...detectEMACross(ohlcv) },
    { name: 'MACD Crossover',     ...detectMACDCross(ohlcv) },
    { name: 'RSI Extreme',        ...detectRSIExtreme(ohlcv) },
    { name: 'EMA 50 Breakout',    ...detectEMA50Breakout(ohlcv) },
    // Volume Spike only if confirmed by another trigger (too noisy alone)
    { name: 'Volume Spike',       ...detectVolumeSpike(ohlcv) },
  ].filter(t => t.triggered && !disabledTriggers.has(t.name))

  // Sort by trigger strength: multi-signal confluence first, then by specificity
  rawTriggers.sort((a, b) => {
    const priority: Record<string, number> = {
      'BB Squeeze Breakout': 1, 'EMA 12/26 Cross': 2, 'MACD Crossover': 3,
      'RSI Extreme': 4, 'EMA 50 Breakout': 5, 'Volume Spike': 6,
    }
    return (priority[a.name] ?? 99) - (priority[b.name] ?? 99)
  })

  const trigger = rawTriggers[0]?.name ?? null
  const triggerDir = rawTriggers[0]?.direction ?? null
  const allTriggers = rawTriggers.map(t => t.name).join(' + ') || null

  if (regime.regime === 'ranging' && rawTriggers.length < 2) {
    await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
      message: `${instrument} @ $${f(price)} | ${allTriggers} detected but market is RANGING (strength:${regime.strength.toFixed(1)}). Need 2+ triggers for confluence in range-bound markets.`,
    })
    return 'regime-filtered'
  }

  if (!trigger) {
    await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
      message: `${instrument} @ $${f(price)} | RSI:${ind.rsi.toFixed(0)} MACD:${ind.macd.histogram > 0 ? '+' : '-'}${Math.abs(ind.macd.histogram).toFixed(2)} BB:${(ind.bb.percentB * 100).toFixed(0)}% Vol:${ind.volume_ratio.toFixed(1)}x EMA:${price > ind.ema_50 ? '↑' : '↓'} | No trigger. Adjourned.`,
      data: { price, rsi: ind.rsi, macd_hist: ind.macd.histogram, bb_pctb: ind.bb.percentB, volume_ratio: ind.volume_ratio, trigger: null },
    })
    return 'no trigger'
  }

  // ── LONG-ONLY MODE — shorts have 0% win rate (0W/37L = -$3,405). Block all shorts. ──
  if (triggerDir === 'short') {
    await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
      message: `${instrument} @ $${f(price)} | ${allTriggers} → SHORT blocked. LONG-ONLY mode active (0W/37L short history). Waiting for LONG setup.`,
    })
    return 'long-only-filter'
  }

  // ── PHASE 2: TREND FILTER GATE — only buy in uptrends ──
  const trendWeak = forecast.smoothedTrend === 'down' && forecast.upProbability4h < 0.45
  if (trendWeak) {
    await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
      message: `${instrument} @ $${f(price)} | ${allTriggers} → LONG but trend is DOWN (MC ${(forecast.upProbability4h * 100).toFixed(0)}% up). Skipping — don't buy in downtrend.`,
      data: { price, trigger: allTriggers, trendFilter: true, trendDir: forecast.smoothedTrend, mcUp: forecast.upProbability4h },
    })
    return 'trend-filtered'
  }

  if (onCooldown) {
    await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
      message: `${instrument} @ $${f(price)} | ${allTriggers} detected but on cooldown (debated <${COOLDOWN_MIN}min ago). Adjourned.`,
      data: { price, trigger: allTriggers, cooldown: true },
    })
    return 'cooldown'
  }

  if (capReached) {
    await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
      message: `${instrument} @ $${f(price)} | ${allTriggers} detected but meeting cap reached this cycle (${MAX_MEETINGS_PER_CYCLE}/cycle) or budget low. Queued for next run.`,
      data: { price, trigger: allTriggers, capReached: true },
    })
    return 'budget-capped'
  }

  // ═══ FORECAST CONTRADICT CHECK — warn if quant models disagree with LONG trigger ═══
  const forecastContradict = triggerDir === 'long' && forecast.combinedSignal < -20
  const forecastNote = forecastContradict
    ? ` ⚠️ FORECAST CONTRADICT: quant models say ${forecast.combinedLabel} (${forecast.combinedSignal}/100) vs trigger ${triggerDir?.toUpperCase()}.`
    : ` Forecast: ${forecast.combinedLabel} (${forecast.combinedSignal}/100).`

  // ═══ FULL DEBATE — all 12 agents participate ═══

  const triggerLabel = rawTriggers.length > 1 ? `${allTriggers} (${rawTriggers.length} signals)` : trigger
  await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'open',
    message: `MEETING: ${instrument} @ $${f(price)}. ${triggerLabel} detected → ${triggerDir?.toUpperCase()}. RSI:${ind.rsi.toFixed(0)} ATR:${ind.atr.toFixed(2)} Vol:${ind.volume_ratio.toFixed(1)}x.${forecastNote} MC P(up 4h): ${(forecast.upProbability4h * 100).toFixed(0)}%. Calling all agents.`,
    data: { price, rsi: ind.rsi, atr: ind.atr, trigger: allTriggers, triggerDir, triggerCount: rawTriggers.length, forecastSignal: forecast.combinedSignal, forecastContradict },
  })

  await waOpen({
    instrument, price, trigger: allTriggers ?? trigger, direction: triggerDir ?? 'long',
    rsi: ind.rsi, atr: ind.atr, volumeRatio: ind.volume_ratio, triggerCount: rawTriggers.length,
  }).catch(e => console.error('[war-room] waOpen WhatsApp error:', e))

  const { data: allPrices } = await db.from('market_data').select('symbol, price, change_pct_24h').limit(20)
  const priceCtx = (allPrices ?? []).map(p => `${p.symbol}: $${f(+p.price)} (${(+p.change_pct_24h) >= 0 ? '+' : ''}${(+p.change_pct_24h).toFixed(1)}%)`).join(', ')

  const { data: pastTrades } = await db.from('demo_trades').select('instrument, direction, pnl, exit_reason')
    .not('exit_time', 'is', null).order('exit_time', { ascending: false }).limit(10)
  const tradeHist = (pastTrades ?? []).map(t => {
    const p = +(t.pnl ?? 0)
    return `${t.instrument} ${t.direction} → ${t.exit_reason} (${p >= 0 ? '+' : ''}$${p.toFixed(0)})`
  }).join(', ') || 'No history.'

  const { count: openPos } = await db.from('positions').select('*', { count: 'exact', head: true }).eq('is_demo', false)
  const recentLosses = (pastTrades ?? []).filter(t => +(t.pnl ?? 0) < 0).length

  const { data: news } = await db.from('news').select('headline, sentiment').order('published_at', { ascending: false }).limit(5)
  const newsCtx = (news ?? []).map(n => `${n.headline} [${n.sentiment}]`).join('; ') || 'No recent news.'

  const promptCtx: PromptContext = {
    instrument, triggerDir, price,
    rsi: ind.rsi, atr: ind.atr, bbPercentB: ind.bb.percentB,
    ema20: ind.ema_20, ema50: ind.ema_50, ema200: ind.ema_200,
    macdHist: ind.macd.histogram, volumeRatio: ind.volume_ratio,
    priceCtx, newsCtx, tradeHist,
    openPositions: openPos ?? 0, recentLosses, trigger: allTriggers ?? trigger,
  }

  // ── Macro context header — every agent sees the live world state ──
  const macroHeader = macroText ? `\n\n${macroText}\n` : ''
  const riskNote = macro?.riskLevel === 'HIGH' ? '\n⚠️ ELEVATED MACRO RISK — apply extra scrutiny to this trade.\n' : ''

  // ── 1–7: DEBATE AGENTS — get compact context to save tokens ──

  await agentSpeak(db, meetingId, instrument, conv, 'macro-agent', promptCtx,
    `${convoFor(conv, 'macro-agent')}${macroHeader}\nCurrent date: ${new Date().toLocaleDateString('en')}. Asset: ${instrument}. Direction: ${triggerDir}. Analyze the LIVE world state above and its impact on this trade.`)

  await agentSpeak(db, meetingId, instrument, conv, 'correlation-agent', promptCtx,
    `${convoFor(conv, 'correlation-agent')}${riskNote}\nAll asset prices: ${priceCtx}\nVIX:${macro?.vix ?? '?'} DXY:${macro?.dxy ?? '?'} US10Y:${macro?.us10y ?? '?'}% Oil:$${macro?.oilWTI ?? '?'}\n\nDoes cross-asset and macro data support ${triggerDir} on ${instrument}?`)

  await agentSpeak(db, meetingId, instrument, conv, 'bull-agent', promptCtx,
    `${convoFor(conv, 'bull-agent')}${riskNote}\nMake the case FOR ${triggerDir?.toUpperCase()} ${instrument} at $${f(price)}. RSI:${ind.rsi.toFixed(0)} ATR:${ind.atr.toFixed(2)} BB%B:${(ind.bb.percentB * 100).toFixed(0)}% EMA20:${ind.ema_20.toFixed(2)} EMA50:${ind.ema_50.toFixed(2)} EMA200:${ind.ema_200.toFixed(2)} MACD:${ind.macd.histogram > 0 ? '+' : ''}${ind.macd.histogram.toFixed(2)} Vol:${ind.volume_ratio.toFixed(1)}x`)

  await agentSpeak(db, meetingId, instrument, conv, 'bear-agent', promptCtx,
    `${convoFor(conv, 'bear-agent')}\n\nStress-test this trade. RSI:${ind.rsi.toFixed(0)} ATR:${ind.atr.toFixed(2)} BB%B:${(ind.bb.percentB * 100).toFixed(0)}% EMA20:${ind.ema_20.toFixed(2)} EMA50:${ind.ema_50.toFixed(2)} EMA200:${ind.ema_200.toFixed(2)} Vol:${ind.volume_ratio.toFixed(1)}x. What could go wrong?`)

  await agentSpeak(db, meetingId, instrument, conv, 'scalper-agent', promptCtx,
    `${convoFor(conv, 'scalper-agent')}\n\nIs there a scalp opportunity on ${instrument} at $${f(price)} right now? RSI:${ind.rsi.toFixed(0)} ATR:${ind.atr.toFixed(2)} BB%B:${(ind.bb.percentB * 100).toFixed(0)}%`)

  await agentSpeak(db, meetingId, instrument, conv, 'trend-agent', promptCtx,
    `${convoFor(conv, 'trend-agent')}\n\nEMA20:${ind.ema_20.toFixed(2)} EMA50:${ind.ema_50.toFixed(2)} EMA200:${ind.ema_200.toFixed(2)} Price:$${f(price)} RSI:${ind.rsi.toFixed(0)} MACD hist:${ind.macd.histogram.toFixed(2)}. Trend picture for ${instrument}?`)

  const liveHeadlines = macro?.headlines?.length ? `\nLIVE HEADLINES: ${macro.headlines.join(' | ')}` : ''
  await agentSpeak(db, meetingId, instrument, conv, 'market-analyst', promptCtx,
    `${convoFor(conv, 'market-analyst')}\n\nRecent news: ${newsCtx}${liveHeadlines}\nEconomic calendar: ${macro?.upcomingEvents?.map(e => `${e.impact === 'high' ? 'HIGH' : e.impact} ${e.country} ${e.title}`).join(', ') || 'No events'}\n\nSentiment assessment for ${instrument}?`)

  // ── 8–10: DECISION AGENTS — get FULL context for quality ──

  await agentSpeak(db, meetingId, instrument, conv, 'signal-generator', promptCtx,
    `${convoFor(conv, 'signal-generator')}\n\n${forecastText}\nGenerate the signal for ${instrument} at $${f(price)}, ATR=${ind.atr.toFixed(2)}. Use the quantitative forecast above to validate your entry/SL/TP levels.`)

  await agentSpeak(db, meetingId, instrument, conv, 'risk-manager', promptCtx,
    `${convoFor(conv, 'risk-manager')}\n\nRisk decision for ${instrument}? Open positions: ${openPos ?? 0}/3. Recent losses: ${recentLosses}/10.\nMACRO RISK: ${macro?.riskLevel ?? '?'} | VIX:${macro?.vix ?? '?'} | Yield curve:${macro?.yieldCurve ?? '?'} | Events 24h: ${macro?.upcomingEvents?.filter(e => e.impact === 'high').length ?? 0}\nFORECAST: MC P(up 4h):${(forecast.upProbability4h * 100).toFixed(0)}% | Vol regime:${forecast.volRegime} (${forecast.volRatio}x) | Max DD:${(forecast.mcMaxDrawdown * 100).toFixed(1)}% | Signal:${forecast.combinedSignal}/100 ${forecast.combinedLabel}`)

  await agentSpeak(db, meetingId, instrument, conv, 'trade-reviewer', promptCtx,
    `${convoFor(conv, 'trade-reviewer')}\n\nRecent trade history: ${tradeHist}\n\nPerformance context for ${instrument}?`)

  // ── 11: MASTER AGENT — full context for final synthesis ──

  await agentSpeak(db, meetingId, instrument, conv, 'master-agent', promptCtx,
    `${convoFor(conv, 'master-agent')}\n\n${forecastText}\nSummarize the full debate AND the quantitative forecast. Do the models agree with the agents? Tally votes. Give your weighted recommendation.`)

  // ── WhatsApp: Send debate summary ──
  const debateAgents = conv
    .filter(m => m.role === 'speak' && m.agent !== 'orchestrator')
    .map(m => {
      const bullish = /bullish|long|buy|support|for|approve|momentum|breakout|upside/i.test(m.message)
      const bearish = /bearish|reject|against|caution|risk|short|sell|overbought|trap|downside/i.test(m.message)
      const stance = bullish && !bearish ? 'bullish' as const : bearish && !bullish ? 'bearish' as const : 'neutral' as const
      return { name: m.agent, stance, summary: m.message.slice(0, 80) }
    })
  await waDebate({ instrument, agents: debateAgents }).catch(e => console.error('[war-room] waDebate WhatsApp error:', e))

  // ── 12: ORCHESTRATOR FINAL DECISION — structured JSON, no regex ──
  const orchDbPrompt = await getActivePrompt(db, 'orchestrator')
  const orchDefaultPrompt = AGENT_PROMPTS['orchestrator'](promptCtx)

  interface OrchestratorDecision {
    decision: 'EXECUTE' | 'REJECT'
    conviction: number
    reasoning: string
    dissent?: string
    reversal_trigger?: string
  }

  let parsed: OrchestratorDecision | null = null
  let rawDecisionText = ''
  try {
    const result = await callAgent<OrchestratorDecision>({
      system: orchDbPrompt ?? orchDefaultPrompt,
      user: `${fullConvo(conv)}${macroHeader}\n${forecastText}\nFinal decision for ${instrument}. You have heard all 11 agents. Consider the LIVE WORLD STATE and QUANTITATIVE FORECAST above. If the forecast contradicts the agent consensus, explain why you trust one over the other. Respond with JSON only.`,
      maxTokens: AGENT_TOKEN_LIMITS['orchestrator'],
      timeoutMs: 45000,
      expectJson: true,
    })
    parsed = result
    rawDecisionText = JSON.stringify(result)
  } catch {
    rawDecisionText = '[JSON parse failed — defaulting to REJECT for safety]'
  }

  // SAFETY: JSON parse fail → REJECT. Conviction < 70 → REJECT.
  // Forecast contradiction (quant models strongly disagree + low conviction) → REJECT.
  // Vote gate: need at least 3 more bulls than bears among debate agents.
  const forecastVeto = forecastContradict && (parsed?.conviction ?? 0) < 80

  const voteFor = conv.filter(m => /\b(bullish|buy\b|support(?:s|ing)?|execute|approve)\b/i.test(m.message) && m.role === 'speak' && m.agent !== 'orchestrator').length
  const voteAgainst = conv.filter(m => /\b(bearish|reject(?:ed)?|against\b|sell\b|wait\b|pass\b|veto)\b/i.test(m.message) && m.role === 'speak' && m.agent !== 'orchestrator').length
  const voteMarginOk = voteFor > voteAgainst + 2

  const minConviction = recovery.active ? recovery.minConfidence : 70
  const isExecute = parsed?.decision === 'EXECUTE'
    && (parsed?.conviction ?? 0) >= minConviction
    && !forecastVeto
    && voteMarginOk
  const decisionResponse = parsed
    ? `${parsed.decision} (conviction: ${parsed.conviction}%) — ${parsed.reasoning}`
    : rawDecisionText

  await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'decision',
    message: decisionResponse,
    data: {
      execute: isExecute, trigger, direction: triggerDir,
      votesFor: voteFor, votesAgainst: voteAgainst, agentCount: 12,
      conviction: parsed?.conviction ?? 0,
      structured: !!parsed,
      dissent: parsed?.dissent,
    },
  })

  // Audit log: every decision gets a permanent record
  try {
    await db.from('agent_logs').insert({
      agent: 'orchestrator', level: isExecute ? 'ok' : 'info',
      message: `[DECISION] ${instrument} ${triggerDir} → ${isExecute ? 'EXECUTE' : 'REJECT'} (conviction: ${parsed?.conviction ?? '?'}%)`,
      metadata: {
        meeting_id: meetingId, instrument, direction: triggerDir, trigger: allTriggers,
        decision: parsed?.decision, conviction: parsed?.conviction,
        reasoning: parsed?.reasoning, dissent: parsed?.dissent,
        votes: { for: voteFor, against: voteAgainst },
        structured_json: !!parsed,
      },
    })
  } catch (e) { console.error('[war-room] audit log insert error:', e) }

  const agentStances = conv
    .filter(m => m.role === 'speak' && m.agent !== 'orchestrator')
    .map(m => {
      const b = /bullish|long|buy|support|for|approve|execute/i.test(m.message)
      const br = /bearish|short|sell|reject|against|caution|risk/i.test(m.message)
      return { agent: m.agent, stance: (b && !br ? 'bull' : br && !b ? 'bear' : 'neutral') as 'bull' | 'bear' | 'neutral' }
    })

  if (isExecute && triggerDir) {
    // ── PHASE 3: Fixed ATR SL/TP — wider SL to survive noise, R:R >= 2:1 ──
    // Data: 1.5 ATR SL → 31 stopouts in 15min. 2 ATR gives room to breathe.
    const entry = price
    const slMult = 2.0
    const tpMult = 4.5
    const tp2Mult = 6.0
    let sl: number, tp: number, tp2: number

    if (triggerDir === 'long') {
      sl = entry - ind.atr * slMult
      tp = entry + ind.atr * tpMult
      tp2 = entry + ind.atr * tp2Mult
    } else {
      sl = entry + ind.atr * slMult
      tp = entry - ind.atr * tpMult
      tp2 = entry - ind.atr * tp2Mult
    }

    const slDist = Math.abs(entry - sl)
    const tpDist = Math.abs(entry - tp)
    const rr = slDist > 0 ? Math.round((tpDist / slDist) * 100) / 100 : 0

    // Recovery mode: enforce stricter R:R
    if (recovery.active && rr < recovery.minRR) {
      await speak(db, meetingId, instrument, conv, { agent: 'risk-manager', role: 'decision', message: `RECOVERY MODE: R:R ${rr.toFixed(2)} < ${recovery.minRR} minimum in ${recovery.message}` })
      await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close', message: `BLOCKED by recovery mode R:R requirement.` })
      return 'blocked'
    }
    // Recovery mode: enforce position limit
    if (recovery.active && (openPos ?? 0) >= recovery.maxPositions) {
      await speak(db, meetingId, instrument, conv, { agent: 'risk-manager', role: 'decision', message: `RECOVERY MODE: ${openPos} positions >= ${recovery.maxPositions} max in recovery mode` })
      await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close', message: `BLOCKED by recovery mode position limit.` })
      return 'blocked'
    }

    const riskCheck = hardRiskCheck(rr, entry, sl, openPos ?? 0)
    if (!riskCheck.allowed) {
      await speak(db, meetingId, instrument, conv, { agent: 'risk-manager', role: 'decision', message: `HARD REJECT: ${riskCheck.reason}` })
      await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close', message: `BLOCKED by risk rules: ${riskCheck.reason}. Meeting closed.` })
      await waBlocked({ instrument, reason: riskCheck.reason, blocker: 'Risk Manager' }).catch(e => console.error('[war-room] waBlocked error:', e))
      await runPostMeetingBrief({ instrument, decision: 'blocked', votesFor: voteFor, votesAgainst: voteAgainst, trigger: allTriggers ?? trigger, agentStances }).catch(() => {})
      return 'blocked'
    }

    const { data: portfolio } = await db.from('portfolio').select('capital').eq('is_demo', false).single()
    const capitalUsd = portfolio?.capital ?? 5000
    const dailyCheck = await checkDailyLossLimit(capitalUsd)
    if (!dailyCheck.allowed) {
      await speak(db, meetingId, instrument, conv, { agent: 'risk-manager', role: 'decision', message: `DAILY LIMIT: ${dailyCheck.reason}` })
      await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close', message: `BLOCKED by daily loss limit. Meeting closed.` })
      await waBlocked({ instrument, reason: dailyCheck.reason, blocker: 'Daily Loss Limit' }).catch(e => console.error('[war-room] waBlocked error:', e))
      await runPostMeetingBrief({ instrument, decision: 'blocked', votesFor: voteFor, votesAgainst: voteAgainst, trigger: allTriggers ?? trigger, agentStances }).catch(() => {})
      return 'blocked'
    }

    const strategyMap: Record<string, 'BB_SQUEEZE' | 'EMA_CROSS' | 'MACD_CROSS' | 'RSI_EXTREME' | 'VOLUME_SPIKE' | 'EMA50_BREAKOUT'> = {
      'BB Squeeze Breakout': 'BB_SQUEEZE', 'EMA 12/26 Cross': 'EMA_CROSS',
      'MACD Crossover': 'MACD_CROSS', 'RSI Extreme': 'RSI_EXTREME',
      'Volume Spike': 'VOLUME_SPIKE', 'EMA 50 Breakout': 'EMA50_BREAKOUT',
    }
    const strategyType = strategyMap[trigger] ?? 'EMA_CROSS'
    const bt = quickBacktest(ohlcv, strategyType, slMult, tpMult)
    if (!bt.passed) {
      await speak(db, meetingId, instrument, conv, { agent: 'risk-manager', role: 'decision',
        message: `BACKTEST FAIL: ${strategyType} win rate ${(bt.winRate * 100).toFixed(0)}% (${bt.wins}W/${bt.losses}L) on recent data — below 35% threshold`,
      })
      await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close', message: `BLOCKED by backtest validation. Meeting closed.` })
      await waBlocked({ instrument, reason: `Backtest failed: ${bt.wins}W/${bt.losses}L (${(bt.winRate * 100).toFixed(0)}%)`, blocker: 'Backtest Validation' }).catch(e => console.error('[war-room] waBlocked error:', e))
      await runPostMeetingBrief({ instrument, decision: 'blocked', votesFor: voteFor, votesAgainst: voteAgainst, trigger: allTriggers ?? trigger, agentStances }).catch(() => {})
      return 'blocked'
    }

    // ── SIGNAL DEDUPLICATION ──
    const { count: recentSignalCount } = await db.from('signals')
      .select('*', { count: 'exact', head: true })
      .eq('instrument', instrument).eq('direction', triggerDir)
      .gte('created_at', new Date(Date.now() - 60 * 60_000).toISOString())
    if ((recentSignalCount ?? 0) > 0) {
      await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
        message: `DUPLICATE: ${triggerDir} ${instrument} signal already exists from last 60 min. Skipped.`,
      })
      await runPostMeetingBrief({ instrument, decision: 'blocked', votesFor: voteFor, votesAgainst: voteAgainst, trigger: allTriggers ?? trigger, agentStances }).catch(() => {})
      return 'blocked'
    }

    // ── PHASE 4: Aggressive position sizing (3-5% risk, streak-adjusted) ──
    const stats = await getTradeStats()
    const dynamicConf = stats.totalTrades >= 10
      ? Math.round(80 * (0.5 + stats.winRate * 0.5))
      : 80
    let sizing = riskBasedPositionSize(capitalUsd, entry, sl, stats, dynamicConf)

    // Recovery mode: cap risk
    if (recovery.active && sizing.riskPct > recovery.maxRiskPct) {
      const cappedRisk = capitalUsd * recovery.maxRiskPct
      const riskPerUnit = Math.abs(entry - sl)
      if (riskPerUnit > 0) {
        sizing.units = Math.min(sizing.units, cappedRisk / riskPerUnit)
        sizing.notionalUsd = sizing.units * entry
        sizing.riskPct = recovery.maxRiskPct
      }
    }

    const reasoning = `War Room 12-agent consensus (${voteFor}/${voteAgainst}) ${trigger} | BT:${bt.wins}W/${bt.losses}L Kelly:${(stats.kellyFraction * 100).toFixed(1)}% | FC:${forecast.combinedLabel}(${forecast.combinedSignal}) MC:${(forecast.upProbability4h * 100).toFixed(0)}%up`

    const { data: saved } = await db.from('signals').insert({
      instrument, direction: triggerDir,
      entry_price: entry, stop_loss: sl, take_profit_1: tp,
      take_profit_2: tp2,
      confidence: dynamicConf, risk_reward: rr,
      reasoning, ai_analysis: decisionResponse, news_sentiment: 'neutral',
      technical_score: tech.score, status: 'active',
    }).select().single()

    if (saved) {
      await sendSignalAlert(saved as Signal).catch(e => console.error('[war-room] Telegram error:', e))
      await waSignal(saved as Signal).catch(e => console.error('[war-room] waSignal WhatsApp error:', e))
    }

    // ── PHASE 1: Open demo position immediately (position lifecycle) ──
    const { data: session } = await db.from('demo_sessions')
      .select('id').eq('status', 'running')
      .order('created_at', { ascending: false }).limit(1).single()

    if (session && sizing.units > 0) {
      await db.from('demo_trades').insert({
        session_id: session.id,
        instrument, direction: triggerDir,
        entry_price: entry, stop_loss: sl, take_profit: tp,
        quantity: sizing.units,
        confidence: dynamicConf,
        signal_reason: reasoning,
        entry_time: new Date().toISOString(),
      })
    }

    await waDecision({
      instrument, decision: decisionResponse, execute: true,
      direction: triggerDir, entry, sl, tp, rr,
      votesFor: voteFor, votesAgainst: voteAgainst,
      trigger: allTriggers ?? undefined,
      backtestWins: bt.wins, backtestLosses: bt.losses,
      kelly: stats.kellyFraction,
    }).catch(e => console.error('[war-room] waDecision WhatsApp error:', e))

    await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
      message: `EXECUTED: ${triggerDir.toUpperCase()} ${instrument} @ $${f(entry)} | SL:$${f(sl)} TP:$${f(tp)} R:R ${rr}x | Size:${sizing.units.toFixed(4)} ($${sizing.notionalUsd.toFixed(0)}) Risk:${(sizing.riskPct * 100).toFixed(1)}% | Vote: ${voteFor}-${voteAgainst} | FC:${forecast.combinedLabel}. Meeting closed.`,
    })
    await runPostMeetingBrief({ instrument, decision: 'executed', direction: triggerDir, entry, sl, tp, rr, votesFor: voteFor, votesAgainst: voteAgainst, trigger: allTriggers ?? trigger, agentStances }).catch(() => {})
    return 'executed'
  } else {
    await waDecision({
      instrument, decision: decisionResponse, execute: false,
      votesFor: voteFor, votesAgainst: voteAgainst,
      trigger: allTriggers ?? undefined,
    }).catch(e => console.error('[war-room] waDecision WhatsApp error:', e))

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
    const maxTokens = AGENT_TOKEN_LIMITS[agentId] ?? 800
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

export { runWarRoom as runOrchestrator }
