import { callAgent } from '@/lib/anthropic'
import { computeIndicators, technicalScore, detectBBSqueeze, detectEMACross } from '@/lib/indicators'
import { createServiceSupabase } from '@/lib/supabase'
import { sendSignalAlert } from '@/lib/telegram'
import { checkSafety } from '@/lib/safety'
import type { Instrument, OHLCV, Signal } from '@/types'

const INSTRUMENTS: Instrument[] = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'BNB/USD', 'XAU/USD']

interface WarRoomMsg {
  agent: string
  role: 'speak' | 'question' | 'decision' | 'alert' | 'open' | 'close'
  message: string
  data?: Record<string, unknown>
}

// ═══════════════════════════════════════════════════════════════════════════════
// WAR ROOM — Multi-agent collaborative decision making
// ═══════════════════════════════════════════════════════════════════════════════

export async function runWarRoom(): Promise<void> {
  const db = createServiceSupabase()

  const safety = await checkSafety()
  if (!safety.safe) {
    await say(db, crypto.randomUUID(), null, { agent: 'orchestrator', role: 'alert', message: `WAR ROOM CANCELLED: ${safety.reason}` })
    return
  }

  for (const instrument of INSTRUMENTS) {
    const meetingId = crypto.randomUUID()

    try {
      await runMeeting(db, meetingId, instrument)
    } catch (err) {
      await say(db, meetingId, instrument, { agent: 'orchestrator', role: 'alert', message: `Meeting error: ${String(err).slice(0, 200)}` })
    }
  }
}

async function runMeeting(
  db: ReturnType<typeof createServiceSupabase>,
  meetingId: string,
  instrument: Instrument
) {
  const conversation: WarRoomMsg[] = []

  // ── ORCHESTRATOR OPENS ────────────────────────────────────────────────────
  await speak(db, meetingId, instrument, conversation, {
    agent: 'orchestrator', role: 'open',
    message: `War Room meeting started for ${instrument}. Gathering market data and running technical analysis...`,
  })

  // Get candles + indicators
  const { data: candles } = await db
    .from('price_history')
    .select('*')
    .eq('symbol', instrument)
    .eq('interval', '1h')
    .order('timestamp', { ascending: false })
    .limit(200)

  if (!candles || candles.length < 30) {
    await speak(db, meetingId, instrument, conversation, {
      agent: 'orchestrator', role: 'close',
      message: `Insufficient data for ${instrument} (${candles?.length ?? 0} candles). Need 30+. Skipping.`,
    })
    return
  }

  const ohlcv: OHLCV[] = candles.reverse().map(c => ({
    timestamp: new Date(c.timestamp).getTime(),
    open: Number(c.open), high: Number(c.high), low: Number(c.low),
    close: Number(c.close), volume: Number(c.volume),
  }))

  const ind = computeIndicators(ohlcv)
  const tech = technicalScore(ind)
  const bbSig = detectBBSqueeze(ohlcv)
  const emaCross = detectEMACross(ohlcv)
  const price = ind.current_price

  const triggerName = bbSig.triggered ? 'BB Squeeze Breakout' : emaCross.triggered ? 'EMA 12/26 Cross' : null
  const triggerDir = bbSig.triggered ? bbSig.direction : emaCross.triggered ? emaCross.direction : null

  await speak(db, meetingId, instrument, conversation, {
    agent: 'orchestrator', role: 'speak',
    message: `${instrument} @ $${price >= 1000 ? price.toLocaleString('en', { maximumFractionDigits: 0 }) : price.toFixed(2)}. RSI: ${ind.rsi.toFixed(0)}, MACD histogram: ${ind.macd.histogram > 0 ? 'positive' : 'negative'}, BB %B: ${(ind.bb.percentB * 100).toFixed(0)}%, Volume ratio: ${ind.volume_ratio.toFixed(1)}x. ${triggerName ? `ALERT: ${triggerName} detected → ${triggerDir?.toUpperCase()}` : 'No strategy trigger detected.'}`,
    data: { price, rsi: ind.rsi, macd: ind.macd, bb: ind.bb, atr: ind.atr, trigger: triggerName, triggerDir },
  })

  // If no trigger, quick close
  if (!triggerName) {
    await speak(db, meetingId, instrument, conversation, {
      agent: 'orchestrator', role: 'close',
      message: `No BB Squeeze or EMA Cross detected. ${instrument} meeting adjourned. Will check again in 30 minutes.`,
    })
    return
  }

  // ── MARKET ANALYST SPEAKS ─────────────────────────────────────────────────
  const { data: news } = await db.from('news').select('headline, sentiment').order('published_at', { ascending: false }).limit(5)
  const newsCtx = (news ?? []).map(n => `${n.headline} [${n.sentiment}]`).join('; ') || 'No recent news.'

  const analystConvo = conversation.map(m => `[${m.agent.toUpperCase()}]: ${m.message}`).join('\n')
  const analystResponse = await callAgent<string>({
    system: `You are a financial market analyst in a trading War Room. You analyze sentiment, news, and macro conditions. Speak concisely (2-3 sentences max). Reference what the Orchestrator said. Give your honest assessment — bullish, bearish, or uncertain. Include a clear recommendation.`,
    user: `Conversation so far:\n${analystConvo}\n\nRecent news: ${newsCtx}\n\nGive your market sentiment assessment for ${instrument}.`,
    maxTokens: 150,
    timeoutMs: 15000,
  })

  await speak(db, meetingId, instrument, conversation, {
    agent: 'market-analyst', role: 'speak',
    message: analystResponse,
  })

  // ── SIGNAL GENERATOR SPEAKS ───────────────────────────────────────────────
  const sigConvo = conversation.map(m => `[${m.agent.toUpperCase()}]: ${m.message}`).join('\n')
  const sigResponse = await callAgent<string>({
    system: `You are a quantitative signal generator in a trading War Room. Based on the conversation, generate a specific trade recommendation. Include: direction (LONG/SHORT/HOLD), entry price, stop loss, take profit, confidence %. Reference what the Market Analyst said. Be decisive. Speak concisely (2-3 sentences). Use the ATR of ${ind.atr.toFixed(2)} for stop/target distances.`,
    user: `Conversation so far:\n${sigConvo}\n\nCurrent price: $${price.toFixed(2)}, ATR: ${ind.atr.toFixed(2)}, Trigger: ${triggerName} → ${triggerDir}\n\nGenerate your signal.`,
    maxTokens: 150,
    timeoutMs: 15000,
  })

  await speak(db, meetingId, instrument, conversation, {
    agent: 'signal-generator', role: 'speak',
    message: sigResponse,
  })

  // ── RISK MANAGER SPEAKS (AI-powered now) ──────────────────────────────────
  const { count: openPos } = await db.from('positions').select('*', { count: 'exact', head: true })
  const { data: recentLosses } = await db.from('demo_trades').select('pnl_aed').not('exit_time', 'is', null).order('exit_time', { ascending: false }).limit(10)
  const recentLossCount = (recentLosses ?? []).filter(t => Number(t.pnl_aed) < 0).length

  const riskConvo = conversation.map(m => `[${m.agent.toUpperCase()}]: ${m.message}`).join('\n')
  const riskResponse = await callAgent<string>({
    system: `You are the Risk Manager in a trading War Room. Your job is to PROTECT CAPITAL. You can approve, reject, or modify the proposed trade. Consider: open positions (${openPos ?? 0}/3 max), recent losses (${recentLossCount}/10 were losses), max 2% risk per trade, min R:R 1.5:1. Be skeptical. Challenge weak signals. If you approve, state any conditions. Speak concisely (2-3 sentences).`,
    user: `Conversation so far:\n${riskConvo}\n\nGive your risk assessment and decision.`,
    maxTokens: 150,
    timeoutMs: 15000,
  })

  await speak(db, meetingId, instrument, conversation, {
    agent: 'risk-manager', role: 'speak',
    message: riskResponse,
  })

  // ── TRADE REVIEWER SPEAKS ─────────────────────────────────────────────────
  const { data: pastTrades } = await db.from('demo_trades').select('instrument, direction, pnl_aed, exit_reason').not('exit_time', 'is', null).order('exit_time', { ascending: false }).limit(10)
  const tradeHistory = (pastTrades ?? []).map(t => `${t.instrument} ${t.direction} → ${t.exit_reason} (${Number(t.pnl_aed) >= 0 ? '+' : ''}${Number(t.pnl_aed).toFixed(0)} AED)`).join(', ') || 'No trade history yet.'

  const reviewConvo = conversation.map(m => `[${m.agent.toUpperCase()}]: ${m.message}`).join('\n')
  const reviewResponse = await callAgent<string>({
    system: `You are the Trade Reviewer in a trading War Room. You analyze past performance to give context. Look at recent trade history and identify patterns — are we winning on longs? Losing on shorts? Any instrument doing well or badly? Give practical advice based on data. Speak concisely (2-3 sentences).`,
    user: `Conversation so far:\n${reviewConvo}\n\nRecent trades: ${tradeHistory}\n\nGive your review and any warnings.`,
    maxTokens: 150,
    timeoutMs: 15000,
  })

  await speak(db, meetingId, instrument, conversation, {
    agent: 'trade-reviewer', role: 'speak',
    message: reviewResponse,
  })

  // ── ORCHESTRATOR FINAL DECISION ───────────────────────────────────────────
  const decisionConvo = conversation.map(m => `[${m.agent.toUpperCase()}]: ${m.message}`).join('\n')
  const decisionResponse = await callAgent<string>({
    system: `You are the Orchestrator making the FINAL DECISION in the War Room. Based on ALL agents' input, decide: EXECUTE the trade, MODIFY it, or REJECT it. Be clear and decisive. State the exact action. If executing, confirm entry/SL/TP. Speak concisely (2-3 sentences).`,
    user: `Full conversation:\n${decisionConvo}\n\nMake your final decision for ${instrument}.`,
    maxTokens: 150,
    timeoutMs: 15000,
  })

  const isExecute = decisionResponse.toLowerCase().includes('execute') || decisionResponse.toLowerCase().includes('approve') || decisionResponse.toLowerCase().includes('proceed')

  await speak(db, meetingId, instrument, conversation, {
    agent: 'orchestrator', role: 'decision',
    message: decisionResponse,
    data: { execute: isExecute, trigger: triggerName, direction: triggerDir },
  })

  // If decision is to execute, create the signal
  if (isExecute && triggerDir) {
    const slDist = ind.atr * 2.5
    const tpDist = ind.atr * (triggerName === 'BB Squeeze Breakout' ? 4 : 5)
    const entry = price
    const sl = triggerDir === 'long' ? entry - slDist : entry + slDist
    const tp = triggerDir === 'long' ? entry + tpDist : entry - tpDist
    const rr = Math.round((tpDist / slDist) * 100) / 100

    const { data: saved } = await db.from('signals').insert({
      instrument, direction: triggerDir,
      entry_price: entry, stop_loss: sl, take_profit_1: tp, take_profit_2: triggerDir === 'long' ? entry + tpDist * 1.5 : entry - tpDist * 1.5,
      confidence: 80, risk_reward: rr,
      reasoning: `War Room: ${triggerName} + AI consensus`,
      ai_analysis: decisionResponse,
      news_sentiment: 'neutral', technical_score: tech.score, status: 'active',
    }).select().single()

    if (saved) {
      await sendSignalAlert(saved as Signal).catch(() => {})
      await speak(db, meetingId, instrument, conversation, {
        agent: 'orchestrator', role: 'close',
        message: `Signal executed: ${triggerDir.toUpperCase()} ${instrument} @ $${entry.toFixed(2)} | SL: $${sl.toFixed(2)} | TP: $${tp.toFixed(2)} | R:R ${rr}x. Meeting adjourned.`,
      })
    }
  } else {
    await speak(db, meetingId, instrument, conversation, {
      agent: 'orchestrator', role: 'close',
      message: `No trade executed for ${instrument}. Meeting adjourned.`,
    })
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function speak(
  db: ReturnType<typeof createServiceSupabase>,
  meetingId: string,
  instrument: string | null,
  conversation: WarRoomMsg[],
  msg: WarRoomMsg & { data?: Record<string, unknown> }
) {
  conversation.push(msg)
  await say(db, meetingId, instrument, msg)
}

async function say(
  db: ReturnType<typeof createServiceSupabase>,
  meetingId: string,
  instrument: string | null,
  msg: WarRoomMsg & { data?: Record<string, unknown> }
) {
  await db.from('war_room_messages').insert({
    meeting_id: meetingId,
    agent: msg.agent,
    role: msg.role,
    message: msg.message,
    data: msg.data ?? null,
    instrument,
  }).then(({ error }) => {
    // Table might not exist yet — fallback to agent_logs
    if (error) {
      return db.from('agent_logs').insert({
        agent: msg.agent,
        level: msg.role === 'decision' ? 'ok' : msg.role === 'alert' ? 'warn' : 'info',
        message: `[WAR ROOM] ${msg.message}`,
        metadata: { meeting_id: meetingId, role: msg.role, ...(msg.data ?? {}) },
      })
    }
  })

  console.log(`[WAR ROOM][${msg.agent}] ${msg.message}`)
}
