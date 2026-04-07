import type { Signal, DemoSession } from '@/types'

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
      body:    JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: parseMode }),
    })
    if (!res.ok) {
      const err = await res.json()
      console.error('[Telegram] Error:', err)
    }
  } catch (e) {
    console.error('[Telegram] Network error:', e)
  }
}

function emoji(dir: string) {
  return dir === 'long' ? '🟢' : dir === 'short' ? '🔴' : '🟡'
}

function fmt(n: number | null, prefix = '$'): string {
  if (n === null) return '—'
  return n >= 1000
    ? `${prefix}${n.toLocaleString('en', { minimumFractionDigits: 2 })}`
    : `${prefix}${n.toFixed(2)}`
}

// ─── Signal Alert ─────────────────────────────────────────────────────────────

export async function sendSignalAlert(signal: Signal) {
  const e = emoji(signal.direction)
  const rr = signal.risk_reward ? `R:R ${signal.risk_reward}×` : ''

  const text = [
    `${e} <b>APEX SIGNAL — ${signal.instrument}</b>`,
    `Direction: <b>${signal.direction.toUpperCase()}</b>  |  Conf: <b>${signal.confidence}%</b>  ${rr}`,
    '',
    signal.direction !== 'hold'
      ? [
          `Entry:      <code>${fmt(signal.entry_price)}</code>`,
          `Stop Loss:  <code>${fmt(signal.stop_loss)}</code>`,
          `Target 1:   <code>${fmt(signal.take_profit_1)}</code>`,
          `Target 2:   <code>${fmt(signal.take_profit_2)}</code>`,
        ].join('\n')
      : '⏸  HOLD — waiting for clearer signal',
    '',
    `<i>${signal.reasoning}</i>`,
    '',
    `🤖 AI: ${signal.ai_analysis}`,
    '',
    `⏰ ${new Date().toLocaleTimeString('en', { timeZone: 'Asia/Dubai' })} UAE`,
  ].join('\n')

  await send(text)
}

// ─── Position Alert ───────────────────────────────────────────────────────────

export async function sendPositionAlert(
  instrument: string,
  event: 'take_profit' | 'stop_loss' | 'manual',
  pnl: number,
  pnlPct: number
) {
  const isProfit = event === 'take_profit'
  const icon     = isProfit ? '✅' : event === 'stop_loss' ? '🛑' : 'ℹ️'
  const label    = isProfit ? 'TAKE PROFIT HIT' : event === 'stop_loss' ? 'STOP LOSS HIT' : 'POSITION CLOSED'

  const text = [
    `${icon} <b>${label} — ${instrument}</b>`,
    '',
    `P&L: <b>${pnl >= 0 ? '+' : ''}AED ${Math.abs(pnl).toLocaleString()}</b>  (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`,
    `⏰ ${new Date().toLocaleTimeString('en', { timeZone: 'Asia/Dubai' })} UAE`,
  ].join('\n')

  await send(text)
}

// ─── Morning Briefing ─────────────────────────────────────────────────────────

export async function sendMorningBriefing(
  portfolio: { capital: number; totalPnl: number; openPositions: number },
  topSignals: Signal[]
) {
  const date = new Date().toLocaleDateString('en', {
    timeZone: 'Asia/Dubai', weekday: 'long', day: 'numeric', month: 'long',
  })

  const sigLines = topSignals.slice(0, 3).map(s =>
    `${emoji(s.direction)} ${s.instrument} ${s.direction.toUpperCase()} — Conf ${s.confidence}%`
  ).join('\n')

  const text = [
    `☀️ <b>APEX Morning Briefing — ${date}</b>`,
    '',
    `💼 Portfolio: AED ${portfolio.capital.toLocaleString()}`,
    `📈 Total P&L: ${portfolio.totalPnl >= 0 ? '+' : ''}AED ${portfolio.totalPnl.toLocaleString()}`,
    `🔓 Open positions: ${portfolio.openPositions}`,
    '',
    `🎯 Today's top signals:`,
    sigLines || 'No active signals yet',
    '',
    `Good trading day ahead! 🚀`,
  ].join('\n')

  await send(text)
}

// ─── Daily Report ─────────────────────────────────────────────────────────────

export async function sendDailyReport(
  wins: number,
  losses: number,
  netPnl: number,
  winRate: number
) {
  const text = [
    `📊 <b>APEX Daily Report</b>`,
    `${new Date().toLocaleDateString('en', { timeZone: 'Asia/Dubai' })}`,
    '',
    `Trades:   ${wins + losses} (${wins}W / ${losses}L)`,
    `Win Rate: ${winRate.toFixed(1)}%`,
    `Net P&L:  ${netPnl >= 0 ? '+' : ''}AED ${Math.abs(netPnl).toLocaleString()}`,
    '',
    netPnl >= 0 ? '✅ Profitable day!' : '📉 Rough day. Trust the process.',
  ].join('\n')

  await send(text)
}

// ─── Demo Session Report ──────────────────────────────────────────────────────

export async function sendDemoReport(session: DemoSession) {
  const pnl = session.total_pnl ?? 0
  const pct = session.total_pnl_pct ?? 0

  const text = [
    `🧪 <b>APEX 5-Day Demo Results</b>`,
    `${session.start_date} → ${session.end_date}`,
    '',
    `Capital:     AED ${session.initial_capital.toLocaleString()}`,
    `Final:       AED ${((session.final_capital) ?? session.initial_capital).toLocaleString()}`,
    `Total P&L:   ${pnl >= 0 ? '+' : ''}AED ${Math.abs(pnl).toLocaleString()} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`,
    '',
    `Trades:      ${session.total_trades} (${session.win_count}W / ${session.loss_count}L)`,
    `Win Rate:    ${((session.win_rate ?? 0) * 100).toFixed(1)}%`,
    session.sharpe_ratio  ? `Sharpe:      ${session.sharpe_ratio.toFixed(2)}` : '',
    session.max_drawdown  ? `Max DD:      ${(session.max_drawdown * 100).toFixed(1)}%` : '',
  ].filter(Boolean).join('\n')

  await send(text)
}

export async function sendBudgetAlert(message: string) {
  await send(message)
}
