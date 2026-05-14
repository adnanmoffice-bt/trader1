import { createServiceSupabase } from '@/lib/supabase'
import type { Signal, DemoSession } from '@/types'

// All values in USD.
//
// 2026-05-06 — message style simplified for investor readability. Drop:
//   • decorative "━━━━━━━" dividers
//   • emoji clusters (one functional icon per headline at most)
//   • TEAM greetings ("gentlemen", "let's go", "we adapt")
//   • motivational tail lines ("rough day, trust the process", etc.)
// Keep: facts. Instrument, direction, prices, P&L, time. Same data,
// shorter messages.

interface WhatsAppConfig {
  apiUrl: string
  instanceId: string
  apiToken: string
  groupId?: string
}

async function getConfig(userId?: string): Promise<WhatsAppConfig | null> {
  const db = createServiceSupabase()

  if (userId) {
    const { data, error } = await db
      .from('user_settings')
      .select('whatsapp_instance_id, whatsapp_api_token, whatsapp_group_id, whatsapp_enabled')
      .eq('user_id', userId)
      .single()

    if (error) {
      console.warn('[whatsapp] getConfig user lookup error:', error.message)
    } else if (data?.whatsapp_instance_id && data?.whatsapp_api_token && data?.whatsapp_enabled) {
      console.log('[whatsapp] Config loaded for user', userId.slice(0, 8))
      return {
        apiUrl: 'https://7107.api.greenapi.com',
        instanceId: data.whatsapp_instance_id,
        apiToken: data.whatsapp_api_token,
        groupId: data.whatsapp_group_id,
      }
    } else if (data) {
      console.warn('[whatsapp] User found but config incomplete:', {
        hasInstanceId: !!data.whatsapp_instance_id,
        hasToken: !!data.whatsapp_api_token,
        enabled: data.whatsapp_enabled,
      })
    }
  }

  // Fallback 1: any user with WhatsApp enabled + complete config
  const { data: anyUser, error: fallbackErr } = await db
    .from('user_settings')
    .select('whatsapp_instance_id, whatsapp_api_token, whatsapp_group_id, whatsapp_enabled')
    .eq('whatsapp_enabled', true)
    .not('whatsapp_api_token', 'is', null)
    .not('whatsapp_instance_id', 'is', null)
    .limit(1)
    .maybeSingle()

  if (fallbackErr) {
    console.warn('[whatsapp] getConfig fallback query error:', fallbackErr.message)
  }

  if (anyUser?.whatsapp_instance_id && anyUser?.whatsapp_api_token) {
    console.log('[whatsapp] Config loaded via fallback (enabled user found)')
    return {
      apiUrl: 'https://7107.api.greenapi.com',
      instanceId: anyUser.whatsapp_instance_id,
      apiToken: anyUser.whatsapp_api_token,
      groupId: anyUser.whatsapp_group_id,
    }
  }

  // Fallback 2: any user with WhatsApp credentials (even if toggle is off)
  const { data: anyConfig } = await db
    .from('user_settings')
    .select('whatsapp_instance_id, whatsapp_api_token, whatsapp_group_id')
    .not('whatsapp_api_token', 'is', null)
    .not('whatsapp_instance_id', 'is', null)
    .limit(1)
    .maybeSingle()

  if (anyConfig?.whatsapp_instance_id && anyConfig?.whatsapp_api_token) {
    console.warn('[whatsapp] Config found but whatsapp_enabled is OFF — sending anyway from cron context')
    return {
      apiUrl: 'https://7107.api.greenapi.com',
      instanceId: anyConfig.whatsapp_instance_id,
      apiToken: anyConfig.whatsapp_api_token,
      groupId: anyConfig.whatsapp_group_id,
    }
  }

  // Fallback 3: environment variables
  const instanceId = process.env.GREEN_API_INSTANCE_ID
  const apiToken = process.env.GREEN_API_TOKEN
  if (instanceId && apiToken) {
    console.log('[whatsapp] Config loaded from env vars')
    return {
      apiUrl: process.env.GREEN_API_URL || 'https://7107.api.greenapi.com',
      instanceId, apiToken,
      groupId: process.env.GREEN_API_GROUP_ID,
    }
  }

  console.error('[whatsapp] NO CONFIG FOUND — checked: user_settings (enabled), user_settings (any), env vars. All empty.')
  return null
}

async function greenApiCall(config: WhatsAppConfig, method: string, body?: Record<string, unknown>) {
  const url = `${config.apiUrl}/waInstance${config.instanceId}/${method}/${config.apiToken}`
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => 'no body')
    console.error(`[whatsapp] greenApiCall ${method} HTTP ${res.status}:`, text)
    throw new Error(`Green API ${method} failed: HTTP ${res.status}`)
  }
  return res.json()
}

// ─── Core Send Functions ────────────────────────────────────────────────────

export async function sendMessage(chatId: string, message: string, userId?: string): Promise<boolean> {
  const config = await getConfig(userId)
  if (!config) {
    console.error('[whatsapp] sendMessage SKIPPED: no config available')
    return false
  }
  return sendWithConfig(config, chatId, message)
}

async function sendWithConfig(config: WhatsAppConfig, chatId: string, message: string): Promise<boolean> {
  try {
    const result = await greenApiCall(config, 'sendMessage', { chatId, message })
    if (result.idMessage) return true
    console.error('[whatsapp] sendMessage: no idMessage in response:', JSON.stringify(result).slice(0, 200))
    return false
  } catch (err) {
    console.error('[whatsapp] sendMessage error:', err)
    return false
  }
}

export async function sendGroupMessage(message: string, userId?: string): Promise<boolean> {
  const config = await getConfig(userId)
  if (!config) {
    console.error('[whatsapp] sendGroupMessage SKIPPED: no config')
    return false
  }
  if (!config.groupId) {
    console.error('[whatsapp] sendGroupMessage SKIPPED: no groupId set')
    return false
  }
  return sendWithConfig(config, config.groupId, message)
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
  if (!Number.isFinite(n)) return '?'
  if (Math.abs(n) >= 10000) return n.toLocaleString('en', { maximumFractionDigits: 0 })
  if (Math.abs(n) >= 1)     return n.toFixed(2)
  if (Math.abs(n) >= 0.01)  return n.toFixed(4)
  return n.toFixed(6)
}

function fInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('en')
}

function fSigned(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return (n >= 0 ? '+' : '') + f(n)
}

function fPct(n: number | null | undefined, decimals = 1): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return (n >= 0 ? '+' : '') + n.toFixed(decimals) + '%'
}

function dubaiNow(): string {
  return new Date().toLocaleString('en-GB', {
    timeZone: 'Asia/Dubai', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function dubaiTime(): string {
  return new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hour12: false })
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. SIGNAL ALERT — New AI signal generated
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifySignal(signal: Signal, userId?: string) {
  const dir = signal.direction.toUpperCase()
  const rr = signal.risk_reward ? `R:R ${Number(signal.risk_reward).toFixed(2)}x` : ''
  const slDist = signal.entry_price && signal.stop_loss
    ? Math.abs((signal.entry_price - signal.stop_loss) / signal.entry_price) * 100
    : null
  const tpDist = signal.entry_price && signal.take_profit_1
    ? Math.abs((signal.take_profit_1 - signal.entry_price) / signal.entry_price) * 100
    : null

  const lines = [
    `*Signal — ${dir} ${signal.instrument}*`,
    `Entry $${f(signal.entry_price ?? 0)}`,
    `SL    $${f(signal.stop_loss ?? 0)}${slDist != null ? ` (-${slDist.toFixed(2)}%)` : ''}`,
    `TP    $${f(signal.take_profit_1 ?? 0)}${tpDist != null ? ` (+${tpDist.toFixed(2)}%)` : ''}`,
    `Conf ${signal.confidence}%   ${rr}`.trim(),
  ]
  if (signal.reasoning) lines.push(`Why: ${signal.reasoning.slice(0, 180)}`)
  lines.push(`${dubaiTime()} GST`)

  return sendGroupMessage(lines.join('\n'), userId)
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
  const verdict = data.execute ? 'Execute' : 'Rejected'

  const lines = [
    `*War room ${verdict} — ${data.instrument}*`,
    `Vote ${data.votesFor} for / ${data.votesAgainst} against`,
  ]

  if (data.trigger)            lines.push(`Trigger ${data.trigger}`)
  if (data.backtestWins !== undefined) lines.push(`Backtest ${data.backtestWins}W / ${data.backtestLosses}L`)
  if (data.kelly)              lines.push(`Kelly ${(data.kelly * 100).toFixed(1)}%`)

  if (data.execute && data.entry) {
    lines.push(`${data.direction?.toUpperCase()} @ $${f(data.entry)}   SL $${f(data.sl ?? 0)}   TP $${f(data.tp ?? 0)}   R:R ${data.rr?.toFixed(2) ?? '?'}x`)
  }

  if (data.decision) lines.push(`Note: ${data.decision.slice(0, 200)}`)
  lines.push(`${dubaiTime()} GST`)

  return sendGroupMessage(lines.join('\n'), userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2b. WAR ROOM — Meeting opened (trigger detected)
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyWarRoomOpen(data: {
  instrument: string; price: number; trigger: string; direction: string;
  rsi: number; atr: number; volumeRatio: number; triggerCount: number;
}, userId?: string) {
  const lines = [
    `*Meeting — ${data.instrument}*`,
    `${data.direction.toUpperCase()} @ $${f(data.price)}`,
    `Trigger ${data.trigger}${data.triggerCount > 1 ? ` (×${data.triggerCount})` : ''}`,
    `RSI ${data.rsi.toFixed(0)}   ATR ${data.atr.toFixed(2)}   Vol ${data.volumeRatio.toFixed(1)}x`,
    `12 agents debating, verdict soon`,
    `${dubaiTime()} GST`,
  ]
  return sendGroupMessage(lines.join('\n'), userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2c. WAR ROOM — Live debate summary (agents talking)
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyWarRoomDebate(data: {
  instrument: string;
  agents: { name: string; stance: 'bullish' | 'bearish' | 'neutral'; summary: string }[];
}, userId?: string) {
  const bullish = data.agents.filter(a => a.stance === 'bullish').length
  const bearish = data.agents.filter(a => a.stance === 'bearish').length
  const neutral = data.agents.filter(a => a.stance === 'neutral').length

  const lines = [
    `*Debate — ${data.instrument}*`,
    `Tally ${bullish} bullish / ${bearish} bearish / ${neutral} neutral`,
  ]
  for (const a of data.agents) {
    if (a.stance === 'neutral') continue
    const tag = a.stance === 'bullish' ? 'BULL' : 'BEAR'
    lines.push(`[${tag}] ${a.name}: ${a.summary.slice(0, 110)}`)
  }
  lines.push(`Orchestrator deciding · ${dubaiTime()} GST`)
  return sendGroupMessage(lines.join('\n'), userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2d. WAR ROOM — Blocked by risk rules
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyWarRoomBlocked(data: {
  instrument: string; reason: string; blocker: string;
}, userId?: string) {
  const lines = [
    `*Blocked — ${data.instrument}*`,
    `Blocker: ${data.blocker}`,
    `Reason: ${data.reason.slice(0, 220)}`,
    `${dubaiTime()} GST`,
  ]
  return sendGroupMessage(lines.join('\n'), userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2e. WAR ROOM — Quick scan summary (periodic)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @deprecated Replaced by notifyPeriodicReport sent on a 2h cron schedule.
 * Kept as a no-op stub so existing imports don't break during deploy.
 * Will be removed in a future commit.
 */
export async function notifyWarRoomScan(_data: {
  totalScanned: number; triggersFound: number;
  instruments: { symbol: string; status: string }[];
  budgetSpent?: number; budgetRemaining?: number;
}, _userId?: string): Promise<boolean> {
  return false
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. TRADE OPENED
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyTradeOpened(trade: {
  instrument: string; direction: string; entry_price: number;
  quantity: number; stop_loss?: number; take_profit?: number;
  isReal?: boolean; orderId?: string;
}, userId?: string) {
  const notional = trade.quantity * trade.entry_price
  const tag = trade.isReal === false ? 'PAPER' : 'REAL'
  const slDist = trade.stop_loss
    ? Math.abs((trade.entry_price - trade.stop_loss) / trade.entry_price) * 100
    : null
  const tpDist = trade.take_profit
    ? Math.abs((trade.take_profit - trade.entry_price) / trade.entry_price) * 100
    : null

  const lines = [
    `*Trade opened [${tag}] — ${trade.instrument}*`,
    `${trade.direction.toUpperCase()} @ $${f(trade.entry_price)}`,
    `Size ${trade.quantity.toFixed(6)} (~$${notional.toFixed(0)})`,
    `SL $${f(trade.stop_loss ?? 0)}${slDist != null ? ` (-${slDist.toFixed(2)}%)` : ''}`,
    `TP $${f(trade.take_profit ?? 0)}${tpDist != null ? ` (+${tpDist.toFixed(2)}%)` : ''}`,
  ]
  if (trade.orderId) lines.push(`Order ${trade.orderId}`)
  lines.push(`${dubaiTime()} GST`)

  return sendGroupMessage(lines.join('\n'), userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. TRADE CLOSED — SL/TP hit or manual
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyTradeClosed(trade: {
  instrument: string; direction: string; entry_price: number;
  exit_price: number; pnl: number; pnl_pct: number;
  reason: string;
  isReal?: boolean; durationMs?: number;
}, userId?: string) {
  const label = trade.reason === 'take_profit' ? 'Take profit'
              : trade.reason === 'stop_loss'   ? 'Stop loss'
              :                                  'Closed'
  const tag = trade.isReal === false ? 'PAPER' : 'REAL'

  const lines = [
    `*${label} [${tag}] — ${trade.instrument}*`,
    `${trade.direction.toUpperCase()}  $${f(trade.entry_price)} → $${f(trade.exit_price)}`,
    `P&L ${fSigned(trade.pnl)} (${fPct(trade.pnl_pct, 2)})`,
  ]
  if (trade.durationMs && trade.durationMs > 0) {
    const mins = Math.round(trade.durationMs / 60000)
    const dur = mins < 60 ? `${mins}m` : `${(mins / 60).toFixed(1)}h`
    lines.push(`Held ${dur}`)
  }
  lines.push(`${dubaiTime()} GST`)
  return sendGroupMessage(lines.join('\n'), userId)
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
  const label = event === 'take_profit' ? 'Take profit'
              : event === 'stop_loss'   ? 'Stop loss'
              :                           'Position closed'

  const lines = [
    `*${label} — ${instrument}*`,
    `P&L ${fSigned(pnl)} (${fPct(pnlPct, 2)})`,
    `${dubaiTime()} GST`,
  ]
  return sendGroupMessage(lines.join('\n'), userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. MORNING BRIEFING — Sent at market open
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyMorningBriefing(portfolio: {
  capital: number; totalPnl: number; openPositions: number;
}, topSignals: Signal[], userId?: string) {
  const date = new Date().toLocaleDateString('en-GB', {
    timeZone: 'Asia/Dubai', weekday: 'short', day: '2-digit', month: 'short',
  })

  const sigLines = topSignals.slice(0, 3).map(s =>
    `  ${s.instrument} ${s.direction.toUpperCase()} (conf ${s.confidence}%)`
  ).join('\n')

  const msg = `*Morning briefing — ${date}*
Capital $${portfolio.capital.toLocaleString()}   P&L ${fSigned(portfolio.totalPnl)}   Open ${portfolio.openPositions}
Top signals:
${sigLines || '  None — markets quiet'}`

  return sendGroupMessage(msg, userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. DAILY REPORT — End of day summary
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyDailySummary(summary: {
  total_trades: number; wins: number; losses: number;
  daily_pnl: number; capital: number; win_rate: number;
}, userId?: string) {
  const date = new Date().toLocaleDateString('en-GB', {
    timeZone: 'Asia/Dubai', weekday: 'short', day: '2-digit', month: 'short',
  })

  const msg = `*Daily report — ${date}*
Trades ${summary.total_trades} (${summary.wins}W / ${summary.losses}L)   Win rate ${summary.win_rate.toFixed(1)}%
Daily P&L ${fSigned(summary.daily_pnl)}
Capital $${summary.capital.toLocaleString()}`

  return sendGroupMessage(msg, userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. KILL SWITCH ALERT
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyKillSwitch(activated: boolean, reason?: string, userId?: string) {
  if (activated) {
    const lines = [
      `*Kill switch ACTIVATED*`,
      `All trading halted for 24h.`,
    ]
    if (reason) lines.push(`Reason: ${reason}`)
    lines.push(`Deactivate manually in Settings.`)
    return sendGroupMessage(lines.join('\n'), userId)
  }
  return sendGroupMessage(`*Kill switch deactivated* — trading resumed.`, userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. DEMO SESSION REPORT
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyDemoReport(session: DemoSession, userId?: string) {
  const pnl = session.total_pnl ?? 0
  const pct = session.total_pnl_pct ?? 0
  const final = session.final_capital ?? session.initial_capital

  const lines = [
    `*Demo results*   ${session.start_date} → ${session.end_date}`,
    `Capital $${session.initial_capital.toLocaleString()} → $${final.toLocaleString()}   P&L ${fSigned(pnl)} (${fPct(pct, 2)})`,
    `Trades ${session.total_trades} (${session.win_count}W / ${session.loss_count}L)`,
  ]
  if (session.sharpe_ratio) lines.push(`Sharpe ${session.sharpe_ratio.toFixed(2)}`)
  if (session.max_drawdown) lines.push(`Max DD ${(session.max_drawdown * 100).toFixed(1)}%`)

  return sendGroupMessage(lines.join('\n'), userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. PROFIT ALLOCATION — Reinvest/payout/reserve split
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyProfitAllocation(alloc: {
  totalProfit: number; reinvestPct: number; payoutPct: number; reservePct: number;
  reinvestAmt: number; payoutAmt: number; reserveAmt: number;
  payoutReady: boolean; reason: string;
}, userId?: string) {
  const lines = [
    `*Profit allocation*`,
    `Total profit $${alloc.totalProfit.toFixed(0)}`,
    `Reinvest ${alloc.reinvestPct}% ($${alloc.reinvestAmt.toFixed(0)})`,
    `Payout   ${alloc.payoutPct}% ($${alloc.payoutAmt.toFixed(0)})`,
    `Reserve  ${alloc.reservePct}% ($${alloc.reserveAmt.toFixed(0)})`,
    alloc.payoutReady ? `Payout ready.` : `Building capital.`,
    `Note: ${alloc.reason.slice(0, 200)}`,
  ]
  return sendGroupMessage(lines.join('\n'), userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 11. RISK ALERT — Drawdown/loss limit warning
// ═══════════════════════════════════════════════════════════════════════════════

export async function notifyRiskAlert(data: {
  type: 'drawdown' | 'daily_loss' | 'max_positions';
  current: number; limit: number; detail: string;
}, userId?: string) {
  const labels = {
    drawdown:      'Drawdown warning',
    daily_loss:    'Daily loss warning',
    max_positions: 'Max positions reached',
  }

  const lines = [
    `*${labels[data.type]}*`,
    `Current ${data.current.toFixed(1)}%   Limit ${data.limit.toFixed(1)}%`,
    `${data.detail}`,
  ]
  return sendGroupMessage(lines.join('\n'), userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 13. PERIODIC STATUS REPORT — every 2h on the hour, replaces 15-min scan blasts
// ═══════════════════════════════════════════════════════════════════════════════

export interface PeriodicReport {
  // Portfolio (paper / dashboard)
  portfolio: {
    capital: number
    realizedPnl?: number
    winCount: number
    lossCount: number
    dailyPnl?: number
  } | null
  // Real money state
  realMoney: {
    spotUsdt: number | null     // null = couldn't fetch
    fundingUsdt?: number | null
    earnUsdt?: number | null
    tradingMode: string         // 'live' | 'demo'
    autoTradeEnabled: boolean
  }
  // Last-2h activity
  activity: {
    meetingsHeld: number
    triggersFound: number
    decisionsExecuted: number
    decisionsRejected: number
    blockedByRisk: number
    macroPauses: number
    realTradesOpened: number
    realTradesClosed: number
    realPnl2h: number
  }
  // Open positions (real)
  openPositions: Array<{
    instrument: string
    direction: string
    entryPrice: number
    currentPrice: number
    unrealizedPnl: number
    unrealizedPnlPct: number
  }>
  // Market snapshot (active instruments)
  markets: Array<{
    instrument: string
    price: number
    change24h: number | null   // pct
    rsi: number | null
    regime: string | null      // 'trending' | 'ranging' | etc.
    rangeStrength: number | null
  }>
  // Macro state
  macro: {
    paused: boolean
    nextEvent: string | null
    minutesUntil: number | null
  }
  // Daily-loss budget
  dailyLossBudget: {
    consumed: number   // negative = loss
    limit: number      // negative
    pctUsed: number    // 0..100
  } | null
  // Spend
  budget?: { spent: number; remaining: number }
  // Pending high-conviction triggers (queued / cooldown / blocked)
  notableTriggers: Array<{ instrument: string; status: string }>
}

export async function notifyPeriodicReport(data: PeriodicReport, userId?: string): Promise<boolean> {
  const lines: string[] = []
  lines.push(`*Status — ${dubaiNow()} GST*`)

  // Portfolio (paper)
  if (data.portfolio) {
    const wl = `${data.portfolio.winCount}W / ${data.portfolio.lossCount}L`
    const total = data.portfolio.winCount + data.portfolio.lossCount
    const wr = total > 0 ? ((data.portfolio.winCount / total) * 100).toFixed(0) + '%' : '—'
    lines.push(`Portfolio (paper) $${fInt(data.portfolio.capital)}   ${wl} (${wr})`)
    if (data.portfolio.dailyPnl != null) {
      lines.push(`  Daily P&L ${fSigned(data.portfolio.dailyPnl)}`)
    }
  }

  // Real money
  const rm = data.realMoney
  lines.push(`Real money (Binance)`)
  lines.push(`  Spot ${rm.spotUsdt == null ? '—' : '$' + fInt(rm.spotUsdt)}` +
    (rm.fundingUsdt != null ? `   Funding $${fInt(rm.fundingUsdt)}` : '') +
    (rm.earnUsdt != null    ? `   Earn $${fInt(rm.earnUsdt)}` : ''))
  const total = (rm.spotUsdt ?? 0) + (rm.fundingUsdt ?? 0) + (rm.earnUsdt ?? 0)
  if (total > 0) lines.push(`  Total $${fInt(total)}`)
  lines.push(`  Mode ${rm.tradingMode}, auto-trade ${rm.autoTradeEnabled ? 'on' : 'off'}`)

  // Activity (last 2h)
  const a = data.activity
  lines.push(`Last 2h`)
  lines.push(`  Meetings ${a.meetingsHeld}, triggers ${a.triggersFound}, decisions ${a.decisionsExecuted} exec / ${a.decisionsRejected} rej`)
  if (a.blockedByRisk > 0 || a.macroPauses > 0) {
    const parts: string[] = []
    if (a.blockedByRisk > 0) parts.push(`risk-blocked ${a.blockedByRisk}`)
    if (a.macroPauses > 0)   parts.push(`macro-paused ${a.macroPauses}`)
    lines.push(`  ${parts.join(', ')}`)
  }
  if (a.realTradesOpened + a.realTradesClosed > 0) {
    lines.push(`  Real trades ${a.realTradesOpened} opened / ${a.realTradesClosed} closed, P&L ${fSigned(a.realPnl2h)}`)
  }

  // Open positions
  if (data.openPositions.length > 0) {
    lines.push(`Open positions (real)`)
    for (const p of data.openPositions) {
      lines.push(`  ${p.instrument} ${p.direction.toUpperCase()}  $${f(p.entryPrice)} → $${f(p.currentPrice)}   P&L ${fSigned(p.unrealizedPnl)} (${fPct(p.unrealizedPnlPct, 2)})`)
    }
  }

  // Markets
  if (data.markets.length > 0) {
    lines.push(`Markets`)
    for (const m of data.markets) {
      const chg = m.change24h != null ? fPct(m.change24h, 1) : '—'
      const rsi = m.rsi != null ? `RSI ${m.rsi.toFixed(0)}` : ''
      const reg = m.regime ? `${m.regime}${m.rangeStrength != null ? `:${m.rangeStrength.toFixed(1)}` : ''}` : ''
      lines.push(`  ${m.instrument.padEnd(9)} $${f(m.price).padEnd(9)} ${chg.padStart(7)}  ${rsi}  ${reg}`.trimEnd())
    }
  }

  // Notable triggers
  if (data.notableTriggers.length > 0) {
    lines.push(`Notable triggers`)
    for (const t of data.notableTriggers.slice(0, 6)) {
      lines.push(`  ${t.instrument} — ${t.status}`)
    }
  }

  // Macro pause
  if (data.macro.paused && data.macro.nextEvent) {
    lines.push(`Macro pause: ${data.macro.nextEvent} in ${data.macro.minutesUntil ?? '?'}min`)
  }

  // Daily-loss budget
  if (data.dailyLossBudget) {
    const b = data.dailyLossBudget
    lines.push(`Daily loss budget ${fSigned(b.consumed)} / ${fSigned(b.limit)} (${b.pctUsed.toFixed(0)}% used)`)
  }

  // API spend
  if (data.budget) {
    lines.push(`AI spend today $${data.budget.spent.toFixed(2)} of $${(data.budget.spent + data.budget.remaining).toFixed(2)}`)
  }

  return sendGroupMessage(lines.join('\n'), userId)
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
  const lines = [
    `*Weekly report*`,
    `Trades ${data.totalTrades} (${data.wins}W / ${data.losses}L)   Win rate ${data.winRate.toFixed(1)}%`,
    `Weekly P&L ${fSigned(data.weeklyPnl)}   Capital $${data.capital.toLocaleString()}`,
  ]
  if (data.sharpe) lines.push(`Sharpe ${data.sharpe.toFixed(2)}`)
  lines.push(`Best:  ${data.bestTrade}`)
  lines.push(`Worst: ${data.worstTrade}`)

  return sendGroupMessage(lines.join('\n'), userId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 16. SELF-AUDIT REPORT — system health + activity since last audit
// ═══════════════════════════════════════════════════════════════════════════════

export interface SelfAuditPayload {
  windowHours: number
  // Health checks (each should be 0 if everything's fine)
  health: {
    dataQualityFails: number
    modelErrors: number
    falseLossStreakPauses: number
    // Added 2026-05-14 after the silent CHECK-constraint outage that
    // killed ~13h of XAU execution. Any signal stuck pending >10min means
    // the inbound→IG path is broken end-to-end.
    stuckPendingExternal: number
  }
  // Rotation activity
  activity: {
    closes: number
    meetingsOpened: number
    decisionsExecuted: number
    decisionsRejected: number
    signalsGenerated: number
    realTradesOpened: number
    realTradesClosed: number
    demoTradesOpened: number
    demoTradesClosed: number
    realPnl: number
    demoPnl: number
  }
  closesByReason: Array<{ reason: string; count: number }>
  // Per-instrument freshness — flag any instrument whose newest candle is older
  // than its expected staleness budget (varies by asset class).
  staleInstruments: Array<{ instrument: string; ageMin: number }>
  verdict: 'healthy' | 'warning' | 'critical'
  notes: string[]
}

export async function notifySelfAudit(data: SelfAuditPayload, userId?: string) {
  const h = data.health
  const a = data.activity
  const totalHealthIssues =
    h.dataQualityFails + h.modelErrors + h.falseLossStreakPauses + (h.stuckPendingExternal ?? 0)

  const verdictTag = data.verdict === 'healthy' ? 'HEALTHY'
                   : data.verdict === 'warning' ? 'WARNING'
                   : 'CRITICAL'

  const lines: string[] = [
    `*APEX self-audit — last ${data.windowHours}h*`,
    `Verdict: ${verdictTag}`,
  ]

  // Health block
  lines.push(``)
  lines.push(`Health checks:`)
  lines.push(`  data-quality fails:      ${h.dataQualityFails}`)
  lines.push(`  AI model errors (404):   ${h.modelErrors}`)
  lines.push(`  false loss-streak pauses: ${h.falseLossStreakPauses}`)
  lines.push(`  external signals stuck:  ${h.stuckPendingExternal ?? 0}`)
  if (totalHealthIssues === 0) lines.push(`  → all green`)

  // Activity block
  lines.push(``)
  lines.push(`Activity:`)
  lines.push(`  rotation closes:    ${a.closes}`)
  lines.push(`  meetings opened:    ${a.meetingsOpened}`)
  lines.push(`  signals generated:  ${a.signalsGenerated}`)
  lines.push(`  live trades:        ${a.realTradesOpened} opened / ${a.realTradesClosed} closed   P&L ${fSigned(a.realPnl)}`)
  lines.push(`  demo trades:        ${a.demoTradesOpened} opened / ${a.demoTradesClosed} closed   P&L ${fSigned(a.demoPnl)}`)
  if (a.decisionsExecuted + a.decisionsRejected > 0) {
    lines.push(`  decisions:          ${a.decisionsExecuted} executed / ${a.decisionsRejected} rejected`)
  }

  // Closes-by-reason block (top 5)
  if (data.closesByReason.length > 0) {
    lines.push(``)
    lines.push(`Why most meetings closed:`)
    for (const r of data.closesByReason.slice(0, 5)) {
      lines.push(`  ${r.reason.padEnd(24)} ${r.count}`)
    }
  }

  // Stale-data warnings
  if (data.staleInstruments.length > 0) {
    lines.push(``)
    lines.push(`Stale candles:`)
    for (const s of data.staleInstruments.slice(0, 6)) {
      lines.push(`  ${s.instrument.padEnd(10)} ${Math.round(s.ageMin)}min old`)
    }
  }

  // Notes
  if (data.notes.length > 0) {
    lines.push(``)
    for (const n of data.notes) lines.push(n)
  }

  lines.push(``)
  lines.push(`${dubaiTime()} GST`)

  return sendGroupMessage(lines.join('\n'), userId)
}
