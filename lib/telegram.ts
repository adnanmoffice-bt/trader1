import type { Signal, DemoSession } from '@/types'

// ─────────────────────────────────────────────────────────────────────────────
// Telegram notifier
// 2026-05-06: simplified for investor-readability. One headline per message,
// facts only, no flavour text. Keep it short — no decorative dividers, no
// "good trading day ahead" tail. Match the cleaner WhatsApp format.
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN   = process.env.TELEGRAM_BOT_TOKEN!
const CHAT_ID = process.env.TELEGRAM_CHAT_ID!
const BASE    = `https://api.telegram.org/bot${TOKEN}`

async function send(text: string, parseMode: 'HTML' | 'MarkdownV2' = 'HTML') {
  if (!TOKEN || !CHAT_ID) {
    console.warn('[Telegram] Missing TOKEN or CHAT_ID — skipping notification')
    return
  }
  try {
    const res = await fetch(`${BASE}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: parseMode, disable_web_page_preview: true }),
    })
    if (!res.ok) {
      const err = await res.json()
      console.error('[Telegram] Error:', err)
    }
  } catch (e) {
    console.error('[Telegram] Network error:', e)
  }
}

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1000) return n.toLocaleString('en', { maximumFractionDigits: 2 })
  if (Math.abs(n) >= 1)    return n.toFixed(2)
  return n.toFixed(4)
}

function pctSigned(n: number, digits = 2): string {
  return (n >= 0 ? '+' : '') + n.toFixed(digits) + '%'
}

function dubaiTime(): string {
  return new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hour12: false })
}

function dubaiDate(): string {
  return new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: '2-digit', month: 'short' })
}

// ─── Signal Alert ─────────────────────────────────────────────────────────────

export async function sendSignalAlert(signal: Signal) {
  const dir = signal.direction.toUpperCase()
  const slPct = signal.entry_price && signal.stop_loss
    ? Math.abs((signal.entry_price - signal.stop_loss) / signal.entry_price) * 100
    : null
  const tpPct = signal.entry_price && signal.take_profit_1
    ? Math.abs((signal.take_profit_1 - signal.entry_price) / signal.entry_price) * 100
    : null

  const lines: string[] = [`<b>Signal — ${dir} ${signal.instrument}</b>`]

  if (signal.direction !== 'hold' && signal.entry_price) {
    lines.push(`Entry ${fmt(signal.entry_price)}`)
    lines.push(`SL    ${fmt(signal.stop_loss)}${slPct != null ? ` (-${slPct.toFixed(2)}%)` : ''}`)
    lines.push(`TP    ${fmt(signal.take_profit_1)}${tpPct != null ? ` (+${tpPct.toFixed(2)}%)` : ''}`)
    const rrText = signal.risk_reward ? `R:R ${Number(signal.risk_reward).toFixed(2)}x` : ''
    lines.push(`Conf ${signal.confidence}%   ${rrText}`.trim())
  } else {
    lines.push('No trade — waiting for clearer setup')
  }

  lines.push(`${dubaiTime()} GST`)
  await send(lines.join('\n'))
}

// ─── Position Alert ───────────────────────────────────────────────────────────

export async function sendPositionAlert(
  instrument: string,
  event: 'take_profit' | 'stop_loss' | 'manual',
  pnl: number,
  pnlPct: number
) {
  const label = event === 'take_profit' ? 'Take profit'
              : event === 'stop_loss'   ? 'Stop loss'
              :                           'Closed'
  const pnlStr = (pnl >= 0 ? '+' : '−') + '$' + Math.abs(pnl).toLocaleString('en', { maximumFractionDigits: 0 })

  const lines = [
    `<b>${label} — ${instrument}</b>`,
    `P&L ${pnlStr} (${pctSigned(pnlPct)})`,
    `${dubaiTime()} GST`,
  ]
  await send(lines.join('\n'))
}

// ─── Morning Briefing ─────────────────────────────────────────────────────────

export async function sendMorningBriefing(
  portfolio: { capital: number; totalPnl: number; openPositions: number },
  topSignals: Signal[]
) {
  const sigLines = topSignals.slice(0, 3).map(s =>
    `${s.instrument} ${s.direction.toUpperCase()} (conf ${s.confidence}%)`
  )

  const pnl = (portfolio.totalPnl >= 0 ? '+' : '−') + '$' + Math.abs(portfolio.totalPnl).toLocaleString('en', { maximumFractionDigits: 0 })

  const lines = [
    `<b>Morning briefing — ${dubaiDate()}</b>`,
    `Capital $${portfolio.capital.toLocaleString('en', { maximumFractionDigits: 0 })}   P&L ${pnl}   Open ${portfolio.openPositions}`,
  ]
  if (sigLines.length) {
    lines.push('Top signals:')
    sigLines.forEach(s => lines.push(`  ${s}`))
  } else {
    lines.push('No active signals.')
  }

  await send(lines.join('\n'))
}

// ─── Daily Report ─────────────────────────────────────────────────────────────

export async function sendDailyReport(
  wins: number,
  losses: number,
  netPnl: number,
  winRate: number
) {
  const pnl = (netPnl >= 0 ? '+' : '−') + '$' + Math.abs(netPnl).toLocaleString('en', { maximumFractionDigits: 0 })

  const lines = [
    `<b>Daily report — ${dubaiDate()}</b>`,
    `Trades ${wins + losses} (${wins}W / ${losses}L)   Win rate ${winRate.toFixed(1)}%`,
    `P&L ${pnl}`,
  ]
  await send(lines.join('\n'))
}

// ─── Demo Session Report ──────────────────────────────────────────────────────

export async function sendDemoReport(session: DemoSession) {
  const pnl = session.total_pnl ?? 0
  const pct = session.total_pnl_pct ?? 0
  const final = session.final_capital ?? session.initial_capital
  const wr = (session.win_rate ?? 0) * 100

  const lines: string[] = [
    `<b>Demo results</b>   ${session.start_date} → ${session.end_date}`,
    `Capital $${session.initial_capital.toLocaleString()} → $${final.toLocaleString()}   P&L ${(pnl >= 0 ? '+' : '−') + '$' + Math.abs(pnl).toLocaleString('en', { maximumFractionDigits: 0 })} (${pctSigned(pct)})`,
    `Trades ${session.total_trades} (${session.win_count}W / ${session.loss_count}L)   Win rate ${wr.toFixed(1)}%`,
  ]
  if (session.sharpe_ratio) lines.push(`Sharpe ${session.sharpe_ratio.toFixed(2)}`)
  if (session.max_drawdown) lines.push(`Max DD ${(session.max_drawdown * 100).toFixed(1)}%`)

  await send(lines.join('\n'))
}

export async function sendBudgetAlert(message: string) {
  await send(message)
}
