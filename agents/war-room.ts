import { callAgent, getDailyBudgetStatus, MODEL_SONNET, MODEL_FAST } from '@/lib/anthropic'
import { computeIndicators, technicalScore, detectBBSqueeze, detectEMACross, detectRSIExtreme, detectMACDCross, detectVolumeSpike, detectEMA50Breakout, quickBacktest, detectRegime, multiTimeframeConfluence } from '@/lib/indicators'
import { createServiceSupabase } from '@/lib/supabase'
import { sendSignalAlert } from '@/lib/telegram'
import { notifySignal as waSignal, notifyWarRoomDecision as waDecision, notifyWarRoomOpen as waOpen, notifyWarRoomDebate as waDebate, notifyWarRoomBlocked as waBlocked } from '@/lib/whatsapp'
import { checkSafety, getRecoveryMode, checkLiveTradingAllowed } from '@/lib/safety'
import type { RecoveryMode } from '@/lib/safety'
import { hardRiskCheck, checkDailyLossLimit, getTradeStats, riskBasedPositionSize } from '@/lib/risk-controls'
import { AGENT_PROMPTS, AGENT_TOKEN_LIMITS, AGENT_TIER, STRUCTURED_OUTPUT_FOOTER, STRUCTURED_STANCE_AGENTS, type AgentId, type PromptContext } from '@/agents/agent-prompts'
import { runPostMeetingBrief } from '@/agents/meta-agent'
import { buildMacroContext, formatMacroContext, type MacroSnapshot } from '@/lib/macro-context'
import { generateForecast, formatForecast } from '@/lib/forecast'
import { validateOHLCV } from '@/lib/data-quality'
import { getPrimaryExchange } from '@/lib/exchanges'
import { checkSessionGate } from '@/lib/session-filter'
import { checkCorrelationDedup } from '@/lib/correlation-dedup'
import { getDerivativesSnapshot, evaluateDerivativesForLong, type DerivativesSnapshot } from '@/lib/derivatives'
import { checkOrderBookHealth } from '@/lib/orderbook'
import { getBtcCmeGap, type CmeGapInfo } from '@/lib/cme-gaps'
import { evaluateOnchainForLong } from '@/lib/onchain'
import { evaluateNewsImpactForLong } from '@/lib/news-impact'
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

type Stance = 'BULL' | 'BEAR' | 'NEUTRAL'
interface StanceData { stance?: Stance; conviction?: number; key_arg?: string; full_analysis?: string; structured?: boolean; reason?: string; [k: string]: unknown }
interface Msg { agent: string; role: string; message: string; data?: StanceData }

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
      data: { reason: 'budget-exhausted', spent: budget.spent, budget: budget.budget },
    })
    return
  }

  const safety = await checkSafety()
  if (!safety.safe) {
    await say(db, crypto.randomUUID(), null, {
      agent: 'orchestrator', role: 'alert',
      message: `WAR ROOM BLOCKED: ${safety.reason}`,
      data: { reason: 'safety-block', detail: safety.reason },
    })
    return
  }

  const recovery = getRecoveryMode(safety.drawdownPct)
  if (recovery.active) {
    await say(db, crypto.randomUUID(), null, {
      agent: 'orchestrator', role: 'alert',
      message: `⚠️ ${recovery.message} | Max risk: ${(recovery.maxRiskPct * 100).toFixed(1)}% | Max positions: ${recovery.maxPositions} | Min confidence: ${recovery.minConfidence}% | Min R:R: ${recovery.minRR}x`,
      data: { reason: 'recovery-mode-active', mode: recovery.message, maxRiskPct: recovery.maxRiskPct, maxPositions: recovery.maxPositions },
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
      data: { reason: 'macro-extreme', vix: macro.vix, fearGreed: macro.fearGreed, riskLevel: macro.riskLevel },
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
        data: { reason: 'loss-streak-cooldown', hoursSinceLastLoss, remainingHours: 2 - hoursSinceLastLoss },
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
      data: { reason: 'imminent-high-impact-event', event: ev.title, minutesUntil },
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

  // Phase C3 — detect bleeding tape (3+ losses in last 6h) once per cron tick.
  const recentLossWindow = new Date(Date.now() - 6 * 3600_000).toISOString()
  const { data: recentLosses6h } = await db.from('demo_trades')
    .select('pnl').not('exit_time', 'is', null).gte('exit_time', recentLossWindow)
  const lossStreakTrips = (recentLosses6h ?? []).filter(t => +(t.pnl ?? 0) < 0).length >= 3

  for (const instrument of rotatedInstruments) {
    const meetingId = crypto.randomUUID()
    try {
      const budgetNow = await getDailyBudgetStatus()
      const atMeetingCap = meetingsHeld >= MAX_MEETINGS_PER_CYCLE
      const budgetLow = budgetNow.remaining < 0.30
      const veryLow = budgetNow.remaining < 0.15

      // Hard cap: if at meeting cap OR catastrophic budget exhaustion, stop.
      // Soft cap: budget low or loss-streak → minimal-mode meeting (orchestrator
      // only, no 10-agent debate). Per Edmunds 2025, single agent under tight
      // budget often outperforms committee.
      const hardStop = atMeetingCap || veryLow
      const minimalMode = !hardStop && (budgetLow || lossStreakTrips)

      const result = await runMeeting(db, meetingId, instrument, coolingDown.has(instrument), hardStop, macroText, macro, recovery, minimalMode)
      scanResults.push({ symbol: instrument, status: result })

      if (result !== 'no trigger' && result !== 'cooldown' && result !== 'error' && result !== 'budget-capped') {
        meetingsHeld++
      }
    } catch (err) {
      await say(db, meetingId, instrument, {
        agent: 'orchestrator', role: 'alert',
        message: `Error: ${String(err).slice(0, 150)}`,
        data: { reason: 'meeting-exception', error: String(err).slice(0, 200) },
      })
      scanResults.push({ symbol: instrument, status: 'error' })
    }
  }

  // Note: per-tick "scan summary" WhatsApp blasts removed 2026-04-30 in favor
  // of the dedicated /api/cron/status-report cron (every 2h, much richer
  // payload). Per-meeting open / decision / blocked WhatsApp messages still fire
  // for real events. waScan is now a no-op stub kept for ABI compat.
  void scanResults
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
  minimalMode = false,
): Promise<string> {
  const conv: Msg[] = []

  const { data: candles } = await db.from('price_history').select('*')
    .eq('symbol', instrument).eq('interval', '1h')
    .order('timestamp', { ascending: false }).limit(200)

  if (!candles || candles.length < 30) {
    await speak(db, meetingId, instrument, conv, {
      agent: 'orchestrator', role: 'close',
      message: `${instrument}: insufficient data (${candles?.length ?? 0} candles). Skipped.`,
      data: { reason: 'insufficient-candles', candleCount: candles?.length ?? 0 },
    })
    return 'no trigger'
  }

  const ohlcv: OHLCV[] = candles.reverse().map(c => ({
    timestamp: new Date(c.timestamp).getTime(),
    open: +c.open, high: +c.high, low: +c.low, close: +c.close, volume: +c.volume,
  }))

  // Data quality gate
  const dq = validateOHLCV(ohlcv, instrument)
  if (!dq.valid) {
    await speak(db, meetingId, instrument, conv, {
      agent: 'orchestrator', role: 'close',
      message: `${instrument}: DATA QUALITY FAIL — ${dq.issues.join('; ')}. Skipped.`,
      data: { reason: 'data-quality', issues: dq.issues },
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

  // RANGING gate — REMOVED 2026-05-04 based on per-gate impact study
  // (`scripts/kfold-per-gate-impact.mjs`, 5-fold WF on 365d real data,
  // see `WAR_ROOM_UPGRADE_PROPOSAL.md` §10). Findings:
  //   - Stack with regime-ranging ON: Exp/R = -0.062
  //   - Stack with regime-ranging OFF: Exp/R = +0.002 (Δ +0.064 R/trade)
  //   - Solo: regime-ranging ON alone reduces Exp/R from +0.006 to -0.021
  //     (i.e. it actively destroys edge, not just filters trade count).
  // The gate was rejecting more winners than losers across 5 OOS folds.
  // Downstream gates (trend filter, quickBacktest, 12-agent vote, daily-loss
  // limit, drawdown tier, cooldown) remain in place. The intermediate
  // 2026-04-28 relaxation is superseded.
  if (false) {
    await speak(db, meetingId, instrument, conv, {
      agent: 'orchestrator', role: 'close',
      message: `${instrument} @ $${f(price)} | ${allTriggers} detected but market is RANGING (strength:${regime.strength.toFixed(1)}). Need 2+ triggers for confluence in range-bound markets.`,
      data: { reason: 'regime-ranging', regimeStrength: regime.strength, triggerCount: rawTriggers.length, trigger: allTriggers },
    })
    return 'regime-filtered'
  }

  if (!trigger) {
    await speak(db, meetingId, instrument, conv, {
      agent: 'orchestrator', role: 'close',
      message: `${instrument} @ $${f(price)} | RSI:${ind.rsi.toFixed(0)} MACD:${ind.macd.histogram > 0 ? '+' : '-'}${Math.abs(ind.macd.histogram).toFixed(2)} BB:${(ind.bb.percentB * 100).toFixed(0)}% Vol:${ind.volume_ratio.toFixed(1)}x EMA:${price > ind.ema_50 ? '↑' : '↓'} | No trigger. Adjourned.`,
      data: { reason: 'no-trigger', price, rsi: ind.rsi, macd_hist: ind.macd.histogram, bb_pctb: ind.bb.percentB, volume_ratio: ind.volume_ratio, trigger: null },
    })
    return 'no trigger'
  }

  // ── LONG-ONLY MODE — shorts have 0% win rate (0W/37L = -$3,405). Block all shorts. ──
  if (triggerDir === 'short') {
    await speak(db, meetingId, instrument, conv, {
      agent: 'orchestrator', role: 'close',
      message: `${instrument} @ $${f(price)} | ${allTriggers} → SHORT blocked. LONG-ONLY mode active (0W/37L short history). Waiting for LONG setup.`,
      data: { reason: 'long-only-mode', trigger: allTriggers },
    })
    return 'long-only-filter'
  }

  // ── ATR SANITY GATE — pre-debate volatility regime filter ──
  // Audit 2026-04-30: 3 of 13 stop-outs in the 10-day window closed within
  // 30 minutes — a noise-stop signature that maps to either ultra-compressed
  // ATR (chop / no edge) or blow-off ATR (false breakout).
  //   < 0.3% = compression, very few candles will reach +1R before reversing
  //   > 5%   = exhaustion, SL too wide for safe sizing
  // Rejecting both extremes early saves debate tokens and avoids the worst
  // bands of the volatility distribution.
  const atrPct = (ind.atr / price) * 100
  if (atrPct < 0.3 || atrPct > 5) {
    await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
      message: `${instrument} @ $${f(price)} | ${allTriggers} → ATR ${atrPct.toFixed(2)}% out of band [0.3%-5%]. ${atrPct < 0.3 ? 'Compression' : 'Exhaustion'} regime — skipping.`,
      data: { price, atr: ind.atr, atrPct, trigger: allTriggers, reason: 'atr-extreme' },
    })
    return 'atr-extreme'
  }

  // ── DERIVATIVES VETO — pre-debate funding / positioning gate ──
  // Free Binance USDT-M perp data: funding rate, OI delta, retail and
  // top-trader long/short ratios. Hard-veto cases (funding > 0.05%/8h,
  // retail L/S > 2.5) get caught here BEFORE we burn ~$0.05 in agent
  // tokens. Soft adjusts feed into conviction at decision time below.
  // Fails open: null snap = no veto, no boost.
  const derivSnap: DerivativesSnapshot | null = triggerDir === 'long'
    ? await getDerivativesSnapshot(instrument)
    : null
  const derivGate = evaluateDerivativesForLong(derivSnap)
  if (!derivGate.allowed) {
    await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
      message: `${instrument} @ $${f(price)} | ${allTriggers} → DERIVATIVES VETO: ${derivGate.reason}. Skipping debate.`,
      data: { price, trigger: allTriggers, reason: 'derivatives-veto', funding: derivSnap?.fundingRate8h, retailLS: derivSnap?.retailLongShortRatio },
    })
    return 'derivatives-veto'
  }

  // ── MULTI-TIMEFRAME CONFLUENCE — block lonely 1H signals ──
  // Aggregates the same 1H candle stream into 4H and 1D buckets and checks
  // trend alignment. A single 1H trigger with both 4H and 1D bearish (count=0)
  // is the lowest-edge setup in the dataset — block it pre-debate.
  // Two-trigger or higher-confluence setups bypass this gate even at MTF=0
  // because the 1H confluence is already strong evidence.
  const mtf = multiTimeframeConfluence(ohlcv)
  if (triggerDir === 'long' && rawTriggers.length === 1 && mtf.longConfluenceCount === 0) {
    await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
      message: `${instrument} @ $${f(price)} | ${allTriggers} → MTF VETO: 4H=${mtf.trend4h} 1D=${mtf.trend1d}, both against LONG with single 1H trigger. Skipping.`,
      data: { price, trigger: allTriggers, reason: 'mtf-veto', mtf },
    })
    return 'mtf-veto'
  }

  // ── HIGH MACRO RISK — require trigger confluence ──
  // EXTREME risk already pauses the whole war-room above. HIGH risk allows
  // trading but only on high-confluence setups (3+ triggers) so we don't
  // open marginal LONGs into a stressed tape (VIX > 25 or imminent events).
  if (macro?.riskLevel === 'HIGH' && rawTriggers.length < 3) {
    await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
      message: `${instrument} @ $${f(price)} | ${allTriggers} (${rawTriggers.length} triggers) → MACRO HIGH RISK requires 3+ triggers. Skipping.`,
      data: { price, trigger: allTriggers, reason: 'macro-high-strict', macroRisk: macro.riskLevel },
    })
    return 'macro-high-strict'
  }

  // ── CME GAP — BTC LONG only (cheap Yahoo lookup) ──
  // Unfilled CME futures gap above current price = LONG bias (price tends
  // to revisit the gap upward). Returns +/-5 conviction nudge, fails open.
  let cmeGap: CmeGapInfo | null = null
  if (instrument === 'BTC/USD' && triggerDir === 'long') {
    cmeGap = await getBtcCmeGap()
  }

  // ── ON-CHAIN FLOW — LONG-side soft gate (currently stub, fails open) ──
  // Heavy net-inflow to exchanges before a LONG = sell pressure. Hard veto
  // at $50M+ inflow once a real data source is wired in lib/onchain.ts.
  const onchainGate = triggerDir === 'long'
    ? await evaluateOnchainForLong(instrument)
    : { allowed: true, reason: 'short trigger — onchain gate skipped', convictionAdjust: 0 }
  if (!onchainGate.allowed) {
    await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
      message: `${instrument} @ $${f(price)} | ${allTriggers} → ON-CHAIN VETO: ${onchainGate.reason}. Skipping debate.`,
      data: { price, trigger: allTriggers, reason: 'onchain-veto' },
    })
    return 'onchain-veto'
  }

  // ── PHASE 2: TREND FILTER GATE — only buy in uptrends ──
  const trendWeak = forecast.smoothedTrend === 'down' && forecast.upProbability4h < 0.45
  if (trendWeak) {
    await speak(db, meetingId, instrument, conv, {
      agent: 'orchestrator', role: 'close',
      message: `${instrument} @ $${f(price)} | ${allTriggers} → LONG but trend is DOWN (MC ${(forecast.upProbability4h * 100).toFixed(0)}% up). Skipping — don't buy in downtrend.`,
      data: { reason: 'trend-filtered', price, trigger: allTriggers, trendDir: forecast.smoothedTrend, mcUp: forecast.upProbability4h },
    })
    return 'trend-filtered'
  }

  if (onCooldown) {
    await speak(db, meetingId, instrument, conv, {
      agent: 'orchestrator', role: 'close',
      message: `${instrument} @ $${f(price)} | ${allTriggers} detected but on cooldown (debated <${COOLDOWN_MIN}min ago). Adjourned.`,
      data: { reason: 'cooldown', price, trigger: allTriggers, cooldownMin: COOLDOWN_MIN },
    })
    return 'cooldown'
  }

  if (capReached) {
    await speak(db, meetingId, instrument, conv, {
      agent: 'orchestrator', role: 'close',
      message: `${instrument} @ $${f(price)} | ${allTriggers} detected but meeting cap reached this cycle (${MAX_MEETINGS_PER_CYCLE}/cycle) or budget low. Queued for next run.`,
      data: { reason: 'meeting-cap-or-budget-low', price, trigger: allTriggers, maxPerCycle: MAX_MEETINGS_PER_CYCLE },
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
    message: `MEETING: ${instrument} @ $${f(price)}. ${triggerLabel} detected → ${triggerDir?.toUpperCase()}. RSI:${ind.rsi.toFixed(0)} ATR:${ind.atr.toFixed(2)} Vol:${ind.volume_ratio.toFixed(1)}x.${forecastNote} MC P(up 4h): ${(forecast.upProbability4h * 100).toFixed(0)}%. ${minimalMode ? 'MINIMAL MODE — orchestrator-only.' : 'Calling all agents.'}`,
    data: { price, rsi: ind.rsi, atr: ind.atr, trigger: allTriggers, triggerDir, triggerCount: rawTriggers.length, forecastSignal: forecast.combinedSignal, forecastContradict, minimalMode },
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

  // ── PHASE C3 — minimal-mode short-circuit ──
  // Budget low or 3+ losses in last 6h → skip the 10-agent debate entirely
  // and let the orchestrator decide using only deterministic context. Saves
  // 80%+ of meeting cost on bad days; the deterministic gates are what blocks
  // most bad trades anyway.
  if (minimalMode) {
    await speak(db, meetingId, instrument, conv, {
      agent: 'orchestrator', role: 'alert',
      message: `MINIMAL MODE: skipping 10-agent debate (budget low or 3+ recent losses). Orchestrator will decide on deterministic context only.`,
      data: { reason: 'minimal-mode-active', mode: 'single-agent' },
    })
  }

  // ── 1–7: DEBATE AGENTS — get compact context to save tokens ──

  if (!minimalMode) await agentSpeak(db, meetingId, instrument, conv, 'macro-agent', promptCtx,
    `${convoFor(conv, 'macro-agent')}${macroHeader}\nCurrent date: ${new Date().toLocaleDateString('en')}. Asset: ${instrument}. Direction: ${triggerDir}. Analyze the LIVE world state above and its impact on this trade.`)

  if (!minimalMode) await agentSpeak(db, meetingId, instrument, conv, 'correlation-agent', promptCtx,
    `${convoFor(conv, 'correlation-agent')}${riskNote}\nAll asset prices: ${priceCtx}\nVIX:${macro?.vix ?? '?'} DXY:${macro?.dxy ?? '?'} US10Y:${macro?.us10y ?? '?'}% Oil:$${macro?.oilWTI ?? '?'}\n\nDoes cross-asset and macro data support ${triggerDir} on ${instrument}?`)

  if (!minimalMode) await agentSpeak(db, meetingId, instrument, conv, 'bull-agent', promptCtx,
    `${convoFor(conv, 'bull-agent')}${riskNote}\nMake the case FOR ${triggerDir?.toUpperCase()} ${instrument} at $${f(price)}. RSI:${ind.rsi.toFixed(0)} ATR:${ind.atr.toFixed(2)} BB%B:${(ind.bb.percentB * 100).toFixed(0)}% EMA20:${ind.ema_20.toFixed(2)} EMA50:${ind.ema_50.toFixed(2)} EMA200:${ind.ema_200.toFixed(2)} MACD:${ind.macd.histogram > 0 ? '+' : ''}${ind.macd.histogram.toFixed(2)} Vol:${ind.volume_ratio.toFixed(1)}x`)

  if (!minimalMode) await agentSpeak(db, meetingId, instrument, conv, 'bear-agent', promptCtx,
    `${convoFor(conv, 'bear-agent')}\n\nStress-test this trade. RSI:${ind.rsi.toFixed(0)} ATR:${ind.atr.toFixed(2)} BB%B:${(ind.bb.percentB * 100).toFixed(0)}% EMA20:${ind.ema_20.toFixed(2)} EMA50:${ind.ema_50.toFixed(2)} EMA200:${ind.ema_200.toFixed(2)} Vol:${ind.volume_ratio.toFixed(1)}x. What could go wrong?`)

  if (!minimalMode) await agentSpeak(db, meetingId, instrument, conv, 'scalper-agent', promptCtx,
    `${convoFor(conv, 'scalper-agent')}\n\nIs there a scalp opportunity on ${instrument} at $${f(price)} right now? RSI:${ind.rsi.toFixed(0)} ATR:${ind.atr.toFixed(2)} BB%B:${(ind.bb.percentB * 100).toFixed(0)}%`)

  if (!minimalMode) await agentSpeak(db, meetingId, instrument, conv, 'trend-agent', promptCtx,
    `${convoFor(conv, 'trend-agent')}\n\nEMA20:${ind.ema_20.toFixed(2)} EMA50:${ind.ema_50.toFixed(2)} EMA200:${ind.ema_200.toFixed(2)} Price:$${f(price)} RSI:${ind.rsi.toFixed(0)} MACD hist:${ind.macd.histogram.toFixed(2)}. Trend picture for ${instrument}?`)

  const liveHeadlines = macro?.headlines?.length ? `\nLIVE HEADLINES: ${macro.headlines.join(' | ')}` : ''
  if (!minimalMode) await agentSpeak(db, meetingId, instrument, conv, 'market-analyst', promptCtx,
    `${convoFor(conv, 'market-analyst')}\n\nRecent news: ${newsCtx}${liveHeadlines}\nEconomic calendar: ${macro?.upcomingEvents?.map(e => `${e.impact === 'high' ? 'HIGH' : e.impact} ${e.country} ${e.title}`).join(', ') || 'No events'}\n\nSentiment assessment for ${instrument}?`)

  // ── 8–10: DECISION AGENTS — get FULL context for quality ──
  // Risk-manager and signal-generator are the load-bearing pair; we keep
  // them in minimal mode so the orchestrator still sees an explicit risk
  // gate and signal-quality check. Trade-reviewer (Haiku) is cheap, also
  // kept. Pure-debate roles (bull/bear/scalper/trend/etc) are the ones
  // skipped above.

  await agentSpeak(db, meetingId, instrument, conv, 'signal-generator', promptCtx,
    `${convoFor(conv, 'signal-generator')}\n\n${forecastText}\nGenerate the signal for ${instrument} at $${f(price)}, ATR=${ind.atr.toFixed(2)}. Use the quantitative forecast above to validate your entry/SL/TP levels.`)

  await agentSpeak(db, meetingId, instrument, conv, 'risk-manager', promptCtx,
    `${convoFor(conv, 'risk-manager')}\n\nRisk decision for ${instrument}? Open positions: ${openPos ?? 0}/3. Recent losses: ${recentLosses}/10.\nMACRO RISK: ${macro?.riskLevel ?? '?'} | VIX:${macro?.vix ?? '?'} | Yield curve:${macro?.yieldCurve ?? '?'} | Events 24h: ${macro?.upcomingEvents?.filter(e => e.impact === 'high').length ?? 0}\nFORECAST: MC P(up 4h):${(forecast.upProbability4h * 100).toFixed(0)}% | Vol regime:${forecast.volRegime} (${forecast.volRatio}x) | Max DD:${(forecast.mcMaxDrawdown * 100).toFixed(1)}% | Signal:${forecast.combinedSignal}/100 ${forecast.combinedLabel}`)

  if (!minimalMode) await agentSpeak(db, meetingId, instrument, conv, 'trade-reviewer', promptCtx,
    `${convoFor(conv, 'trade-reviewer')}\n\nRecent trade history: ${tradeHist}\n\nPerformance context for ${instrument}?`)

  // ── 11: MASTER JUDGE AGENT — Phase B1 ──
  // The judge does NOT add new analysis. It ranks the 10 prior agents 1-10 on
  // argument quality, picks top-3, returns JSON. Orchestrator gets only the
  // top-3 rich arguments instead of synthesised summary (Maryanskyy 2026
  // findings: judge selection beats synthesis in ~80% of cases).
  interface JudgeRanking { agent: string; score: number; reason: string }
  interface MasterJudgeOutput {
    rankings: JudgeRanking[]
    top3_agent_ids: string[]
    consensus_stance: 'BULL' | 'BEAR' | 'NEUTRAL' | 'SPLIT'
    majority_stance_count: number
    groupthink_warning: boolean
  }
  let judge: MasterJudgeOutput | null = null
  if (!minimalMode) try {
    const masterDbPrompt = await getActivePrompt(db, 'master-agent')
    const masterDefault = AGENT_PROMPTS['master-agent'](promptCtx)
    judge = await callAgent<MasterJudgeOutput>({
      system: masterDbPrompt ?? masterDefault,
      user: `${fullConvo(conv)}\n\nRank these 10 agents on argument quality. Return JSON only.`,
      maxTokens: AGENT_TOKEN_LIMITS['master-agent'],
      timeoutMs: 30000,
      expectJson: true,
      model: MODEL_SONNET,
    })
    await speak(db, meetingId, instrument, conv, {
      agent: 'master-agent', role: 'speak',
      message: `JUDGE: top-3 = ${judge.top3_agent_ids.join(', ')} | consensus ${judge.consensus_stance} (${judge.majority_stance_count}) | groupthink ${judge.groupthink_warning}`,
      data: { structured: true, top3: judge.top3_agent_ids, consensus: judge.consensus_stance, groupthink: judge.groupthink_warning },
    })
  } catch (err) {
    await speak(db, meetingId, instrument, conv, { agent: 'master-agent', role: 'alert', message: `Judge JSON failed: ${String(err).slice(0, 100)}` })
  }

  // ── WhatsApp: Send debate summary ──
  const debateAgents = conv
    .filter(m => m.role === 'speak' && m.agent !== 'orchestrator' && m.agent !== 'master-agent')
    .map(m => {
      const stance: 'bullish' | 'bearish' | 'neutral' = m.data?.stance === 'BULL' ? 'bullish'
        : m.data?.stance === 'BEAR' ? 'bearish'
        : m.data?.stance === 'NEUTRAL' ? 'neutral'
        : (() => {
            const bull = /bullish|long|buy|support|for|approve|momentum|breakout|upside/i.test(m.message)
            const bear = /bearish|reject|against|caution|risk|short|sell|overbought|trap|downside/i.test(m.message)
            return bull && !bear ? 'bullish' : bear && !bull ? 'bearish' : 'neutral'
          })()
      return { name: m.agent, stance, summary: (m.data?.key_arg ?? m.message).slice(0, 80) }
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

  // Derivatives summary for orchestrator context
  const derivativesText = derivSnap
    ? `\n── DERIVATIVES POSITIONING ──\nFunding 8h: ${(derivSnap.fundingRate8h * 100).toFixed(3)}%  (7d avg: ${(derivSnap.fundingRateAvg7d * 100).toFixed(3)}%)\nOI delta 4h: ${derivSnap.openInterestDeltaPct4h?.toFixed(1) ?? '?'}%\nRetail L/S: ${derivSnap.retailLongShortRatio?.toFixed(2) ?? '?'}\nTop trader L/S: ${derivSnap.topTraderLongShortRatio?.toFixed(2) ?? '?'}\nDerivatives note: ${derivGate.reason}\n`
    : ''

  // Multi-timeframe trend summary
  const mtfText = `\n── MULTI-TIMEFRAME ──\n4H trend: ${mtf.trend4h} (RSI ${mtf.rsi4h.toFixed(0)})  |  1D trend: ${mtf.trend1d}  |  LONG confluence count: ${mtf.longConfluenceCount}/2\n`

  // CME gap context (BTC LONG only)
  const cmeGapText = cmeGap
    ? `\n── CME GAP ──\nBTC=F last close: $${cmeGap.cmeClose.toFixed(0)}  |  spot: $${cmeGap.spotPrice.toFixed(0)}  |  gap ${cmeGap.gapPct >= 0 ? '+' : ''}${cmeGap.gapPct.toFixed(2)}%  fillDir: ${cmeGap.fillDirection}\n`
    : ''

  // Phase B1 — judge-curated top-3 arguments (full_analysis) take precedence
  // over the full debate digest when feeding the orchestrator. This kills the
  // synthesis-failure pattern where the orchestrator drowns in 11 voices.
  const topAgentIds = (judge?.top3_agent_ids ?? []).filter(id =>
    conv.some(m => m.agent === id && m.role === 'speak'),
  )
  const top3Block = topAgentIds.length > 0
    ? `\n── TOP-3 ARGUMENTS (per Master Judge) ──\n${topAgentIds.map((id, i) => {
        const m = conv.find(mm => mm.agent === id && mm.role === 'speak')
        const analysis = (m?.data?.full_analysis ?? m?.message ?? '').slice(0, 600)
        const stance = m?.data?.stance ?? 'UNKNOWN'
        const conv_ = m?.data?.conviction ?? '?'
        return `${i + 1}. [${id}] stance=${stance} conviction=${conv_}\n   ${analysis}`
      }).join('\n\n')}\n`
    : ''
  const judgeBlock = judge
    ? `\n── JUDGE CONSENSUS ──\n${judge.consensus_stance} (${judge.majority_stance_count} agents in majority)${judge.groupthink_warning ? ' — ⚠️ GROUPTHINK WARNING' : ''}\n`
    : ''

  let parsed: OrchestratorDecision | null = null
  let rawDecisionText = ''
  try {
    const result = await callAgent<OrchestratorDecision>({
      system: orchDbPrompt ?? orchDefaultPrompt,
      user: `${top3Block}${judgeBlock}${macroHeader}\n${forecastText}${derivativesText}${mtfText}${cmeGapText}\nFinal decision for ${instrument}. The Master Judge ranked the 10 debate agents — you are seeing the top-3 rich arguments above (not all 10) so you can focus on quality. Consider the LIVE WORLD STATE, QUANTITATIVE FORECAST, DERIVATIVES POSITIONING, MULTI-TIMEFRAME alignment, and CME GAP (BTC only) above. If a judge groupthink_warning is present, weight the dissenting top-3 voice extra heavily. Respond with JSON only.`,
      maxTokens: AGENT_TOKEN_LIMITS['orchestrator'],
      timeoutMs: 45000,
      expectJson: true,
      model: MODEL_SONNET,
    })
    parsed = result
    rawDecisionText = JSON.stringify(result)
  } catch {
    rawDecisionText = '[JSON parse failed — defaulting to REJECT for safety]'
  }

  // SAFETY: JSON parse fail → REJECT. Conviction < 70 → REJECT.
  // Forecast contradiction (quant models strongly disagree + low conviction) → REJECT.
  // Vote gate: need at least 3 more bulls than bears among debate agents.
  // Derivatives soft-adjust feeds into the effective conviction.
  const forecastVeto = forecastContradict && (parsed?.conviction ?? 0) < 80

  // Phase A2 — structured tally replaces brittle regex.
  // Phase C3 — in minimal mode, only sig-gen + risk-manager (+ trade-reviewer)
  // spoke. We can't gate on a 12-agent vote margin we never collected, so
  // require a STRICTER conviction floor instead (bumped to 80 below).
  const tally = tallyVotes(conv)
  const voteFor = tally.bull
  const voteAgainst = tally.bear
  const voteMarginOk = minimalMode ? true : (voteFor > voteAgainst + 2)

  // Effective conviction = parsed conviction + soft adjustments from
  // derivatives, on-chain (when wired), CME gap (BTC only).
  // Hard vetoes already short-circuited pre-debate. Soft +/-N here can
  // lift a marginal LONG into execute or push a borderline one out.
  const effectiveConviction = (parsed?.conviction ?? 0)
    + derivGate.convictionAdjust
    + onchainGate.convictionAdjust
    + (cmeGap?.longBias ?? 0)

  // Phase C3: minimal mode requires HIGHER conviction (no debate sanity-check).
  const minConviction = minimalMode ? 80 : (recovery.active ? recovery.minConfidence : 70)
  const isExecute = parsed?.decision === 'EXECUTE'
    && effectiveConviction >= minConviction
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
    .filter(m => m.role === 'speak' && m.agent !== 'orchestrator' && m.agent !== 'master-agent')
    .map(m => {
      let stance: 'bull' | 'bear' | 'neutral'
      if (m.data?.structured && m.data?.stance) {
        stance = m.data.stance === 'BULL' ? 'bull' : m.data.stance === 'BEAR' ? 'bear' : 'neutral'
      } else {
        const b = /bullish|long|buy|support|for|approve|execute/i.test(m.message)
        const br = /bearish|short|sell|reject|against|caution|risk/i.test(m.message)
        stance = b && !br ? 'bull' : br && !b ? 'bear' : 'neutral'
      }
      return { agent: m.agent, stance }
    })

  if (isExecute && triggerDir) {
    // ── SESSION-OF-DAY GATE ──
    // Audit 2026-04-30: Asia-chop window (Dubai 02:00-09:00) had 0/8 win rate
    // over 10 days. Block normal-conviction LONGs in that window unless we
    // have very high conviction AND macro is calm, OR 3+ triggers in
    // confluence. See lib/session-filter.ts for the full rule.
    const sessionGate = checkSessionGate({
      conviction: parsed?.conviction ?? 0,
      macroRisk: macro?.riskLevel ?? null,
      triggerCount: rawTriggers.length,
    })
    if (!sessionGate.allowed) {
      await speak(db, meetingId, instrument, conv, { agent: 'risk-manager', role: 'decision',
        message: `SESSION GATE: ${sessionGate.reason}`,
        data: { reason: 'session-gate', detail: sessionGate.reason },
      })
      await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
        message: `BLOCKED by session gate: ${sessionGate.reason}. Meeting closed.`,
        data: { reason: 'blocked-session', detail: sessionGate.reason },
      })
      await waBlocked({ instrument, reason: sessionGate.reason, blocker: 'Session Gate' }).catch(() => {})
      await runPostMeetingBrief({ instrument, decision: 'blocked', votesFor: voteFor, votesAgainst: voteAgainst, trigger: allTriggers ?? trigger, agentStances }).catch(() => {})
      return 'blocked-session'
    }

    // ── CORRELATION DEDUP ──
    // Audit 2026-04-30: BTC and ETH co-traded as a pair 3 out of 3 times in
    // the 10-day window. Each pair both wins or both loses — same probability,
    // 2x size, 2x variance. Block second LONG on a hard-correlated peer
    // (BTC<->ETH only as hard pair; alt buckets are soft-warned).
    const peerCutoff = new Date(Date.now() - 4 * 3600_000).toISOString()
    const { data: recentPeerDecisions } = await db.from('war_room_messages')
      .select('instrument, data')
      .eq('role', 'decision')
      .eq('agent', 'orchestrator')
      .gte('created_at', peerCutoff)
    const recentSameDirInstruments = new Set<string>()
    for (const d of recentPeerDecisions ?? []) {
      if (!d.instrument || d.instrument === instrument) continue
      const dataDir = (d.data as { direction?: string } | null)?.direction
      const dataExec = (d.data as { execute?: boolean } | null)?.execute
      if (dataDir === triggerDir && dataExec === true) recentSameDirInstruments.add(d.instrument)
    }
    const { data: openPeerPositions } = await db.from('positions')
      .select('instrument, direction')
      .eq('direction', triggerDir)
      .eq('is_demo', false)
    const openSameDirInstruments = new Set((openPeerPositions ?? []).map(p => p.instrument as string))
    const dedup = checkCorrelationDedup(instrument, { recentSameDirInstruments, openSameDirInstruments })
    if (!dedup.allowed) {
      await speak(db, meetingId, instrument, conv, { agent: 'risk-manager', role: 'decision',
        message: `CORRELATION DEDUP: ${dedup.reason}`,
        data: { reason: 'correlation-dedup', detail: dedup.reason, conflictWith: dedup.conflictWith },
      })
      await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
        message: `BLOCKED by correlation dedup: ${dedup.reason}. Meeting closed.`,
        data: { reason: 'blocked-correlation', detail: dedup.reason, conflictWith: dedup.conflictWith },
      })
      await waBlocked({ instrument, reason: dedup.reason, blocker: 'Correlation Dedup' }).catch(() => {})
      await runPostMeetingBrief({ instrument, decision: 'blocked', votesFor: voteFor, votesAgainst: voteAgainst, trigger: allTriggers ?? trigger, agentStances }).catch(() => {})
      return 'blocked-correlation'
    }
    if (dedup.severity === 'soft' && dedup.conflictWith) {
      // Soft conflict: flag but allow. Logged for later analysis.
      await speak(db, meetingId, instrument, conv, { agent: 'risk-manager', role: 'alert',
        message: `Soft correlation flag: ${dedup.reason}`,
      })
    }

    // ── NEWS-IMPACT VETO — final pre-exec sanity ──
    // Pulls last 60 minutes of CryptoPanic / CoinDesk / CoinTelegraph RSS,
    // filters to instrument-relevant headlines, asks Claude for a
    // -100..+100 impact score on a LONG. Veto if score <= -40.
    // Costs ~$0.005 per call. Fails open on Anthropic / RSS errors.
    // Run AFTER orchestrator + correlation dedup so we only spend the
    // tokens on trades that have already passed every other gate.
    const newsGate = await evaluateNewsImpactForLong(instrument, 60)
    if (!newsGate.allowed) {
      await speak(db, meetingId, instrument, conv, { agent: 'market-analyst', role: 'decision',
        message: `NEWS VETO: score ${newsGate.score} — ${newsGate.reason}. Top: ${newsGate.topHeadlines.slice(0,2).join(' | ').slice(0, 200)}`,
        data: { reason: 'news-veto', score: newsGate.score, headlineCount: newsGate.headlineCount },
      })
      await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
        message: `BLOCKED by news veto: ${newsGate.reason}. Meeting closed.`,
        data: { reason: 'blocked-news', score: newsGate.score, detail: newsGate.reason },
      })
      await waBlocked({ instrument, reason: `News score ${newsGate.score}: ${newsGate.reason}`, blocker: 'News Impact' }).catch(() => {})
      await runPostMeetingBrief({ instrument, decision: 'blocked', votesFor: voteFor, votesAgainst: voteAgainst, trigger: allTriggers ?? trigger, agentStances }).catch(() => {})
      return 'blocked-news'
    }
    // News-neutral or favourable — log and proceed.
    if (newsGate.headlineCount > 0) {
      await speak(db, meetingId, instrument, conv, { agent: 'market-analyst', role: 'speak',
        message: `News check: score ${newsGate.score} on ${newsGate.headlineCount} headlines (${newsGate.reason})`,
      })
    }

    // ── PHASE 3: Fixed ATR SL/TP — calibrated 2026-04-30 for higher hit rate ──
    //
    // History:
    //   v1 (pre-2026-04-21): SL=1.5 ATR → 31 stopouts in 15min (too tight).
    //   v2 (2026-04-21):     SL=2.0 ATR, TP=4.5 ATR (+2.25R), TP2=6.0 ATR.
    //                        10-day audit: 4W/13L = 23.5% WR, -$308.65.
    //   v3 (this commit):    SL=2.0 ATR, TP1=3.0 ATR (+1.5R), TP2=5.0 ATR (+2.5R).
    //
    // Rationale: every +2.25R move passes through +1.5R first, so every
    // historical winner remains a winner. Losers that briefly tagged +1.5R
    // before reversing convert from full SL to full TP. Backtest gate is
    // automatically re-validated because quickBacktest() takes tpMult as
    // an argument and we feed it the new value below.
    //
    // R:R primary = 1.5 (= MIN_RR floor in lib/risk-controls.ts).
    // R:R runner  = 2.5 (held in take_profit_2 for future partial-fill logic).
    //
    // NOTE: partial-fill / break-even-stop management is OPEN WORK in the
    // positions cron. For now both demo and live exec target TP1 (full
    // close at +1.5R). TP2 is persisted on the signal row so a future
    // positions-cron upgrade can split 50/50 and trail BE on TP1 fill.
    const entry = price
    const slMult = 2.0
    const tpMult = 3.0    // TP1 — primary target, +1.5R
    const tp2Mult = 5.0   // TP2 — runner target, +2.5R (recorded only)
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
      await speak(db, meetingId, instrument, conv, { agent: 'risk-manager', role: 'decision', message: `RECOVERY MODE: R:R ${rr.toFixed(2)} < ${recovery.minRR} minimum in ${recovery.message}`, data: { reason: 'recovery-rr', rr, minRR: recovery.minRR } })
      await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close', message: `BLOCKED by recovery mode R:R requirement.`, data: { reason: 'blocked-recovery-rr', rr, minRR: recovery.minRR } })
      return 'blocked'
    }
    // Recovery mode: enforce position limit
    if (recovery.active && (openPos ?? 0) >= recovery.maxPositions) {
      await speak(db, meetingId, instrument, conv, { agent: 'risk-manager', role: 'decision', message: `RECOVERY MODE: ${openPos} positions >= ${recovery.maxPositions} max in recovery mode`, data: { reason: 'recovery-positions', openPos, maxPositions: recovery.maxPositions } })
      await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close', message: `BLOCKED by recovery mode position limit.`, data: { reason: 'blocked-recovery-positions', openPos, maxPositions: recovery.maxPositions } })
      return 'blocked'
    }

    const riskCheck = hardRiskCheck(rr, entry, sl, openPos ?? 0)
    if (!riskCheck.allowed) {
      await speak(db, meetingId, instrument, conv, { agent: 'risk-manager', role: 'decision', message: `HARD REJECT: ${riskCheck.reason}`, data: { reason: 'hard-risk-reject', detail: riskCheck.reason } })
      await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close', message: `BLOCKED by risk rules: ${riskCheck.reason}. Meeting closed.`, data: { reason: 'blocked-hard-risk', detail: riskCheck.reason } })
      await waBlocked({ instrument, reason: riskCheck.reason, blocker: 'Risk Manager' }).catch(e => console.error('[war-room] waBlocked error:', e))
      await runPostMeetingBrief({ instrument, decision: 'blocked', votesFor: voteFor, votesAgainst: voteAgainst, trigger: allTriggers ?? trigger, agentStances }).catch(() => {})
      return 'blocked'
    }

    const { data: portfolio } = await db.from('portfolio').select('capital').eq('is_demo', false).single()
    const capitalUsd = portfolio?.capital ?? 5000
    const dailyCheck = await checkDailyLossLimit(capitalUsd)
    if (!dailyCheck.allowed) {
      await speak(db, meetingId, instrument, conv, { agent: 'risk-manager', role: 'decision', message: `DAILY LIMIT: ${dailyCheck.reason}`, data: { reason: 'daily-loss-limit', detail: dailyCheck.reason } })
      await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close', message: `BLOCKED by daily loss limit. Meeting closed.`, data: { reason: 'blocked-daily-loss', detail: dailyCheck.reason } })
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
        data: { reason: 'backtest-fail', strategyType, wins: bt.wins, losses: bt.losses, winRate: bt.winRate },
      })
      await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close', message: `BLOCKED by backtest validation. Meeting closed.`, data: { reason: 'blocked-backtest', strategyType, winRate: bt.winRate } })
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
        data: { reason: 'duplicate-signal', direction: triggerDir, windowMinutes: 60 },
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

    // ── PHASE 1b: REAL trade execution (only if all gates pass) ──
    // Gates (ALL must be true):
    //   1. user_settings.trading_mode === 'live'
    //   2. user_settings.auto_trade_enabled === true
    //   3. primary exchange has credentials (env vars OR DB-stored)
    //   4. canWithdraw on the API key is FALSE (safety check at runtime)
    //   5. USDT spot balance >= notional (with small buffer)
    //   6. Notional >= exchange minimum order size
    // Any failure → log reason, skip real execution, keep demo only.
    if (triggerDir === 'long' && sizing.units > 0 && saved?.id) {
      const { data: settings } = await db.from('user_settings')
        .select('user_id, trading_mode, auto_trade_enabled')
        .limit(1)
        .maybeSingle()

      const gates = {
        trading_mode_live: settings?.trading_mode === 'live',
        auto_trade_on: settings?.auto_trade_enabled === true,
        has_user: !!settings?.user_id,
      }

      const logExec = async (level: 'info' | 'ok' | 'warn' | 'error', msg: string) => {
        try { await db.from('agent_logs').insert({ agent: 'live-exec', level, message: msg }) } catch { /* non-critical */ }
      }

      if (!gates.trading_mode_live || !gates.auto_trade_on || !gates.has_user) {
        await logExec('info',
          `${instrument}: real trade skipped — mode:${gates.trading_mode_live ? 'live' : 'demo'} auto:${gates.auto_trade_on} user:${gates.has_user}`)
      } else {
        // ── EDGE GATE — added 2026-04-30 after backtest verdict ──
        // Per-instrument blacklist + 30d rolling expectancy gate.
        // Demo always continues regardless of this gate; only LIVE exec is
        // affected. Fails CLOSED on insufficient data / DB error / negative
        // edge — protects real money when the system is bleeding.
        const edgeGate = await checkLiveTradingAllowed(instrument)
        if (!edgeGate.allowed) {
          await logExec('warn', `${instrument}: real trade BLOCKED by edge gate — ${edgeGate.reason}`)
          // Fall through; demo trade has already been recorded above.
        } else try {
          await logExec('info', `${instrument}: edge gate OK — ${edgeGate.reason}`)
          const ex = getPrimaryExchange()
          if (!ex.isConfigured()) {
            await logExec('error',
              `${instrument}: BLOCKED — no exchange credentials on server (set BINANCE_API_KEY and BINANCE_SECRET_KEY in Vercel env vars)`)
          } else {
            const conn = await ex.testConnection()
            if (!conn.success) {
              await logExec('error', `${instrument}: BLOCKED — exchange connect failed: ${conn.error ?? 'unknown'}`)
            } else if (!conn.canTrade) {
              await logExec('error', `${instrument}: BLOCKED — API key canTrade=false`)
            } else {
              // NOTE: canWithdraw gate disabled by user request (2026-04-23).
              // API key still has withdrawal permission — rotate the key if compromised.
              if (conn.canWithdraw) {
                await logExec('warn', `${instrument}: proceeding with canWithdraw=true — key should be rotated with Withdrawals disabled`)
              }
              const notionalUsd = sizing.notionalUsd
              const minOrder = ex.config.minOrderSize ?? 10
              if (notionalUsd < minOrder) {
                await logExec('warn', `${instrument}: order too small ($${notionalUsd.toFixed(2)} < min $${minOrder})`)
              } else if (conn.quoteBalance < notionalUsd) {
                await logExec('warn',
                  `${instrument}: insufficient USDT — balance $${conn.quoteBalance.toFixed(2)} < notional $${notionalUsd.toFixed(2)}`)
              } else {
                // ── ORDER BOOK HEALTH (pre-exec) ──
                // Fixes the "got filled, instant SL" pattern: if spread is
                // wide or top-3 ask depth < 20x notional, the market buy
                // would fill into a thin book and immediately revert.
                // Fail-open: if depth fetch errors, allowed:true.
                const bookHealth = await checkOrderBookHealth(instrument, notionalUsd, 'long')
                if (!bookHealth.allowed) {
                  await logExec('warn',
                    `${instrument}: BLOCKED pre-exec — order book unhealthy: ${bookHealth.reason}`)
                  // skip exec; demo trade was already opened so the signal
                  // path still produces an audit trail
                  return 'blocked-orderbook'
                }
                const result = await ex.marketBuy(instrument, notionalUsd)
                if (!result) {
                  await logExec('error', `${instrument}: marketBuy returned null`)
                } else {
                  await logExec('ok',
                    `${instrument}: REAL BUY filled qty=${result.executedQty.toFixed(6)} @ $${result.avgPrice.toFixed(2)} (orderId:${result.orderId})`)

                  // SL placement is CRITICAL — retry up to 3 times with backoff.
                  // A naked long position is unlimited downside risk.
                  let slOk = false
                  for (let attempt = 1; attempt <= 3 && !slOk; attempt++) {
                    slOk = await ex.setStopLoss(instrument, result.executedQty, sl).catch(() => false)
                    if (!slOk && attempt < 3) {
                      await logExec('warn', `${instrument}: SL attempt ${attempt}/3 failed, retrying...`)
                      await new Promise(r => setTimeout(r, 500 * attempt))
                    }
                  }

                  // If SL could not be placed, emergency-close the naked position.
                  let emergencyExit: { avgPrice: number; executedQty: number } | null = null
                  if (!slOk) {
                    await logExec('error',
                      `${instrument}: SL placement FAILED 3x — triggering emergency marketSell to avoid naked position`)
                    const closeRes = await ex.marketSell(instrument, result.executedQty).catch(() => null)
                    if (closeRes) {
                      emergencyExit = { avgPrice: closeRes.avgPrice, executedQty: closeRes.executedQty }
                      await logExec('error',
                        `${instrument}: emergency close filled qty=${closeRes.executedQty.toFixed(6)} @ $${closeRes.avgPrice.toFixed(2)} — trade aborted; no open position`)
                    } else {
                      await logExec('error',
                        `${instrument}: CRITICAL — SL placement failed AND emergency marketSell failed. Position is NAKED on ${ex.config.name}. Manual intervention required (Binance UI → Spot → sell ${instrument.split('/')[0]}).`)
                    }
                  } else {
                    // SL in place → try TP (not critical; positions cron trails if this fails)
                    const tpOk = await ex.setTakeProfit(instrument, result.executedQty, tp).catch(() => false)
                    if (!tpOk) {
                      await logExec('warn',
                        `${instrument}: TP placement failed — positions cron will manage exit via trailing SL`)
                    }
                  }

                  // DB bookkeeping — 3 paths:
                  //   A) SL OK                  → normal open trade + open position
                  //   B) SL failed, emergency OK → record closed trade, no open position
                  //   C) SL failed AND emergency failed → record open NAKED trade (flag for operator)
                  if (emergencyExit) {
                    // Path B: already flat on exchange
                    const pnl = (emergencyExit.avgPrice - result.avgPrice) * emergencyExit.executedQty
                    const pnlPct = (pnl / (result.avgPrice * emergencyExit.executedQty)) * 100
                    await db.from('trades').insert({
                      signal_id: saved.id,
                      user_id: settings!.user_id,
                      instrument,
                      direction: 'long',
                      quantity: result.executedQty,
                      entry_price: result.avgPrice,
                      exit_price: emergencyExit.avgPrice,
                      stop_loss: sl,
                      take_profit: tp,
                      pnl,
                      pnl_pct: pnlPct,
                      pnl_aed: pnl,
                      status: 'stopped',
                      is_demo: false,
                      closed_at: new Date().toISOString(),
                      notes: `EMERGENCY_SL_FAIL: SL placement rejected 3x — closed at market. Binance order ${result.orderId}.`,
                    })
                  } else if (!slOk) {
                    // Path C: naked position — flag heavily so operator notices
                    await db.from('trades').insert({
                      signal_id: saved.id,
                      user_id: settings!.user_id,
                      instrument,
                      direction: 'long',
                      quantity: result.executedQty,
                      entry_price: result.avgPrice,
                      stop_loss: sl,
                      take_profit: tp,
                      status: 'open',
                      is_demo: false,
                      notes: `⚠ NAKED POSITION: SL placement failed AND emergency sell failed. Binance order ${result.orderId}. MANUAL CLOSE REQUIRED.`,
                    })
                    await db.from('positions').upsert({
                      user_id: settings!.user_id,
                      instrument,
                      direction: 'long',
                      quantity: result.executedQty,
                      avg_entry_price: result.avgPrice,
                      current_price: result.avgPrice,
                      stop_loss: sl,
                      take_profit: tp,
                      is_demo: false,
                    }, { onConflict: 'user_id,instrument,is_demo' })
                  } else {
                    // Path A: happy path
                    await db.from('trades').insert({
                      signal_id: saved.id,
                      user_id: settings!.user_id,
                      instrument,
                      direction: 'long',
                      quantity: result.executedQty,
                      entry_price: result.avgPrice,
                      stop_loss: sl,
                      take_profit: tp,
                      status: 'open',
                      is_demo: false,
                      notes: `Binance order ${result.orderId} | risk $${notionalUsd.toFixed(0)} | ${reasoning.slice(0, 180)}`,
                    })

                    await db.from('positions').upsert({
                      user_id: settings!.user_id,
                      instrument,
                      direction: 'long',
                      quantity: result.executedQty,
                      avg_entry_price: result.avgPrice,
                      current_price: result.avgPrice,
                      stop_loss: sl,
                      take_profit: tp,
                      is_demo: false,
                    }, { onConflict: 'user_id,instrument,is_demo' })
                  }

                  // WhatsApp decision notification — message reflects actual outcome
                  const decisionMsg = emergencyExit
                    ? `⚠ EMERGENCY CLOSE: LONG ${instrument} BOUGHT @ $${result.avgPrice.toFixed(2)} then SOLD @ $${emergencyExit.avgPrice.toFixed(2)} (SL placement failed). Binance order ${result.orderId}.`
                    : !slOk
                      ? `🚨 NAKED POSITION ALERT: LONG ${instrument} @ $${result.avgPrice.toFixed(2)} — SL and emergency close BOTH failed. MANUAL ACTION REQUIRED on Binance.`
                      : `REAL TRADE EXECUTED: LONG ${instrument} @ $${result.avgPrice.toFixed(2)} | SL:$${sl.toFixed(2)} TP:$${tp.toFixed(2)} | qty ${result.executedQty.toFixed(6)} ($${notionalUsd.toFixed(0)}) | Binance order ${result.orderId}`
                  await waDecision({
                    instrument,
                    decision: decisionMsg,
                    execute: true,
                    direction: 'long', entry: result.avgPrice, sl, tp, rr,
                    votesFor: voteFor, votesAgainst: voteAgainst,
                    trigger: allTriggers ?? undefined,
                    backtestWins: bt.wins, backtestLosses: bt.losses,
                    kelly: stats.kellyFraction,
                  }).catch(() => {})
                }
              }
            }
          }
        } catch (e) {
          await logExec('error', `${instrument}: exception — ${String(e).slice(0, 200)}`)
        }
      }
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
      data: { reason: 'executed', direction: triggerDir, entry, sl, tp, rr, votesFor: voteFor, votesAgainst: voteAgainst, conviction: parsed?.conviction ?? 0 },
    })
    await runPostMeetingBrief({ instrument, decision: 'executed', direction: triggerDir, entry, sl, tp, rr, votesFor: voteFor, votesAgainst: voteAgainst, trigger: allTriggers ?? trigger, agentStances }).catch(() => {})
    await recordMeetingDecision(db, { instrument, direction: triggerDir, decision: 'executed', conviction: parsed?.conviction ?? 0, votesFor: voteFor, votesAgainst: voteAgainst, trigger: allTriggers ?? trigger, entry, sl, tp, rr })
    return 'executed'
  } else {
    await waDecision({
      instrument, decision: decisionResponse, execute: false,
      votesFor: voteFor, votesAgainst: voteAgainst,
      trigger: allTriggers ?? undefined,
    }).catch(e => console.error('[war-room] waDecision WhatsApp error:', e))

    await speak(db, meetingId, instrument, conv, { agent: 'orchestrator', role: 'close',
      message: `REJECTED: No trade on ${instrument}. Vote: ${voteFor} for, ${voteAgainst} against. Meeting closed.`,
      data: { reason: 'rejected-orchestrator', votesFor: voteFor, votesAgainst: voteAgainst, conviction: parsed?.conviction ?? 0, forecastVeto, voteMarginOk: voteFor > voteAgainst + 2 },
    })
    await runPostMeetingBrief({ instrument, decision: 'rejected', votesFor: voteFor, votesAgainst: voteAgainst, trigger: allTriggers ?? trigger, agentStances }).catch(() => {})
    await recordMeetingDecision(db, { instrument, direction: triggerDir ?? 'long', decision: 'rejected', conviction: parsed?.conviction ?? 0, votesFor: voteFor, votesAgainst: voteAgainst, trigger: allTriggers ?? trigger })
    return 'rejected'
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function getActivePrompt(db: ReturnType<typeof createServiceSupabase>, agentId: string): Promise<string | null> {
  try {
    const { data } = await db.from('agent_knowledge')
      .select('content').eq('agent_id', agentId).eq('type', 'rule').eq('active', true)
      .order('created_at', { ascending: false }).limit(1).single()
    return data?.content ?? null
  } catch { return null }
}

// ─── Phase A3 — persist every meeting decision to agent_knowledge ────────────
// Lets the meta-agent and future per-agent scoring read decision history without
// re-parsing war_room_messages.
interface DecisionRecord {
  instrument: string
  direction: string
  decision: 'executed' | 'rejected' | 'blocked'
  conviction: number
  votesFor: number
  votesAgainst: number
  trigger: string | null
  entry?: number
  sl?: number
  tp?: number
  rr?: number
  blockerReason?: string
}

async function recordMeetingDecision(db: ReturnType<typeof createServiceSupabase>, rec: DecisionRecord): Promise<void> {
  try {
    await db.from('agent_knowledge').insert({
      agent_id: 'orchestrator',
      type: 'observation',
      title: `${rec.instrument} ${rec.direction.toUpperCase()} ${rec.decision.toUpperCase()}`,
      content: rec.decision === 'executed'
        ? `Executed ${rec.direction} ${rec.instrument} @ ${rec.entry?.toFixed(2)} | SL:${rec.sl?.toFixed(2)} TP:${rec.tp?.toFixed(2)} R:R ${rec.rr?.toFixed(2)} | conviction ${rec.conviction}% | votes ${rec.votesFor}-${rec.votesAgainst} | trigger ${rec.trigger ?? 'n/a'}`
        : `${rec.decision} ${rec.direction} ${rec.instrument} | conviction ${rec.conviction}% | votes ${rec.votesFor}-${rec.votesAgainst} | trigger ${rec.trigger ?? 'n/a'}${rec.blockerReason ? ` | blocker ${rec.blockerReason}` : ''}`,
      context: rec as unknown as Record<string, unknown>,
      confidence: 50,
      active: true,
    })
  } catch (e) { console.error('[war-room] recordMeetingDecision error:', e) }
}

// ─── Phase B2 — heterogeneous trading beliefs (per meeting) ──────────────────
// Each meeting picks one bias per agent, deterministically from the meetingId,
// to break the "all 12 agents start from identical static prompt" failure mode
// (DReaMAD belief-entrenchment, arXiv 2503.16814). Keeps the underlying
// analysis prompt unchanged; just nudges the agent's framing.
const BELIEF_VARIANTS: Record<string, string[]> = {
  'macro-agent': [
    'You lean HAWKISH today: assume the Fed is willing to keep rates higher for longer.',
    'You lean DOVISH today: assume the Fed is closer to easing than the consensus expects.',
    'You are perfectly NEUTRAL today: only data, no policy bias.',
  ],
  'bull-agent': [
    'Your default bias is AGGRESSIVE: take asymmetric upside seriously, but still flag invalidation.',
    'Your default bias is CONSERVATIVE BULL: only call LONG if structure and trend agree.',
  ],
  'bear-agent': [
    'Your default bias is FORENSIC: hunt for distribution, exhaustion, supply traps.',
    'Your default bias is REGIME-AWARE: only flag bearish setup when macro is risk-off.',
  ],
  'trend-agent': [
    'You weight 1H momentum > HTF this meeting.',
    'You weight HTF (4H/1D) > 1H this meeting.',
  ],
}

function pickBelief(meetingId: string, agentId: string): string {
  const variants = BELIEF_VARIANTS[agentId]
  if (!variants?.length) return ''
  // Deterministic hash from meetingId so runs are reproducible.
  let h = 0
  for (const c of meetingId + agentId) h = (h * 31 + c.charCodeAt(0)) | 0
  const idx = Math.abs(h) % variants.length
  return `\n[BELIEF ROTATION]: ${variants[idx]}\n`
}

async function agentSpeak(
  db: ReturnType<typeof createServiceSupabase>,
  meetingId: string, instrument: Instrument, conv: Msg[],
  agentId: AgentId, promptCtx: PromptContext, userMsg: string,
) {
  try {
    const dbPrompt = await getActivePrompt(db, agentId)
    const defaultPrompt = AGENT_PROMPTS[agentId](promptCtx)
    const baseSystem = dbPrompt ?? defaultPrompt

    // Phase A2 — append structured-output footer for the 10 debate agents.
    // Master + orchestrator already have their own JSON schemas baked in.
    const wantsStructured = STRUCTURED_STANCE_AGENTS.has(agentId)
    const beliefRotation = pickBelief(meetingId, agentId)
    const system = beliefRotation + baseSystem + (wantsStructured ? STRUCTURED_OUTPUT_FOOTER : '')

    // Phase C1 — model tier per agent.
    const tier = AGENT_TIER[agentId] ?? 'DEEP'
    const model = tier === 'FAST' ? MODEL_FAST : MODEL_SONNET
    const maxTokens = AGENT_TOKEN_LIMITS[agentId] ?? 800

    const raw = await callAgent<string>({ system, user: userMsg, maxTokens, timeoutMs: 30000, model })

    // Try to parse structured stance JSON. On failure fall back to raw text +
    // regex-based stance extraction so a malformed response never crashes a
    // meeting.
    let stance: Stance | undefined
    let conviction: number | undefined
    let keyArg: string | undefined
    let fullAnalysis: string | undefined
    let structured = false
    if (wantsStructured) {
      const parsed = tryParseStanceJson(raw)
      if (parsed) {
        stance = parsed.stance
        conviction = parsed.conviction
        keyArg = parsed.key_arg
        fullAnalysis = parsed.full_analysis
        structured = true
      }
    }

    // Message stored: prefer key_arg when structured (so the WhatsApp digest
    // and downstream prompts get a punchy line), else raw output.
    const message = structured && keyArg ? keyArg : raw

    await speak(db, meetingId, instrument, conv, {
      agent: agentId, role: 'speak', message,
      data: { stance, conviction, key_arg: keyArg, full_analysis: fullAnalysis, structured },
    })
  } catch (err) {
    await speak(db, meetingId, instrument, conv, { agent: agentId, role: 'alert', message: `[timeout/error] ${String(err).slice(0, 80)}` })
  }
}

// Tolerant JSON parser for the structured-stance schema.
// Accepts:
//   - bare JSON object
//   - JSON wrapped in markdown ```json fences
//   - JSON with leading explanatory prose, as long as the braces balance
function tryParseStanceJson(raw: string): { stance: Stance; conviction: number; key_arg: string; full_analysis: string } | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  // Greedy first {...} block
  const m = cleaned.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const obj = JSON.parse(m[0]) as Record<string, unknown>
    const stance = String(obj.stance ?? '').toUpperCase()
    if (stance !== 'BULL' && stance !== 'BEAR' && stance !== 'NEUTRAL') return null
    const conviction = Math.max(0, Math.min(100, Number(obj.conviction ?? 0)))
    const key_arg = String(obj.key_arg ?? '').slice(0, 200)
    const full_analysis = String(obj.full_analysis ?? '').slice(0, 1000)
    return { stance: stance as Stance, conviction, key_arg, full_analysis }
  } catch { return null }
}

// Phase A2 — count votes from structured stances (with regex fallback for any
// agent that emitted free text).
function tallyVotes(conv: Msg[]): { bull: number; bear: number; neutral: number; bullConviction: number; bearConviction: number } {
  let bull = 0, bear = 0, neutral = 0
  let bullConviction = 0, bearConviction = 0
  for (const m of conv) {
    if (m.role !== 'speak' || m.agent === 'orchestrator' || m.agent === 'master-agent') continue
    if (m.data?.structured && m.data?.stance) {
      if (m.data.stance === 'BULL') { bull++; bullConviction += m.data.conviction ?? 0 }
      else if (m.data.stance === 'BEAR') { bear++; bearConviction += m.data.conviction ?? 0 }
      else neutral++
    } else {
      // Fallback: original regex tally
      const isBull = /\b(bullish|buy\b|support(?:s|ing)?|execute|approve)\b/i.test(m.message)
      const isBear = /\b(bearish|reject(?:ed)?|against\b|sell\b|wait\b|pass\b|veto)\b/i.test(m.message)
      if (isBull && !isBear) bull++
      else if (isBear && !isBull) bear++
      else neutral++
    }
  }
  return { bull, bear, neutral, bullConviction, bearConviction }
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
