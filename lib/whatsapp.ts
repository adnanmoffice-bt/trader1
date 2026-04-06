import { createServiceSupabase } from '@/lib/supabase'
import type { Signal, DemoSession } from '@/types'

const AED_USD = 3.6725
const TEAM = ['Sachin', 'Adnan', 'Mohammad']
const GREETINGS = [
  `What's up ${TEAM.join(', ')}! 🤝`,
  `Gentlemen — ${TEAM.join(', ')} — let's get it! 💪`,
  `${TEAM.join(', ')} — your AI is on it. 🤖`,
  `Morning bosses! ${TEAM.join(', ')} — here's the update. ☕`,
  `${TEAM[0]}, ${TEAM[1]}, ${TEAM[2]} — APEX reporting in. ⚡`,
  `Team! Your boy APEX has news. 📢`,
]
function greet() { return GREETINGS[Math.floor(Math.random() * GREETINGS.length)] }

interface WhatsAppConfig {
  apiUrl: string
  instanceId: string
  apiToken: string
  groupId?: string
}

async function getConfig(userId?: string): Promise<WhatsAppConfig | null> {
  const db = createServiceSupabase()

  if (userId) {
    const { data } = await db
      .from('user_settings')
      .select('whatsapp_instance_id, whatsapp_api_token, whatsapp_group_id, whatsapp_enabled')
      .eq('user_id', userId)
      .single()

    if (data?.whatsapp_instance_id && data?.whatsapp_api_token && data?.whatsapp_enabled) {
      return {
        apiUrl: 'https://7107.api.greenapi.com',
        instanceId: data.whatsapp_instance_id,
        apiToken: data.whatsapp_api_token,
        groupId: data.whatsapp_group_id,
      }
    }
  }

  // Fallback: try any user with WhatsApp enabled, or env vars
  const { data: anyUser } = await db
    .from('user_settings')
    .select('whatsapp_instance_id, whatsapp_api_token, whatsapp_group_id')
    .eq('whatsapp_enabled', true)
    .limit(1)
    .single()

  if (anyUser?.whatsapp_instance_id && anyUser?.whatsapp_api_token) {
    return {
      apiUrl: 'https://7107.api.greenapi.com',
      instanceId: anyUser.whatsapp_instance_id,
      apiToken: anyUser.whatsapp_api_token,
      groupId: anyUser.whatsapp_group_id,
    }
  }

  const instanceId = process.env.GREEN_API_INSTANCE_ID
  const apiToken = process.env.GREEN_API_TOKEN
  if (!instanceId || !apiToken) return null

  return { apiUrl: process.env.GREEN_API_URL || 'https://7107.api.greenapi.com', instanceId, apiToken }
}

async function greenApiCall(config: WhatsAppConfig, method: string, body?: Record<string, unknown>) {
  const url = `${config.apiUrl}/waInstance${config.instanceId}/${method}/${config.apiToken}`
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

// ─── Core Send Functions ────────────────────────────────────────────────────

export async function sendMessage(chatId: string, message: string, userId?: string): Promise<boolean> {
  const config = await getConfig(userId)
  if (!config) return false
  try {
    const result = await greenApiCall(config, 'sendMessage', { chatId, message })
    return !!result.idMessage
  } catch (err) {
    console.error('[whatsapp] sendMessage error:', err)
    return false
  }
}

export async function sendGroupMessage(message: string, userId?: string): Promise<boolean> {
  const config = await getConfig(userId)
  if (!config?.groupId) return false
  return sendMessage(config.groupId, message, userId)
}

export async function getGroups(instanceId: string, apiToken: string): Promise<{ id: string; name: string }[]> {
  const url = `https://7107.api.greenapi.com/waInstance${instanceId}/getContacts/${apiToken}`
  try {
    const res = await fetch(url)
    const contacts = await res.json()
    return (contacts ?? [])
      .filter((c: { id: string }) => c.id.endsWith('@g.us'))
      .map((c: { id: string; name?: string }) => ({
        id: c.id,
        name: c.name || c.id.replace('@g.us', ''),
      }))
  } catch (err) {
    console.error('[whatsapp] getGroups error:', err)
    return []
  }
}

export async function testConnection(instanceId: string, apiToken: string): Promise<{ ok: boolean; phone?: string; error?: string }> {
  try {
    const url = `https://7107.api.greenapi.com/waInstance${instanceId}/getStateInstance/${apiToken}`
    const res = await fetch(url)
    const data = await res.json()
    if (data.stateInstance === 'authorized') {
      const settingsUrl = `https://7107.api.greenapi.com/waInstance${instanceId}/getSettings/${apiToken}`
      const settingsRes = await fetch(settingsUrl)
      const settings = await settingsRes.json()
      return { ok: true, phone: settings.wid?.replace('@c.us', '') }
    }
    return { ok: false, error: `Status: ${data.stateInstance}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error' }
  }
}

function f(n: number): string {
  return n >= 10000 ? n.toLocaleString('en', { maximumFractionDigits: 0 }) : n.toFixed(2)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. SIGNAL ALERT — New AI signal generated
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifySignal(signal: Signal, userId?: string) {
  const icon = signal.direction === 'long' ? '🟢' : signal.direction === 'short' ? '🔴' : '🟡'
  const dir = signal.direction.toUpperCase()
  const rr = signal.risk_reward ? `R:R ${signal.risk_reward}x` : ''

  const msg = `${icon} *APEX SIGNAL — ${dir} ${signal.instrument}*
━━━━━━━━━━━━━━━━━━
${greet()}

📍 Entry: $${f(signal.entry_price ?? 0)}
🛑 Stop Loss: $${f(signal.stop_loss ?? 0)}
🎯 Target 1: $${f(signal.take_profit_1 ?? 0)}
🎯 Target 2: $${f(signal.take_profit_2 ?? 0)}
📊 Confidence: ${signal.confidence}% | ${rr}
━━━━━━━━━━━━━━━━━━
🧠 ${signal.reasoning.slice(0, 200)}
🤖 ${signal.ai_analysis.slice(0, 150)}
⏰ ${new Date().toLocaleTimeString('en', { timeZone: 'Asia/Dubai' })} UAE`

  return sendGroupMessage(msg, userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. WAR ROOM — Meeting decision summary
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyWarRoomDecision(data: {
  instrument: string
  decision: string
  execute: boolean
  direction?: string
  entry?: number
  sl?: number
  tp?: number
  rr?: number
  votesFor: number
  votesAgainst: number
  trigger?: string
  backtestWins?: number
  backtestLosses?: number
  kelly?: number
}, userId?: string) {
  const icon = data.execute ? '⚔️' : '🚫'
  const verdict = data.execute ? 'EXECUTE' : 'REJECTED'

  let msg = `${icon} *WAR ROOM — ${data.instrument}*
━━━━━━━━━━━━━━━━━━
${data.execute ? `${TEAM.join(', ')} — 12 AI agents debated and we're going in! 🔥` : `${TEAM.join(', ')} — sat this one out. Protecting your capital. 🛡️`}

📋 Verdict: *${verdict}*
🗳️ Vote: ${data.votesFor} FOR / ${data.votesAgainst} AGAINST`

  if (data.execute && data.entry) {
    msg += `

📍 ${data.direction?.toUpperCase()} @ $${f(data.entry)}
🛑 SL: $${f(data.sl ?? 0)} | 🎯 TP: $${f(data.tp ?? 0)}
📊 R:R: ${data.rr?.toFixed(2) ?? '?'}x`
  }

  if (data.trigger) msg += `\n🔔 Trigger: ${data.trigger}`
  if (data.backtestWins !== undefined) msg += `\n🧪 Backtest: ${data.backtestWins}W / ${data.backtestLosses}L`
  if (data.kelly) msg += `\n📐 Kelly: ${(data.kelly * 100).toFixed(1)}%`

  msg += `\n\n💬 "${data.decision.slice(0, 200)}"`
  msg += `\n⏰ ${new Date().toLocaleTimeString('en', { timeZone: 'Asia/Dubai' })} UAE`

  return sendGroupMessage(msg, userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2b. WAR ROOM — Meeting opened (trigger detected)
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyWarRoomOpen(data: {
  instrument: string; price: number; trigger: string; direction: string;
  rsi: number; atr: number; volumeRatio: number; triggerCount: number;
}, userId?: string) {
  const icon = data.direction === 'long' ? '🟢' : '🔴'

  const msg = `🏛️ *WAR ROOM OPENED — ${data.instrument}*
━━━━━━━━━━━━━━━━━━
${TEAM.join(', ')} — I detected something! Calling all 12 agents to debate.

${icon} Trigger: *${data.trigger}* → ${data.direction.toUpperCase()}
💲 Price: $${f(data.price)}
📊 RSI: ${data.rsi.toFixed(0)} | ATR: ${data.atr.toFixed(2)} | Vol: ${data.volumeRatio.toFixed(1)}x
${data.triggerCount > 1 ? `⚡ ${data.triggerCount} signals detected — strong confluence!` : ''}

🎙️ Agents debating now... stand by for verdict.`

  return sendGroupMessage(msg, userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2c. WAR ROOM — Live debate summary (agents talking)
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyWarRoomDebate(data: {
  instrument: string;
  agents: { name: string; stance: 'bullish' | 'bearish' | 'neutral'; summary: string }[];
}, userId?: string) {
  const stanceIcon = (s: string) => s === 'bullish' ? '🟢' : s === 'bearish' ? '🔴' : '🟡'

  const agentLines = data.agents.map(a =>
    `${stanceIcon(a.stance)} *${a.name}*: ${a.summary}`
  ).join('\n')

  const bullish = data.agents.filter(a => a.stance === 'bullish').length
  const bearish = data.agents.filter(a => a.stance === 'bearish').length

  const msg = `🎙️ *WAR ROOM DEBATE — ${data.instrument}*
━━━━━━━━━━━━━━━━━━
${TEAM.join(', ')} — here's what the agents are saying:

${agentLines}

📊 Running tally: ${bullish} bullish / ${bearish} bearish
⏳ Orchestrator making final decision...`

  return sendGroupMessage(msg, userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2d. WAR ROOM — Blocked by risk rules
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyWarRoomBlocked(data: {
  instrument: string; reason: string; blocker: string;
}, userId?: string) {
  const msg = `🛡️ *WAR ROOM BLOCKED — ${data.instrument}*
━━━━━━━━━━━━━━━━━━
${TEAM.join(', ')} — I was about to trade but risk controls stopped me.
Better safe than sorry with your money! 💰

⛔ Blocked by: *${data.blocker}*
📋 Reason: ${data.reason}
— APEX AI 🛡️`

  return sendGroupMessage(msg, userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2e. WAR ROOM — Quick scan summary (periodic)
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyWarRoomScan(data: {
  totalScanned: number; triggersFound: number;
  instruments: { symbol: string; status: string }[];
}, userId?: string) {
  if (data.triggersFound === 0) return false

  const lines = data.instruments
    .filter(i => i.status !== 'no trigger')
    .map(i => `  📌 ${i.symbol}: ${i.status}`)
    .join('\n')

  const msg = `🔍 *MARKET SCAN COMPLETE*
━━━━━━━━━━━━━━━━━━
${TEAM.join(', ')} — just scanned ${data.totalScanned} markets.

🎯 Triggers found: ${data.triggersFound}
${lines}

${data.triggersFound > 0 ? 'Opening War Room debates now... 🏛️' : 'Markets quiet. Staying patient for you. 😎'}
— APEX AI`

  return sendGroupMessage(msg, userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. TRADE OPENED
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyTradeOpened(trade: {
  instrument: string; direction: string; entry_price: number;
  quantity: number; stop_loss?: number; take_profit?: number;
}, userId?: string) {
  const icon = trade.direction === 'long' ? '🟢' : '🔴'
  const notional = trade.quantity * trade.entry_price

  const msg = `${icon} *TRADE OPENED*
━━━━━━━━━━━━━━━━━━
Bosses, we're in! Your money is working. 💰

📈 ${trade.direction.toUpperCase()} ${trade.instrument}
📍 Entry: $${f(trade.entry_price)}
📦 Size: ${trade.quantity.toFixed(6)} (~$${notional.toFixed(0)})
🛑 SL: $${f(trade.stop_loss ?? 0)}
🎯 TP: $${f(trade.take_profit ?? 0)}
⏰ ${new Date().toLocaleTimeString('en', { timeZone: 'Asia/Dubai' })} UAE`

  return sendGroupMessage(msg, userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. TRADE CLOSED — SL/TP hit or manual
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyTradeClosed(trade: {
  instrument: string; direction: string; entry_price: number;
  exit_price: number; pnl: number; pnl_pct: number;
  reason: string;
}, userId?: string) {
  const won = trade.pnl >= 0
  const icon = won ? '✅' : '❌'
  const label = trade.reason === 'take_profit' ? 'TAKE PROFIT HIT' : trade.reason === 'stop_loss' ? 'STOP LOSS HIT' : 'TRADE CLOSED'
  const pnlAed = trade.pnl * AED_USD

  const winMsg = [
    `${TEAM.join(', ')} — cha-ching! 🎉💰`,
    `Money in the bank, gentlemen! 🏦`,
    `Another W for the team! ${TEAM[0]}, ${TEAM[1]}, ${TEAM[2]} 🔥`,
  ]
  const lossMsg = [
    `Took an L on this one, team. Part of the game. 💪`,
    `Loss today, lessons learned. We bounce back. 📈`,
    `Small setback. Trust the process, ${TEAM.join(', ')}. 🛡️`,
  ]
  const comment = won
    ? winMsg[Math.floor(Math.random() * winMsg.length)]
    : lossMsg[Math.floor(Math.random() * lossMsg.length)]

  const msg = `${icon} *${label}*
━━━━━━━━━━━━━━━━━━
${comment}

${trade.direction.toUpperCase()} ${trade.instrument}
📍 Entry: $${f(trade.entry_price)} → Exit: $${f(trade.exit_price)}
💰 P&L: ${won ? '+' : ''}$${f(trade.pnl)} (${won ? '+' : ''}${trade.pnl_pct.toFixed(2)}%)
💵 P&L AED: ${won ? '+' : ''}${pnlAed.toFixed(0)} AED
⏰ ${new Date().toLocaleTimeString('en', { timeZone: 'Asia/Dubai' })} UAE`

  return sendGroupMessage(msg, userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. POSITION ALERT — SL/TP triggered
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyPositionAlert(
  instrument: string,
  event: 'take_profit' | 'stop_loss' | 'manual',
  pnl: number,
  pnlPct: number,
  userId?: string,
) {
  const isProfit = event === 'take_profit'
  const icon = isProfit ? '✅' : event === 'stop_loss' ? '🛑' : 'ℹ️'
  const label = isProfit ? 'TAKE PROFIT HIT' : event === 'stop_loss' ? 'STOP LOSS HIT' : 'POSITION CLOSED'

  const msg = `${icon} *${label} — ${instrument}*
━━━━━━━━━━━━━━━━━━
💰 P&L: ${pnl >= 0 ? '+' : ''}AED ${Math.abs(pnl).toLocaleString()} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)
⏰ ${new Date().toLocaleTimeString('en', { timeZone: 'Asia/Dubai' })} UAE`

  return sendGroupMessage(msg, userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. MORNING BRIEFING — Sent at market open
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyMorningBriefing(portfolio: {
  capital: number; totalPnl: number; openPositions: number;
}, topSignals: Signal[], userId?: string) {
  const date = new Date().toLocaleDateString('en', {
    timeZone: 'Asia/Dubai', weekday: 'long', day: 'numeric', month: 'long',
  })

  const sigLines = topSignals.slice(0, 3).map(s => {
    const icon = s.direction === 'long' ? '🟢' : s.direction === 'short' ? '🔴' : '🟡'
    return `${icon} ${s.instrument} ${s.direction.toUpperCase()} — Conf ${s.confidence}%`
  }).join('\n')

  const msg = `☀️ *APEX Morning Briefing — ${date}*
━━━━━━━━━━━━━━━━━━
Good morning ${TEAM.join(', ')}! ☕
Your AI has been scanning markets all night. Here's what I found:

💼 Portfolio: AED ${portfolio.capital.toLocaleString()}
📈 Total P&L: ${portfolio.totalPnl >= 0 ? '+' : ''}AED ${portfolio.totalPnl.toLocaleString()}
🔓 Open positions: ${portfolio.openPositions}

🎯 *Top Signals:*
${sigLines || 'Markets are quiet — staying patient for you.'}

Let's make money today! 💰🚀`

  return sendGroupMessage(msg, userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. DAILY REPORT — End of day summary
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyDailySummary(summary: {
  total_trades: number; wins: number; losses: number;
  daily_pnl: number; capital: number; win_rate: number;
}, userId?: string) {
  const icon = summary.daily_pnl >= 0 ? '📈' : '📉'
  const date = new Date().toLocaleDateString('en', {
    timeZone: 'Asia/Dubai', weekday: 'long', day: 'numeric', month: 'long',
  })

  const endOfDay = summary.daily_pnl >= 0
    ? `✅ Profitable day! Well done ${TEAM.join(', ')} — your investment is paying off. 🤝`
    : `📉 Tough day. But ${TEAM.join(', ')}, I'm learning and adapting. We come back stronger. 💪`

  const msg = `${icon} *APEX Daily Report — ${date}*
━━━━━━━━━━━━━━━━━━
${TEAM.join(', ')} — here's your end-of-day update:

🔄 Trades: ${summary.total_trades} (${summary.wins}W / ${summary.losses}L)
📊 Win Rate: ${summary.win_rate.toFixed(1)}%
💰 Daily P&L: ${summary.daily_pnl >= 0 ? '+' : ''}${summary.daily_pnl.toFixed(0)} AED
🏦 Capital: ${summary.capital.toLocaleString()} AED

${endOfDay}
— APEX AI 🤖`

  return sendGroupMessage(msg, userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. KILL SWITCH ALERT
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyKillSwitch(activated: boolean, reason?: string, userId?: string) {
  const msg = activated
    ? `🚨🚨🚨 *KILL SWITCH ACTIVATED*
━━━━━━━━━━━━━━━━━━
${TEAM.join(', ')} — I've stopped ALL trading to protect your capital!

⛔ ALL trading HALTED for 24 hours
${reason ? `📋 Reason: ${reason}` : ''}
🔧 Deactivate manually in Settings when you're ready.
— APEX AI 🛡️`
    : `✅ *KILL SWITCH DEACTIVATED*
━━━━━━━━━━━━━━━━━━
${TEAM.join(', ')} — back in action! Trading is live again. Let's go! 🚀
— APEX AI 🤖`

  return sendGroupMessage(msg, userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. DEMO SESSION REPORT
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyDemoReport(session: DemoSession, userId?: string) {
  const pnl = session.total_pnl ?? 0
  const pct = session.total_pnl_pct ?? 0
  const icon = pnl >= 0 ? '📈' : '📉'

  let msg = `${icon} *APEX Demo Results*
━━━━━━━━━━━━━━━━━━
${TEAM.join(', ')} — simulation complete! Here's how I performed with your strategy:

📅 ${session.start_date} → ${session.end_date}
💰 Capital: AED ${session.initial_capital.toLocaleString()}
💵 Final: AED ${(session.final_capital ?? session.initial_capital).toLocaleString()}
📊 P&L: ${pnl >= 0 ? '+' : ''}AED ${Math.abs(pnl).toLocaleString()} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)

🔄 Trades: ${session.total_trades} (${session.win_count}W / ${session.loss_count}L)`

  if (session.sharpe_ratio) msg += `\n📐 Sharpe: ${session.sharpe_ratio.toFixed(2)}`
  if (session.max_drawdown) msg += `\n📉 Max Drawdown: ${(session.max_drawdown * 100).toFixed(1)}%`

  return sendGroupMessage(msg, userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. PROFIT ALLOCATION — Reinvest/payout/reserve split
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyProfitAllocation(alloc: {
  totalProfit: number; reinvestPct: number; payoutPct: number; reservePct: number;
  reinvestAmt: number; payoutAmt: number; reserveAmt: number;
  payoutReady: boolean; reason: string;
}, userId?: string) {
  const icon = alloc.payoutReady ? '💸' : '📊'

  const msg = `${icon} *PROFIT ALLOCATION*
━━━━━━━━━━━━━━━━━━
${TEAM.join(', ')} — here's how I'm splitting the profits:

💰 Total Profit: AED ${alloc.totalProfit.toFixed(0)}

📊 Split:
  🔄 Reinvest: ${alloc.reinvestPct}% (AED ${alloc.reinvestAmt.toFixed(0)})
  💵 Payout: ${alloc.payoutPct}% (AED ${alloc.payoutAmt.toFixed(0)})
  🛡️ Reserve: ${alloc.reservePct}% (AED ${alloc.reserveAmt.toFixed(0)})

${alloc.payoutReady ? `✅ Payout ready! ${TEAM.join(', ')} — time to enjoy the fruits! 🍾` : '⏳ Building capital — patience pays off, gentlemen. 💎'}
📋 ${alloc.reason.slice(0, 200)}
— APEX AI 🤖`

  return sendGroupMessage(msg, userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 11. RISK ALERT — Drawdown/loss limit warning
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyRiskAlert(data: {
  type: 'drawdown' | 'daily_loss' | 'max_positions';
  current: number; limit: number; detail: string;
}, userId?: string) {
  const icons = { drawdown: '📉', daily_loss: '🔻', max_positions: '🚧' }
  const labels = { drawdown: 'DRAWDOWN WARNING', daily_loss: 'DAILY LOSS WARNING', max_positions: 'MAX POSITIONS REACHED' }

  const msg = `${icons[data.type]} *${labels[data.type]}*
━━━━━━━━━━━━━━━━━━
Heads up ${TEAM.join(', ')}! I'm watching the risk for you.

⚠️ Current: ${data.current.toFixed(1)}% | Limit: ${data.limit.toFixed(1)}%
📋 ${data.detail}
🔧 Adjust limits in Settings if needed.
— APEX AI 🛡️`

  return sendGroupMessage(msg, userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 12. WEEKLY PERFORMANCE — Sent every Sunday
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyWeeklyReport(data: {
  totalTrades: number; wins: number; losses: number;
  weeklyPnl: number; capital: number; winRate: number;
  bestTrade: string; worstTrade: string;
  sharpe?: number;
}, userId?: string) {
  const icon = data.weeklyPnl >= 0 ? '📈' : '📉'

  const msg = `${icon} *APEX Weekly Report*
━━━━━━━━━━━━━━━━━━
${TEAM.join(', ')} — your weekly performance review:

🔄 Trades: ${data.totalTrades} (${data.wins}W / ${data.losses}L)
📊 Win Rate: ${data.winRate.toFixed(1)}%
💰 Weekly P&L: ${data.weeklyPnl >= 0 ? '+' : ''}${data.weeklyPnl.toFixed(0)} AED
🏦 Capital: ${data.capital.toLocaleString()} AED
${data.sharpe ? `📐 Sharpe: ${data.sharpe.toFixed(2)}` : ''}

🏆 Best: ${data.bestTrade}
💀 Worst: ${data.worstTrade}

${data.weeklyPnl >= 0 ? `🎉 Great week gentlemen! Your AI is earning its keep. 🤖💰` : `💪 Tough week, but I'm adapting. ${TEAM.join(', ')} — next week we come back stronger. 🔥`}
— APEX AI`

  return sendGroupMessage(msg, userId)
}
