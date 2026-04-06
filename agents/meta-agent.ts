import { callAgent } from '@/lib/anthropic'
import { createServiceSupabase } from '@/lib/supabase'
import { sendGroupMessage } from '@/lib/whatsapp'
import { AGENT_PROMPTS, AGENT_TOKEN_LIMITS, type AgentId } from '@/agents/agent-prompts'
import type { Instrument } from '@/types'

const ALL_AGENTS: AgentId[] = [
  'macro-agent', 'correlation-agent', 'bull-agent', 'bear-agent',
  'scalper-agent', 'trend-agent', 'market-analyst', 'signal-generator',
  'risk-manager', 'trade-reviewer', 'master-agent', 'orchestrator',
]

const AGENT_NAMES: Record<string, string> = {
  'macro-agent': '🌍 Macro', 'correlation-agent': '🔗 Correlation', 'bull-agent': '🐂 Bull',
  'bear-agent': '🐻 Bear', 'scalper-agent': '⚡ Scalper', 'trend-agent': '📈 Trend',
  'market-analyst': '📰 Analyst', 'signal-generator': '🎯 Signal', 'risk-manager': '🛡 Risk',
  'trade-reviewer': '📊 Reviewer', 'master-agent': '👑 Master', 'orchestrator': '🧠 Orchestrator',
}

// ═══════════════════════════════════════════════════════════════════════════════
// DAILY REVIEW — Runs every day at 6 AM Dubai
// ═══════════════════════════════════════════════════════════════════════════════

export async function runDailyReview(): Promise<{ actions: string[]; insights: string[] }> {
  const db = createServiceSupabase()
  const actions: string[] = []
  const insights: string[] = []
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString()

  // Load recent War Room sessions
  const { data: recentDecisions } = await db.from('war_room_messages')
    .select('meeting_id, instrument, agent, role, message, data, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: true })

  if (!recentDecisions?.length) {
    await sendGroupMessage('🧬 META AGENT — Daily Review\n\nNo War Room sessions in the last 24h. Nothing to analyze.').catch(() => {})
    return { actions: ['no sessions'], insights: [] }
  }

  // Group by meeting
  const meetings = new Map<string, typeof recentDecisions>()
  for (const msg of recentDecisions) {
    const list = meetings.get(msg.meeting_id) ?? []
    list.push(msg)
    meetings.set(msg.meeting_id, list)
  }

  // For each meeting, check if the signal direction was correct
  const agentScores: Record<string, { correct: number; total: number }> = {}
  for (const id of ALL_AGENTS) agentScores[id] = { correct: 0, total: 0 }

  for (const [meetingId, msgs] of meetings) {
    const decision = msgs.find(m => m.role === 'decision')
    if (!decision?.data) continue
    const direction = decision.data.direction as string | undefined
    const instrument = decision.instrument
    if (!direction || !instrument) continue

    // Check actual price move since the signal
    const signalTime = new Date(decision.created_at).getTime()
    const { data: priceAfter } = await db.from('price_history')
      .select('close, timestamp')
      .eq('symbol', instrument)
      .eq('interval', '1h')
      .gt('timestamp', new Date(signalTime).toISOString())
      .order('timestamp', { ascending: true })
      .limit(24)

    if (!priceAfter?.length) continue

    const { data: priceBefore } = await db.from('price_history')
      .select('close')
      .eq('symbol', instrument)
      .eq('interval', '1h')
      .lte('timestamp', new Date(signalTime).toISOString())
      .order('timestamp', { ascending: false })
      .limit(1)
      .single()

    if (!priceBefore) continue

    const entryPrice = Number(priceBefore.close)
    const maxPrice = Math.max(...priceAfter.map(c => Number(c.close)))
    const minPrice = Math.min(...priceAfter.map(c => Number(c.close)))
    const finalPrice = Number(priceAfter[priceAfter.length - 1].close)

    const wasCorrect = direction === 'long'
      ? finalPrice > entryPrice
      : finalPrice < entryPrice

    // Score each speaking agent
    for (const msg of msgs.filter(m => m.role === 'speak')) {
      const agentId = msg.agent as AgentId
      if (!agentScores[agentId]) continue
      agentScores[agentId].total++

      const bullish = /bullish|long|buy|upside|approve|execute|for|support/i.test(msg.message)
      const bearish = /bearish|short|sell|downside|reject|against|caution/i.test(msg.message)
      const agentBullish = bullish && !bearish
      const agentBearish = bearish && !bullish

      const agentWasRight =
        (agentBullish && direction === 'long' && wasCorrect) ||
        (agentBearish && direction === 'short' && wasCorrect) ||
        (agentBearish && direction === 'long' && !wasCorrect) ||
        (agentBullish && direction === 'short' && !wasCorrect)

      if (agentWasRight) agentScores[agentId].correct++
    }
  }

  // Build scores report
  const scoreLines: string[] = []
  let worstAgent: AgentId | null = null
  let worstAccuracy = 100

  for (const id of ALL_AGENTS) {
    const s = agentScores[id]
    if (s.total === 0) continue
    const acc = Math.round((s.correct / s.total) * 100)
    const mark = acc >= 70 ? '✓' : acc >= 50 ? '~' : '✗'
    scoreLines.push(`  ${AGENT_NAMES[id]}: ${acc}% ${mark} (${s.correct}/${s.total})`)

    // Store score in DB
    await db.from('agent_knowledge').insert({
      agent_id: id, type: 'score',
      content: `Accuracy: ${acc}% (${s.correct}/${s.total} correct in last 24h)`,
      metadata: { accuracy: acc, correct: s.correct, total: s.total, date: new Date().toISOString() },
    })

    if (acc < worstAccuracy && s.total >= 2) {
      worstAccuracy = acc
      worstAgent = id
    }
  }

  // Use Claude to analyze patterns and generate improvement
  const analysisInput = `Agent accuracy scores (last 24h):
${scoreLines.join('\n')}

Total meetings analyzed: ${meetings.size}
Meetings with decisions: ${[...meetings.values()].filter(msgs => msgs.some(m => m.role === 'decision')).length}

${worstAgent ? `Worst performing agent: ${AGENT_NAMES[worstAgent]} at ${worstAccuracy}%` : 'All agents performed acceptably.'}

Recent meeting excerpts (last 3):
${[...meetings.entries()].slice(-3).map(([id, msgs]) => {
  const dec = msgs.find(m => m.role === 'decision')
  const instrument = dec?.instrument ?? msgs[0]?.instrument ?? '?'
  return `--- ${instrument} ---\n${msgs.filter(m => m.role === 'speak' || m.role === 'decision').map(m => `[${m.agent}]: ${m.message.slice(0, 150)}...`).join('\n')}`
}).join('\n\n')}`

  const metaAnalysis = await callAgent<string>({
    system: `You are the Meta Agent — a trading system optimizer. Analyze the performance data and identify:
1. PATTERNS: What systematic biases or errors do you see in the agents?
2. INSIGHTS: What market conditions are the agents good at vs bad at?
3. IMPROVEMENT: If you had to improve ONE agent's prompt, which one and how specifically?
4. STRATEGIC: Any strategic recommendation for the overall system?

Be specific and actionable. Reference actual accuracy numbers.`,
    user: analysisInput,
    maxTokens: 1000,
    timeoutMs: 30000,
  })

  insights.push(metaAnalysis)

  // Store the insight
  await db.from('agent_knowledge').insert({
    agent_id: 'meta-agent', type: 'insight',
    content: metaAnalysis,
    metadata: { type: 'daily', meetings: meetings.size, date: new Date().toISOString() },
  })

  // If worst agent is bad enough, generate an improved prompt
  if (worstAgent && worstAccuracy < 55 && agentScores[worstAgent].total >= 3) {
    // Check we haven't already updated this agent today
    const { data: recentUpdate } = await db.from('agent_knowledge')
      .select('id').eq('agent_id', worstAgent).eq('type', 'prompt')
      .gte('created_at', since).limit(1)

    if (!recentUpdate?.length) {
      const { data: currentPrompt } = await db.from('agent_knowledge')
        .select('content, version').eq('agent_id', worstAgent).eq('type', 'prompt').eq('active', true)
        .order('version', { ascending: false }).limit(1).single()

      const basePrompt = currentPrompt?.content ?? AGENT_PROMPTS[worstAgent]({
        instrument: 'BTC/USD', triggerDir: 'long', price: 90000, rsi: 50, atr: 1000,
        bbPercentB: 0.5, ema20: 89000, ema50: 88000, ema200: 85000, macdHist: 0, volumeRatio: 1,
      })
      const currentVersion = currentPrompt?.version ?? 0

      const improvedPrompt = await callAgent<string>({
        system: `You are a prompt engineer optimizing AI trading agent prompts. The agent "${AGENT_NAMES[worstAgent]}" has ${worstAccuracy}% accuracy.

RULES:
- Keep the same structure and methodology but make the analysis more rigorous
- Add specific checks that would catch the errors this agent has been making
- Do NOT change the trading methodology (ICT, Wyckoff, etc.) — refine it
- The improved prompt must be a complete system prompt, not a diff
- Make the agent more data-driven and less opinion-driven
- Add explicit "red flag" checks that force the agent to reconsider its stance`,
        user: `Current prompt:\n${basePrompt}\n\nMeta-analysis of errors:\n${metaAnalysis}\n\nGenerate the COMPLETE improved system prompt. Output ONLY the prompt text, nothing else.`,
        maxTokens: 2000,
        timeoutMs: 45000,
      })

      // Deactivate old prompt
      await db.from('agent_knowledge').update({ active: false })
        .eq('agent_id', worstAgent).eq('type', 'prompt').eq('active', true)

      // Store new prompt
      await db.from('agent_knowledge').insert({
        agent_id: worstAgent, type: 'prompt',
        content: improvedPrompt,
        version: currentVersion + 1,
        active: true,
        metadata: {
          reason: `Accuracy dropped to ${worstAccuracy}%`,
          previousAccuracy: worstAccuracy,
          metaAnalysis: metaAnalysis.slice(0, 500),
        },
      })

      actions.push(`Updated ${AGENT_NAMES[worstAgent]} prompt (v${currentVersion} → v${currentVersion + 1})`)

      // WhatsApp: prompt change notification
      await sendGroupMessage(
        `🧬 META AGENT — Prompt Updated\n\n` +
        `🔧 Agent: ${AGENT_NAMES[worstAgent]}\n` +
        `📉 Accuracy was: ${worstAccuracy}% (${agentScores[worstAgent].correct}/${agentScores[worstAgent].total})\n` +
        `📝 Version: v${currentVersion} → v${currentVersion + 1}\n` +
        `💡 Reason: ${metaAnalysis.slice(0, 200)}...`
      ).catch(() => {})
    }
  }

  // WhatsApp: daily review summary
  const summaryMsg =
    `🧬 APEX META AGENT — Daily Review\n\n` +
    `📊 Agent Accuracy (24h):\n${scoreLines.join('\n')}\n\n` +
    `📋 Sessions analyzed: ${meetings.size}\n` +
    `${actions.length > 0 ? `\n🔧 Changes made:\n${actions.map(a => `  • ${a}`).join('\n')}` : '✅ No prompt changes needed'}\n\n` +
    `💡 Insight:\n${metaAnalysis.slice(0, 400)}${metaAnalysis.length > 400 ? '...' : ''}`

  await sendGroupMessage(summaryMsg).catch(() => {})

  return { actions, insights }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEEKLY DEEP REVIEW — Runs Sunday 8 AM Dubai
// ═══════════════════════════════════════════════════════════════════════════════

export async function runWeeklyDeepReview(): Promise<{ actions: string[]; report: string }> {
  const db = createServiceSupabase()
  const actions: string[] = []
  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString()

  // Load all scores from the week
  const { data: weekScores } = await db.from('agent_knowledge')
    .select('agent_id, metadata').eq('type', 'score')
    .gte('created_at', since)

  // Load all insights from the week
  const { data: weekInsights } = await db.from('agent_knowledge')
    .select('content, created_at').eq('type', 'insight')
    .gte('created_at', since)
    .order('created_at', { ascending: true })

  // Load demo trade outcomes
  const { data: weekTrades } = await db.from('demo_trades')
    .select('instrument, direction, pnl_aed, exit_reason, signal_reason')
    .not('exit_time', 'is', null)
    .gte('exit_time', since)

  // Aggregate agent scores
  const weeklyAgg: Record<string, { totalCorrect: number; totalAll: number; dailyScores: number[] }> = {}
  for (const id of ALL_AGENTS) weeklyAgg[id] = { totalCorrect: 0, totalAll: 0, dailyScores: [] }

  for (const score of weekScores ?? []) {
    const meta = score.metadata as { accuracy?: number; correct?: number; total?: number } | null
    if (!meta || !weeklyAgg[score.agent_id]) continue
    weeklyAgg[score.agent_id].totalCorrect += meta.correct ?? 0
    weeklyAgg[score.agent_id].totalAll += meta.total ?? 0
    if (meta.accuracy !== undefined) weeklyAgg[score.agent_id].dailyScores.push(meta.accuracy)
  }

  // Trade stats
  const totalTrades = weekTrades?.length ?? 0
  const wins = weekTrades?.filter(t => Number(t.pnl_aed) > 0).length ?? 0
  const losses = totalTrades - wins
  const totalPnl = weekTrades?.reduce((s, t) => s + Number(t.pnl_aed || 0), 0) ?? 0
  const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0

  // Build comprehensive report for Claude
  const agentSummaries = ALL_AGENTS.map(id => {
    const a = weeklyAgg[id]
    const weekAcc = a.totalAll > 0 ? Math.round((a.totalCorrect / a.totalAll) * 100) : -1
    const trend = a.dailyScores.length >= 3
      ? (a.dailyScores.slice(-3).reduce((s, v) => s + v, 0) / 3 > a.dailyScores.slice(0, 3).reduce((s, v) => s + v, 0) / Math.min(3, a.dailyScores.length) ? '↑ improving' : '↓ declining')
      : '— insufficient data'
    return `${AGENT_NAMES[id]}: ${weekAcc >= 0 ? weekAcc + '%' : 'no data'} (${a.totalCorrect}/${a.totalAll}) ${trend}`
  }).join('\n')

  const insightsSummary = (weekInsights ?? []).map(i => i.content.slice(0, 200)).join('\n---\n')

  const weeklyReport = await callAgent<string>({
    system: `You are the Meta Agent conducting the WEEKLY DEEP REVIEW. This is the most important analysis of the week. Be thorough and strategic.

Analyze:
1. SYSTEM PERFORMANCE: Overall win rate, P&L, which instruments are profitable
2. AGENT RANKINGS: Who performed best/worst this week? Trends?
3. PATTERN RECOGNITION: What market conditions did agents struggle with?
4. STRATEGIC ADJUSTMENTS: What changes would improve the system?
5. PROMPT RECOMMENDATIONS: For EACH underperforming agent, suggest specific improvements
6. RISK ASSESSMENT: Is the system taking appropriate risk?
7. OUTLOOK: Based on patterns this week, what should we expect next week?`,
    user: `WEEKLY DATA (${since} to now):

Trading Results:
- Total trades: ${totalTrades} (${wins}W / ${losses}L = ${winRate}% win rate)
- Total P&L: ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(0)} AED

Agent Accuracy (weekly aggregate):
${agentSummaries}

Daily Insights from the week:
${insightsSummary || 'No insights recorded.'}

Trade breakdown:
${weekTrades?.map(t => `${t.instrument} ${t.direction} → ${t.exit_reason} (${Number(t.pnl_aed) >= 0 ? '+' : ''}${Number(t.pnl_aed).toFixed(0)} AED) [${t.signal_reason?.slice(0, 50)}]`).join('\n') || 'No trades.'}

Generate the FULL weekly report.`,
    maxTokens: 2000,
    timeoutMs: 45000,
  })

  // Store weekly report
  await db.from('agent_knowledge').insert({
    agent_id: 'meta-agent', type: 'insight',
    content: weeklyReport,
    metadata: {
      type: 'weekly', totalTrades, wins, losses, winRate, totalPnl,
      date: new Date().toISOString(),
    },
  })

  // Generate improved prompts for all underperforming agents
  for (const id of ALL_AGENTS) {
    const a = weeklyAgg[id]
    if (a.totalAll < 5) continue
    const weekAcc = Math.round((a.totalCorrect / a.totalAll) * 100)
    if (weekAcc >= 60) continue

    const { data: current } = await db.from('agent_knowledge')
      .select('content, version').eq('agent_id', id).eq('type', 'prompt').eq('active', true)
      .order('version', { ascending: false }).limit(1).single()

    const currentVersion = current?.version ?? 0
    const basePrompt = current?.content ?? AGENT_PROMPTS[id as AgentId]({
      instrument: 'BTC/USD', triggerDir: 'long', price: 90000, rsi: 50, atr: 1000,
      bbPercentB: 0.5, ema20: 89000, ema50: 88000, ema200: 85000, macdHist: 0, volumeRatio: 1,
    })

    const improved = await callAgent<string>({
      system: `You are optimizing the "${AGENT_NAMES[id]}" trading agent prompt. Weekly accuracy: ${weekAcc}%. This is the weekly deep review — be thorough.
Improve the prompt to be more accurate. Keep the methodology but add rigor. Output ONLY the complete improved prompt.`,
      user: `Current prompt:\n${basePrompt}\n\nWeekly report context:\n${weeklyReport.slice(0, 1000)}\n\nGenerate the improved prompt.`,
      maxTokens: 2000,
      timeoutMs: 45000,
    })

    await db.from('agent_knowledge').update({ active: false })
      .eq('agent_id', id).eq('type', 'prompt').eq('active', true)

    await db.from('agent_knowledge').insert({
      agent_id: id, type: 'prompt', content: improved,
      version: currentVersion + 1, active: true,
      metadata: { reason: `Weekly review: accuracy ${weekAcc}%`, weeklyAccuracy: weekAcc },
    })

    actions.push(`${AGENT_NAMES[id]}: v${currentVersion} → v${currentVersion + 1} (was ${weekAcc}%)`)
  }

  // WhatsApp: comprehensive weekly report
  const waMsg =
    `🧬 APEX META AGENT — Weekly Report\n\n` +
    `📊 Trading Performance:\n` +
    `  Trades: ${totalTrades} (${wins}W / ${losses}L = ${winRate}%)\n` +
    `  P&L: ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(0)} AED\n\n` +
    `🤖 Agent Rankings:\n${agentSummaries}\n\n` +
    `${actions.length > 0 ? `🔧 Prompts Updated:\n${actions.map(a => `  • ${a}`).join('\n')}\n\n` : ''}` +
    `📝 Analysis:\n${weeklyReport.slice(0, 600)}${weeklyReport.length > 600 ? '...' : ''}`

  await sendGroupMessage(waMsg).catch(() => {})

  return { actions, report: weeklyReport }
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST-MEETING BRIEF — Runs after EVERY War Room session (called from war-room.ts)
// ═══════════════════════════════════════════════════════════════════════════════

interface MeetingOutcome {
  instrument: Instrument
  decision: 'executed' | 'rejected' | 'blocked'
  direction?: string
  entry?: number
  sl?: number
  tp?: number
  rr?: number
  votesFor: number
  votesAgainst: number
  trigger?: string
  agentStances: { agent: string; stance: 'bull' | 'bear' | 'neutral' }[]
}

export async function runPostMeetingBrief(outcome: MeetingOutcome): Promise<void> {
  const db = createServiceSupabase()

  // Quick agent accuracy lookup from recent scores
  const { data: recentScores } = await db.from('agent_knowledge')
    .select('agent_id, metadata')
    .eq('type', 'score')
    .order('created_at', { ascending: false })
    .limit(12)

  const accMap: Record<string, number> = {}
  for (const s of recentScores ?? []) {
    const meta = s.metadata as { accuracy?: number } | null
    if (meta?.accuracy !== undefined && !accMap[s.agent_id]) accMap[s.agent_id] = meta.accuracy
  }

  // Count consensus
  const bulls = outcome.agentStances.filter(a => a.stance === 'bull').length
  const bears = outcome.agentStances.filter(a => a.stance === 'bear').length
  const consensusStrength = Math.max(bulls, bears) >= 8 ? '💪 Strong' : Math.max(bulls, bears) >= 6 ? '🤝 Moderate' : '⚖️ Split'

  // Best/worst performing agents in this session (based on historical accuracy)
  const topAgent = outcome.agentStances
    .filter(a => accMap[a.agent] !== undefined)
    .sort((a, b) => (accMap[b.agent] ?? 0) - (accMap[a.agent] ?? 0))[0]
  const weakAgent = outcome.agentStances
    .filter(a => accMap[a.agent] !== undefined)
    .sort((a, b) => (accMap[a.agent] ?? 100) - (accMap[b.agent] ?? 100))[0]

  let msg: string

  if (outcome.decision === 'executed') {
    msg =
      `🧬 META — ${outcome.instrument} ${outcome.direction?.toUpperCase()}\n\n` +
      `✅ TRADE TAKEN\n` +
      `📍 Entry: $${outcome.entry?.toFixed(2) ?? '?'}\n` +
      `🛑 SL: $${outcome.sl?.toFixed(2) ?? '?'} | 🎯 TP: $${outcome.tp?.toFixed(2) ?? '?'}\n` +
      `📊 R:R ${outcome.rr?.toFixed(1) ?? '?'}:1\n` +
      `🗳 Vote: ${outcome.votesFor} FOR / ${outcome.votesAgainst} AGAINST (${consensusStrength})\n` +
      `⚡ Trigger: ${outcome.trigger ?? 'N/A'}\n` +
      (topAgent ? `\n🏆 Most reliable: ${AGENT_NAMES[topAgent.agent]} (${accMap[topAgent.agent]}% acc)` : '') +
      (weakAgent && (accMap[weakAgent.agent] ?? 100) < 55 ? `\n⚠️ Watch: ${AGENT_NAMES[weakAgent.agent]} (${accMap[weakAgent.agent]}% acc)` : '')
  } else if (outcome.decision === 'rejected') {
    msg =
      `🧬 META — ${outcome.instrument}\n\n` +
      `❌ TRADE REJECTED\n` +
      `🗳 Vote: ${outcome.votesFor} FOR / ${outcome.votesAgainst} AGAINST\n` +
      `${consensusStrength} consensus against.\n` +
      `⚡ Trigger was: ${outcome.trigger ?? 'N/A'}`
  } else {
    msg =
      `🧬 META — ${outcome.instrument}\n\n` +
      `🚫 BLOCKED by risk controls\n` +
      `⚡ Trigger: ${outcome.trigger ?? 'N/A'}`
  }

  await sendGroupMessage(msg).catch(() => {})
}
