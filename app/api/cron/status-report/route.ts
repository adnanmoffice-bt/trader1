/**
 * /api/cron/status-report
 *
 * Runs every 2 hours. Builds a comprehensive APEX status report and sends it
 * to the WhatsApp group. Replaces the old per-15-min `notifyWarRoomScan` blasts
 * which were too noisy and shallow.
 *
 * Read-only; never opens trades or modifies user_settings. Safe to invoke
 * manually via curl with CRON_SECRET if you want a fresh report.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { notifyPeriodicReport } from '@/lib/whatsapp'
import { getPrimaryExchange } from '@/lib/exchanges'
import { getDailyBudgetStatus } from '@/lib/anthropic'
import { dubaiDayStartUTC } from '@/lib/safety'
import { computeIndicators, detectRegime } from '@/lib/indicators'
import type { OHLCV } from '@/types'

export const runtime = 'nodejs'
export const maxDuration = 60

const ACTIVE_INSTRUMENTS = [
  'BTC/USD', 'ETH/USD', 'XAU/USD',
  'DOGE/USD', 'AVAX/USD', 'LINK/USD',
  'ADA/USD', 'DOT/USD', 'MATIC/USD', 'NEAR/USD', 'APT/USD',
] as const

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceSupabase()
  const t0 = Date.now()
  const now = Date.now()
  const TWO_H_AGO = new Date(now - 2 * 3600_000).toISOString()
  const dayStartISO = dubaiDayStartUTC().toISOString()

  // Heartbeat
  await db.from('agent_logs').insert({ agent: 'status-report-cron', level: 'info', message: 'starting' }).then(() => {})

  // ── 1. Portfolio (paper / dashboard) ────────────────────────────────────────
  const { data: portfolioRow } = await db
    .from('portfolio')
    .select('capital, realized_pnl, win_count, loss_count, updated_at')
    .eq('is_demo', false)
    .maybeSingle()

  // Daily P&L from BOTH real trades and demo trades closed since Dubai midnight
  const { data: dayTrades } = await db
    .from('trades')
    .select('pnl')
    .gte('closed_at', dayStartISO)
    .eq('status', 'closed')
  const { data: dayDemo } = await db
    .from('demo_trades')
    .select('pnl')
    .not('exit_time', 'is', null)
    .gte('exit_time', dayStartISO)
  const dailyPnl = [
    ...(dayTrades ?? []).map(t => Number(t.pnl ?? 0)),
    ...(dayDemo ?? []).map(t => Number(t.pnl ?? 0)),
  ].reduce((s, x) => s + x, 0)

  // ── 2. Real money state ─────────────────────────────────────────────────────
  const { data: settingsRow } = await db
    .from('user_settings')
    .select('trading_mode, auto_trade_enabled')
    .limit(1)
    .maybeSingle()

  let spotUsdt: number | null = null
  let fundingUsdt: number | null = null
  let earnUsdt: number | null = null
  try {
    const ex = getPrimaryExchange()
    if (ex.isConfigured()) {
      const conn = await ex.testConnection()
      if (conn.success) spotUsdt = conn.quoteBalance ?? null
    }
  } catch (err) {
    console.warn('[status-report] testConnection failed:', err)
  }

  // Funding + Earn require direct Binance signed calls (not exposed by the
  // adapter). Best-effort, soft-fail.
  if (process.env.BINANCE_API_KEY && process.env.BINANCE_SECRET_KEY) {
    try {
      const [funding, earn] = await Promise.all([
        signedBinance('POST', '/sapi/v1/asset/get-funding-asset', { needBtcValuation: 'false' }),
        signedBinance('GET', '/sapi/v1/simple-earn/flexible/position', { asset: 'USDT' }),
      ])
      fundingUsdt = Number((funding || []).find((b: { asset: string; free: string }) => b.asset === 'USDT')?.free || 0)
      earnUsdt = Number((earn?.rows || []).find((r: { asset: string; totalAmount: string }) => r.asset === 'USDT')?.totalAmount || 0)
    } catch (err) {
      console.warn('[status-report] funding/earn fetch failed:', err)
    }
  }

  // ── 3. War-room activity (last 2h) ──────────────────────────────────────────
  const { data: wrMsgs } = await db
    .from('war_room_messages')
    .select('role, message, meeting_id, instrument')
    .gte('created_at', TWO_H_AGO)
  const meetingIds = new Set<string>()
  let triggersFound = 0
  let decisionsExecuted = 0
  let decisionsRejected = 0
  let blockedByRisk = 0
  let macroPauses = 0
  for (const m of wrMsgs ?? []) {
    if (m.meeting_id) meetingIds.add(m.meeting_id)
    if (m.role === 'open') triggersFound++
    if (m.role === 'decision') {
      const t = String(m.message ?? '').toUpperCase()
      if (t.includes('EXECUTE')) decisionsExecuted++
      else decisionsRejected++
    }
    if (m.role === 'close' && /BLOCKED/i.test(String(m.message ?? ''))) blockedByRisk++
    if (m.role === 'alert' && /MACRO|PAUSED.*event/i.test(String(m.message ?? ''))) macroPauses++
  }

  // Real trades opened / closed in last 2h
  const { data: realOpened } = await db.from('trades').select('id').eq('is_demo', false).gte('opened_at', TWO_H_AGO)
  const { data: realClosedRows } = await db.from('trades').select('pnl').eq('is_demo', false).gte('closed_at', TWO_H_AGO).eq('status', 'closed')
  const realTradesOpened = realOpened?.length ?? 0
  const realTradesClosed = realClosedRows?.length ?? 0
  const realPnl2h = (realClosedRows ?? []).reduce((s, t) => s + Number(t.pnl ?? 0), 0)

  // ── 4. Open positions (real) ────────────────────────────────────────────────
  const { data: openPosRows } = await db
    .from('positions')
    .select('instrument, direction, avg_entry_price, current_price, unrealized_pnl, unrealized_pnl_pct')
    .eq('is_demo', false)

  const openPositions = (openPosRows ?? []).map(p => ({
    instrument: p.instrument as string,
    direction: p.direction as string,
    entryPrice: Number(p.avg_entry_price ?? 0),
    currentPrice: Number(p.current_price ?? 0),
    unrealizedPnl: Number(p.unrealized_pnl ?? 0),
    unrealizedPnlPct: Number(p.unrealized_pnl_pct ?? 0),
  }))

  // ── 5. Market snapshot (RSI + regime per instrument) ────────────────────────
  const markets: Awaited<ReturnType<typeof buildMarketsForReport>> = await buildMarketsForReport(db)

  // ── 6. Macro state ──────────────────────────────────────────────────────────
  let macroPaused = false
  let nextEvent: string | null = null
  let minutesUntil: number | null = null
  const lastAlert = (wrMsgs ?? [])
    .filter(m => m.role === 'alert' && /WAR ROOM PAUSED.*event/i.test(String(m.message ?? '')))
    .map(m => String(m.message))
    .pop()
  if (lastAlert) {
    macroPaused = true
    const evMatch = lastAlert.match(/event\s+"([^"]+)"\s+in\s+(\d+)\s*min/i)
    if (evMatch) {
      nextEvent = evMatch[1]
      minutesUntil = Number(evMatch[2])
    }
  }

  // ── 7. Daily-loss budget ────────────────────────────────────────────────────
  const capital = Number(portfolioRow?.capital ?? 0)
  const limit = -Math.abs(capital * 0.05)
  const consumed = Math.min(0, dailyPnl)
  const pctUsed = limit < 0 ? Math.min(100, Math.abs(consumed / limit) * 100) : 0

  // ── 8. AI spend ─────────────────────────────────────────────────────────────
  const budgetStatus = await getDailyBudgetStatus().catch(() => null)

  // ── 9. Notable triggers (queued / cooldown / blocked) in last 2h ────────────
  const notableTriggers: { instrument: string; status: string }[] = []
  for (const m of wrMsgs ?? []) {
    if (m.role !== 'close') continue
    const t = String(m.message ?? '')
    // Only surface adjournments that mention an actual signal (not "no trigger")
    if (/(detected|Crossover|Spike|Breakout|Cross|Squeeze)/i.test(t) && !/null detected/i.test(t)) {
      notableTriggers.push({ instrument: String(m.instrument), status: t.slice(0, 110) })
      if (notableTriggers.length >= 8) break
    }
  }

  // ── Send ───────────────────────────────────────────────────────────────────
  const sent = await notifyPeriodicReport({
    portfolio: portfolioRow ? {
      capital: Number(portfolioRow.capital ?? 0),
      realizedPnl: Number(portfolioRow.realized_pnl ?? 0),
      winCount: Number(portfolioRow.win_count ?? 0),
      lossCount: Number(portfolioRow.loss_count ?? 0),
      dailyPnl,
    } : null,
    realMoney: {
      spotUsdt,
      fundingUsdt,
      earnUsdt,
      tradingMode: String(settingsRow?.trading_mode ?? 'demo'),
      autoTradeEnabled: Boolean(settingsRow?.auto_trade_enabled),
    },
    activity: {
      meetingsHeld: meetingIds.size,
      triggersFound,
      decisionsExecuted,
      decisionsRejected,
      blockedByRisk,
      macroPauses,
      realTradesOpened,
      realTradesClosed,
      realPnl2h,
    },
    openPositions,
    markets,
    macro: { paused: macroPaused, nextEvent, minutesUntil },
    dailyLossBudget: limit < 0 ? { consumed, limit, pctUsed } : null,
    budget: budgetStatus ? { spent: budgetStatus.spent, remaining: budgetStatus.remaining } : undefined,
    notableTriggers,
  })

  await db.from('agent_logs').insert({
    agent: 'status-report-cron',
    level: sent ? 'ok' : 'warn',
    message: `report ${sent ? 'sent' : 'NOT sent'} · meetings=${meetingIds.size} triggers=${triggersFound} executed=${decisionsExecuted} rejected=${decisionsRejected}`,
    metadata: {
      durationMs: Date.now() - t0,
      spotUsdt, fundingUsdt, earnUsdt,
      realTradesOpened, realTradesClosed, realPnl2h,
    },
  }).then(() => {})

  return NextResponse.json({
    success: true,
    sent,
    activity: {
      meetingsHeld: meetingIds.size,
      triggersFound, decisionsExecuted, decisionsRejected, blockedByRisk, macroPauses,
      realTradesOpened, realTradesClosed, realPnl2h,
    },
    duration_ms: Date.now() - t0,
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildMarketsForReport(
  db: ReturnType<typeof createServiceSupabase>,
): Promise<Array<{
  instrument: string
  price: number
  change24h: number | null
  rsi: number | null
  regime: string | null
  rangeStrength: number | null
}>> {
  const out: Array<{
    instrument: string; price: number; change24h: number | null;
    rsi: number | null; regime: string | null; rangeStrength: number | null
  }> = []

  for (const sym of ACTIVE_INSTRUMENTS) {
    try {
      const { data: candles } = await db
        .from('price_history')
        .select('timestamp, open, high, low, close, volume')
        .eq('symbol', sym)
        .order('timestamp', { ascending: false })
        .limit(120)
      if (!candles || candles.length < 30) {
        out.push({ instrument: sym, price: 0, change24h: null, rsi: null, regime: null, rangeStrength: null })
        continue
      }
      // Reverse to chronological order for indicator calc
      const ohlcv: OHLCV[] = candles.reverse().map(c => ({
        timestamp: new Date(c.timestamp as string).getTime(),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume),
      }))
      const last = ohlcv[ohlcv.length - 1]
      const ind = computeIndicators(ohlcv)
      const reg = detectRegime(ohlcv)
      const ago24h = ohlcv.length >= 25 ? ohlcv[ohlcv.length - 25].close : null
      const change24h = ago24h && ago24h > 0 ? ((last.close - ago24h) / ago24h) * 100 : null
      out.push({
        instrument: sym,
        price: last.close,
        change24h,
        rsi: ind.rsi,
        regime: reg.regime,
        rangeStrength: reg.strength,
      })
    } catch {
      out.push({ instrument: sym, price: 0, change24h: null, rsi: null, regime: null, rangeStrength: null })
    }
  }
  return out
}

// Minimal signed Binance helper (Funding + Earn position lookups).
async function signedBinance(method: 'GET' | 'POST', endpoint: string, extra: Record<string, string> = {}) {
  const crypto = await import('node:crypto')
  const API = process.env.BINANCE_API_KEY!
  const SECRET = process.env.BINANCE_SECRET_KEY!
  const BASE = 'https://api.binance.com'
  const params = new URLSearchParams({ timestamp: Date.now().toString(), recvWindow: '10000', ...extra })
  const qs = params.toString()
  const sig = crypto.createHmac('sha256', SECRET).update(qs).digest('hex')
  const url = `${BASE}${endpoint}?${qs}&signature=${sig}`
  const res = await fetch(url, { method, headers: { 'X-MBX-APIKEY': API } })
  if (!res.ok) throw new Error(`${endpoint} ${res.status}`)
  return res.json()
}
