import { callAgent } from '@/lib/anthropic'
import { computeIndicators, technicalScore, detectBBSqueeze, detectEMACross, kellyFraction } from '@/lib/indicators'
import { createServiceSupabase } from '@/lib/supabase'
import { sendSignalAlert } from '@/lib/telegram'
import * as binance from '@/lib/binance-trader'
import * as poly from '@/lib/polymarket-trader'
import type {
  AgentContext, AgentSignalOutput, AgentName,
  Instrument, Direction, Signal, OHLCV, Sentiment
} from '@/types'

// ══════════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR — coordinates all agents
// ══════════════════════════════════════════════════════════════════════════════

const INSTRUMENTS: Instrument[] = ['BTC/USD', 'ETH/USD', 'BRENT', 'XAU/USD']

export async function runOrchestrator(): Promise<void> {
  const db = createServiceSupabase()
  await log(db, 'orchestrator', 'info', `Pipeline started — scanning ${INSTRUMENTS.join(', ')}`)

  const { data: portfolio } = await db
    .from('portfolio')
    .select('capital, available_capital')
    .eq('is_demo', false)
    .single()

  const { count: openCount } = await db
    .from('positions')
    .select('*', { count: 'exact', head: true })
    .eq('is_demo', false)

  // Process all instruments in PARALLEL (not sequential) for speed
  const results = await Promise.allSettled(
    INSTRUMENTS.map(instrument => withTimeout(
      processInstrument(db, instrument, portfolio, openCount ?? 0),
      55_000, // 55s max per instrument
      `${instrument} timed out`
    ))
  )

  const summary = results.map((r, i) => {
    const sym = INSTRUMENTS[i]
    if (r.status === 'fulfilled') return `${sym}: ${r.value}`
    return `${sym}: ERROR ${r.reason}`
  })

  await log(db, 'orchestrator', 'ok', `Pipeline complete — ${summary.join(' | ')}`)
}

async function processInstrument(
  db: ReturnType<typeof createServiceSupabase>,
  instrument: Instrument,
  portfolio: { capital: number; available_capital: number } | null,
  openCount: number
): Promise<string> {
  const { data: candles } = await db
    .from('price_history')
    .select('*')
    .eq('symbol', instrument)
    .eq('interval', '1h')
    .order('timestamp', { ascending: false })
    .limit(200)

  if (!candles || candles.length < 30) {
    await log(db, 'orchestrator', 'warn', `${instrument}: insufficient candle data (${candles?.length ?? 0})`)
    return `skip (${candles?.length ?? 0} candles)`
  }

  const ohlcv: OHLCV[] = candles.reverse().map(c => ({
    timestamp: new Date(c.timestamp).getTime(),
    open: Number(c.open), high: Number(c.high), low: Number(c.low),
    close: Number(c.close), volume: Number(c.volume),
  }))

  const ind = computeIndicators(ohlcv)
  const tech = technicalScore(ind)

  // ── STEP 1: Backtested strategy detection (BB Squeeze + EMA Cross) ────────
  const bbSignal = detectBBSqueeze(ohlcv)
  const emaCross = detectEMACross(ohlcv)

  const hasStrategySignal = bbSignal.triggered || emaCross.triggered
  const strategyDir = bbSignal.triggered ? bbSignal.direction : emaCross.triggered ? emaCross.direction : null
  const strategyName = bbSignal.triggered ? 'BB_SQUEEZE' : emaCross.triggered ? 'EMA_CROSS' : 'NONE'

  if (!hasStrategySignal) {
    await log(db, 'orchestrator', 'info',
      `${instrument}: No signal — BB squeeze: no, EMA cross: no | RSI:${ind.rsi.toFixed(0)} BB%B:${(ind.bb.percentB * 100).toFixed(0)}%`)
    return `no trigger (RSI:${ind.rsi.toFixed(0)})`
  }

  await log(db, 'orchestrator', 'info',
    `${instrument}: ${strategyName} detected → ${strategyDir?.toUpperCase()} | RSI:${ind.rsi.toFixed(0)} ATR:${ind.atr.toFixed(2)} Vol:${ind.volume_ratio.toFixed(1)}x`)

  // ── STEP 2: Claude AI confirmation (acts as smart filter) ─────────────────
  const [sentiment, signalOut] = await Promise.all([
    runMarketAnalyst(db, instrument),
    runSignalGenerator({
      instrument,
      current_price:      ind.current_price,
      ohlcv_1h:           ohlcv.slice(-48),
      ohlcv_4h:           ohlcv.slice(-48).filter((_, i) => i % 4 === 0),
      rsi:                ind.rsi,
      macd:               ind.macd,
      bb:                 ind.bb,
      ema_20:             ind.ema_20,
      ema_50:             ind.ema_50,
      ema_200:            ind.ema_200,
      atr:                ind.atr,
      volume_ratio:       ind.volume_ratio,
      news_sentiment:     'neutral',
      fear_greed_index:   50,
      portfolio_capital:  portfolio?.available_capital ?? 5000,
      open_positions_count: openCount,
      max_positions:      3,
    }),
  ])

  // AI must agree with strategy direction OR have high confidence
  const aiAgrees = signalOut.direction === strategyDir
  const aiConfident = signalOut.confidence >= 65

  if (!aiAgrees && !aiConfident) {
    await log(db, 'orchestrator', 'warn',
      `${instrument}: ${strategyName} says ${strategyDir} but AI says ${signalOut.direction} (conf ${signalOut.confidence}%) — SKIP (AI disagrees)`)
    return `AI disagrees (${signalOut.direction} vs ${strategyDir})`
  }

  // Use strategy direction, boosted by AI agreement
  const finalDir = strategyDir as Direction
  const finalConf = aiAgrees ? Math.min(signalOut.confidence + 15, 100) : signalOut.confidence

  // ── STEP 3: Calculate levels using ATR (backtested optimal: 2.5x SL, 2:1 R:R) ──
  const slMult = strategyName === 'BB_SQUEEZE' ? 2.5 : 2.5
  const tpMult = strategyName === 'BB_SQUEEZE' ? 4.0 : 5.0  // BB: 1.6:1 RR, EMA: 2:1 RR
  const slDist = ind.atr * slMult
  const tpDist = ind.atr * tpMult

  const entry = ind.current_price
  const sl = finalDir === 'long' ? entry - slDist : entry + slDist
  const tp1 = finalDir === 'long' ? entry + tpDist : entry - tpDist
  const tp2 = finalDir === 'long' ? entry + tpDist * 1.5 : entry - tpDist * 1.5
  const rr = Math.round((tpDist / slDist) * 100) / 100

  const enhancedSignal: AgentSignalOutput = {
    ...signalOut,
    instrument,
    direction: finalDir,
    entry_price: entry,
    stop_loss: sl,
    take_profit_1: tp1,
    take_profit_2: tp2,
    confidence: finalConf,
    risk_reward: rr,
    reasoning: `${strategyName} trigger${aiAgrees ? ' + AI confirms' : ''} | ${signalOut.reasoning}`,
    ai_analysis: signalOut.ai_analysis,
  }

  // ── STEP 4: Risk manager validation ───────────────────────────────────────
  const approved = await runRiskManager(enhancedSignal, {
    instrument,
    current_price: ind.current_price,
    ohlcv_1h: ohlcv.slice(-48),
    ohlcv_4h: ohlcv.slice(-48).filter((_, i) => i % 4 === 0),
    rsi: ind.rsi, macd: ind.macd, bb: ind.bb,
    ema_20: ind.ema_20, ema_50: ind.ema_50, ema_200: ind.ema_200,
    atr: ind.atr, volume_ratio: ind.volume_ratio,
    news_sentiment: sentiment, fear_greed_index: 50,
    portfolio_capital: portfolio?.available_capital ?? 5000,
    open_positions_count: openCount, max_positions: 3,
  })

  if (!approved) {
    await log(db, 'orchestrator', 'warn', `${instrument}: rejected by risk manager`)
    return 'rejected'
  }

  const { data: saved } = await db.from('signals').insert({
    instrument: enhancedSignal.instrument,
    direction:  enhancedSignal.direction,
    entry_price:   enhancedSignal.entry_price,
    stop_loss:     enhancedSignal.stop_loss,
    take_profit_1: enhancedSignal.take_profit_1,
    take_profit_2: enhancedSignal.take_profit_2,
    confidence:    enhancedSignal.confidence,
    risk_reward:   enhancedSignal.risk_reward,
    reasoning:     enhancedSignal.reasoning,
    ai_analysis:   enhancedSignal.ai_analysis,
    news_sentiment: sentiment,
    technical_score: tech.score,
    status: 'active',
  }).select().single()

  if (saved) {
    await sendSignalAlert(saved as Signal).catch(() => {})
    await log(db, 'orchestrator', 'ok',
      `${instrument}: ${strategyName} SIGNAL → ${enhancedSignal.direction.toUpperCase()} @ ${fmt$(entry)} | SL:${fmt$(sl)} TP:${fmt$(tp1)} | R:R ${rr}x conf:${finalConf}%${aiAgrees ? ' (AI+Strategy aligned)' : ''}`)

    if (binance.isConfigured() && enhancedSignal.entry_price && enhancedSignal.stop_loss) {
      try {
        const capitalUsd = (portfolio?.available_capital ?? 5000) / binance.USD_AED
        const tradeSize = capitalUsd * binance.MAX_RISK_PCT
        const userId = 'auto-trader'

            if (enhancedSignal.direction === 'long') {
          const result = await binance.executeBuy(instrument, tradeSize, userId, saved.id)
          if (result) {
            await log(db, 'orchestrator', 'ok',
              `AUTO-EXEC: BUY ${instrument} $${tradeSize.toFixed(0)} @ $${result.avgPrice.toFixed(2)}`)
                if (enhancedSignal.stop_loss && enhancedSignal.take_profit_1) {
                  await binance.setStopLossAndTakeProfit(
                    instrument, result.executedQty,
                    enhancedSignal.stop_loss, enhancedSignal.take_profit_1
              )
            }
          }
        }
      } catch (execErr) {
        await log(db, 'orchestrator', 'error', `AUTO-EXEC failed: ${String(execErr)}`)
      }
    }
  }

  return `${strategyName} ${enhancedSignal.direction.toUpperCase()} conf:${finalConf}%`
}

function withTimeout<T>(promise: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
  ])
}

// ══════════════════════════════════════════════════════════════════════════════
// MARKET ANALYST — news + sentiment
// ══════════════════════════════════════════════════════════════════════════════

async function runMarketAnalyst(
  db: ReturnType<typeof createServiceSupabase>,
  instrument: Instrument
): Promise<Sentiment> {
  try {
    // Fetch latest news from DB
    const { data: news } = await db
      .from('news')
      .select('headline, sentiment, ai_summary')
      .order('published_at', { ascending: false })
      .limit(5)

    const newsContext = (news ?? []).map(n => `${n.headline} [${n.sentiment}]`).join('\n')

    const result = await callAgent<{ sentiment: Sentiment; reasoning: string }>({
      system: `You are a financial market sentiment analyst.
Analyze news headlines and return ONLY valid JSON: {"sentiment": "bullish"|"bearish"|"neutral", "reasoning": "one sentence"}`,
      user: `Instrument: ${instrument}\n\nRecent news:\n${newsContext || 'No recent news available.'}`,
      maxTokens: 200,
      expectJson: true,
    })

    await log(db, 'market-analyst', 'ok', `${instrument}: ${result.sentiment} — ${result.reasoning}`)
    return result.sentiment
  } catch {
    return 'neutral'
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SIGNAL GENERATOR — technical analysis → trade signal
// ══════════════════════════════════════════════════════════════════════════════

const SIGNAL_SYSTEM = `You are a professional quantitative trading signal generator.
Analyze market data and return ONLY a JSON object with this exact structure:
{
  "direction": "long" | "short" | "hold",
  "entry_price": number | null,
  "stop_loss": number | null,
  "take_profit_1": number | null,
  "take_profit_2": number | null,
  "confidence": integer 0-100,
  "reasoning": "max 15 words explaining why",
  "ai_analysis": "max 30 words with key driver"
}

STRICT RULES:
- stop_loss must be within 3-5% of entry for crypto, 2-4% for commodities
- take_profit_1 at minimum 1.5x stop distance (R:R >= 1.5)
- take_profit_2 at minimum 2.5x stop distance
- Return HOLD if confidence < 65
- Never recommend more than 5% capital per trade
- Only return numbers, no % symbols or $ signs in JSON`

export async function runSignalGenerator(ctx: AgentContext): Promise<AgentSignalOutput> {
  const ind = {
    price:        ctx.current_price,
    rsi:          ctx.rsi,
    macd:         `value:${ctx.macd.value} signal:${ctx.macd.signal} hist:${ctx.macd.histogram}`,
    bb:           `upper:${ctx.bb.upper} mid:${ctx.bb.middle} lower:${ctx.bb.lower} width:${ctx.bb.width} %B:${ctx.bb.percentB}`,
    ema_20:       ctx.ema_20,
    ema_50:       ctx.ema_50,
    ema_200:      ctx.ema_200,
    atr:          ctx.atr,
    vol_ratio:    ctx.volume_ratio,
    sentiment:    ctx.news_sentiment,
    fear_greed:   ctx.fear_greed_index,
    open_pos:     `${ctx.open_positions_count}/${ctx.max_positions}`,
  }

  const result = await callAgent<AgentSignalOutput>({
    system:     SIGNAL_SYSTEM,
    user:       `Instrument: ${ctx.instrument}\nIndicators: ${JSON.stringify(ind, null, 2)}`,
    maxTokens:  512,
    expectJson: true,
  })

  // Compute R:R
  let rr: number | null = null
  if (result.entry_price && result.stop_loss && result.take_profit_1) {
    const risk   = Math.abs(result.entry_price - result.stop_loss)
    const reward = Math.abs(result.take_profit_1 - result.entry_price)
    if (risk > 0) rr = Math.round((reward / risk) * 100) / 100
  }

  return { ...result, instrument: ctx.instrument, risk_reward: rr }
}

// ══════════════════════════════════════════════════════════════════════════════
// RISK MANAGER — validates signal before approval
// ══════════════════════════════════════════════════════════════════════════════

export async function runRiskManager(
  signal: AgentSignalOutput,
  ctx: AgentContext
): Promise<boolean> {
  const db = createServiceSupabase()

  // Hard rules (no AI needed)
  if ((signal.risk_reward ?? 0) < 1.5) {
    await log(db, 'risk-manager', 'warn', `${signal.instrument}: R:R ${signal.risk_reward} < 1.5 — rejected`)
    return false
  }
  if (ctx.open_positions_count >= ctx.max_positions) {
    await log(db, 'risk-manager', 'warn', `${signal.instrument}: max positions (${ctx.max_positions}) reached — rejected`)
    return false
  }
  if (!signal.stop_loss || !signal.entry_price) {
    await log(db, 'risk-manager', 'warn', `${signal.instrument}: missing SL/entry — rejected`)
    return false
  }

  const slPct = Math.abs(signal.entry_price - signal.stop_loss) / signal.entry_price * 100
  if (slPct > 6) {
    await log(db, 'risk-manager', 'warn', `${signal.instrument}: SL too wide (${slPct.toFixed(1)}%) — rejected`)
    return false
  }

  await log(db, 'risk-manager', 'ok',
    `${signal.instrument}: approved — ${signal.direction.toUpperCase()} conf:${signal.confidence}% R:R:${signal.risk_reward}`)
  return true
}

// ══════════════════════════════════════════════════════════════════════════════
// TRADE REVIEWER — daily analysis of closed trades
// ══════════════════════════════════════════════════════════════════════════════

export async function runTradeReviewer(): Promise<string> {
  const db = createServiceSupabase()

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yStr = yesterday.toISOString().split('T')[0]

  const { data: trades } = await db
    .from('trades')
    .select('*')
    .gte('closed_at', `${yStr}T00:00:00`)
    .lt('closed_at',  `${yStr}T23:59:59`)
    .eq('status', 'closed')

  if (!trades?.length) {
    await log(db, 'trade-reviewer', 'info', 'No closed trades to review yesterday')
    return 'No trades to review'
  }

  const wins   = trades.filter(t => (t.pnl ?? 0) > 0).length
  const losses = trades.filter(t => (t.pnl ?? 0) < 0).length
  const netPnl = trades.reduce((s, t) => s + (t.pnl_aed ?? 0), 0)
  const summary = trades.map(t =>
    `${t.instrument} ${t.direction} entry:${t.entry_price} exit:${t.exit_price} pnl:${t.pnl_pct?.toFixed(2)}%`
  ).join('\n')

  const review = await callAgent({
    system: `You are a trading coach reviewing yesterday's trades. Be concise, analytical, actionable. Max 100 words.`,
    user:   `Date: ${yStr}\nWins:${wins} Losses:${losses} Net P&L: ${netPnl.toFixed(0)} AED\n\nTrades:\n${summary}`,
    maxTokens: 300,
  })

  await log(db, 'trade-reviewer', 'ok', `Daily review: ${wins}W/${losses}L — ${review.slice(0, 80)}...`)
  return review
}

// ══════════════════════════════════════════════════════════════════════════════
// POLYMARKET SCANNER — AI-powered prediction market betting
// ══════════════════════════════════════════════════════════════════════════════

const POLY_SYSTEM = `You are a prediction market analyst. You will be given a question from a prediction market and its current YES price (probability).

Analyze the question and return ONLY valid JSON:
{
  "ai_probability": number between 0.0 and 1.0 (your estimated TRUE probability),
  "confidence": integer 0-100 (how confident you are in your estimate),
  "reasoning": "max 20 words explaining your probability estimate"
}

RULES:
- Be calibrated: if you say 0.7, that event should happen ~70% of the time
- Consider current date (April 2026), recent events, and base rates
- For crypto price predictions, consider current prices and market conditions
- If you genuinely don't know, return probability close to the market price
- Only deviate significantly from market if you have strong reasoning`

export async function runPolymarketScanner(): Promise<{ scanned: number; bets: number }> {
  const db = createServiceSupabase()
  await log(db, 'polymarket-scanner', 'info', 'Scanning prediction markets...')

  const events = await poly.fetchTopEvents(10)
  const allMarkets = events.flatMap(e => e.markets).filter(m => m.active)

  if (!allMarkets.length) {
    await log(db, 'polymarket-scanner', 'warn', 'No active markets found')
    return { scanned: 0, bets: 0 }
  }

  const withPrices = await poly.fetchMarketPrices(allMarkets)
  const tradeable  = withPrices.filter(m => m.yes_price > 0.05 && m.yes_price < 0.95 && m.volume > 10000)

  await log(db, 'polymarket-scanner', 'info', `Found ${tradeable.length} tradeable markets (of ${allMarkets.length} total)`)

  const activeBets = await poly.getActiveBets()
  if (activeBets.length >= poly.MAX_ACTIVE_BETS) {
    await log(db, 'polymarket-scanner', 'info', `Max active bets (${poly.MAX_ACTIVE_BETS}) reached — skipping`)
    return { scanned: tradeable.length, bets: 0 }
  }

  const existingMarketIds = new Set(activeBets.map(b => b.market_id))
  let betsPlaced = 0

  for (const market of tradeable.slice(0, 8)) {
    if (existingMarketIds.has(market.id)) continue
    if (betsPlaced >= 3) break

    try {
      const analysis = await callAgent<{ ai_probability: number; confidence: number; reasoning: string }>({
        system: POLY_SYSTEM,
        user: `Question: "${market.question}"\nCurrent YES price: ${market.yes_price} (${(market.yes_price * 100).toFixed(0)}%)\nVolume: $${market.volume.toLocaleString()}\nEnd date: ${market.end_date}`,
        maxTokens: 200,
        expectJson: true,
      })

      const edge = Math.abs(analysis.ai_probability - market.yes_price)

      const edgePct = (edge * 100).toFixed(1)
      const passing = edge >= 0.03 && analysis.confidence >= 50

      await log(db, 'polymarket-scanner', passing ? 'ok' : 'info',
        `"${market.question.slice(0, 50)}..." Market:${(market.yes_price * 100).toFixed(0)}% AI:${(analysis.ai_probability * 100).toFixed(0)}% Edge:${edgePct}% Conf:${analysis.confidence}%${passing ? ' → BETTING' : ''}`)

      if (!passing) continue

      const side: 'YES' | 'NO' = analysis.ai_probability > market.yes_price ? 'YES' : 'NO'
      const betAmount = Math.min(poly.MAX_BET_USD, 10 + edge * 40)

      const result = await poly.placeBet({
        market_id:      market.id,
        question:       market.question,
        side,
        market_price:   market.yes_price,
        ai_probability: analysis.ai_probability,
        edge,
        amount_usd:     Math.round(betAmount * 100) / 100,
        reasoning:      analysis.reasoning,
      })

      if (result.success) betsPlaced++
    } catch (err) {
      await log(db, 'polymarket-scanner', 'error', `Analysis failed for "${market.question.slice(0, 40)}": ${String(err)}`)
    }
  }

  await log(db, 'polymarket-scanner', 'ok', `Scan complete: ${tradeable.length} markets scanned, ${betsPlaced} bets placed`)
  return { scanned: tradeable.length, bets: betsPlaced }
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function fmt$(n: number): string {
  return n >= 1000 ? `$${n.toLocaleString('en', { maximumFractionDigits: 0 })}` : `$${n.toFixed(2)}`
}

async function log(
  db: ReturnType<typeof createServiceSupabase>,
  agent: AgentName,
  level: 'ok' | 'warn' | 'error' | 'info',
  message: string,
  metadata?: Record<string, unknown>
) {
  console.log(`[${agent}] ${level}: ${message}`)
  await db.from('agent_logs').insert({ agent, level, message, metadata })
}
