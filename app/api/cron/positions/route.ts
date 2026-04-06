import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { ExchangeManager } from '@/lib/exchanges'
import { sendPositionAlert } from '@/lib/telegram'
import { notifyPositionAlert as waPositionAlert } from '@/lib/whatsapp'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceSupabase()
  const mgr = new ExchangeManager()
  const { data: positions } = await db.from('positions').select('*')
  if (!positions?.length) {
    return NextResponse.json({ success: true, message: 'No open positions', timestamp: new Date().toISOString() })
  }

  const closed: string[] = []
  const updated: string[] = []

  for (const pos of positions) {
    const ticker = await mgr.getBestTicker(pos.instrument)
    if (!ticker) continue

    const cur = ticker.price

    await db.from('positions')
      .update({ current_price: cur })
      .eq('id', pos.id)
    updated.push(pos.instrument)

    const hitSL = pos.stop_loss && (
      (pos.direction === 'long'  && cur <= Number(pos.stop_loss)) ||
      (pos.direction === 'short' && cur >= Number(pos.stop_loss))
    )
    const hitTP = pos.take_profit && (
      (pos.direction === 'long'  && cur >= Number(pos.take_profit)) ||
      (pos.direction === 'short' && cur <= Number(pos.take_profit))
    )

    if (!hitSL && !hitTP) continue

    const entryPrice = Number(pos.avg_entry_price)
    const qty = Number(pos.quantity)
    const pnl = pos.direction === 'long'
      ? (cur - entryPrice) * qty
      : (entryPrice - cur) * qty
    const pnlPct = (pnl / (entryPrice * qty)) * 100
    const pnlAed = pnl * 3.6725
    const reason = hitSL ? 'stop_loss' : 'take_profit'

    await db.from('positions').delete().eq('id', pos.id)

    await db.from('trades')
      .update({
        status:     hitSL ? 'stopped' : 'closed',
        exit_price: cur,
        pnl,
        pnl_pct:    pnlPct,
        pnl_aed:    pnlAed,
        closed_at:  new Date().toISOString(),
      })
      .eq('instrument', pos.instrument)
      .eq('status', 'open')

    try {
      await db.rpc('update_portfolio_on_close', {
        p_user_id: pos.user_id,
        p_pnl:     pnl,
        p_is_demo: pos.is_demo,
        p_won:     pnl > 0,
      })
    } catch { /* RPC may not exist yet */ }

    await sendPositionAlert(pos.instrument, reason, pnlAed, pnlPct).catch(() => {})
    await waPositionAlert(pos.instrument, reason, pnlAed, pnlPct).catch(() => {})

    closed.push(`${pos.instrument} ${reason} P&L: ${pnlAed.toFixed(0)} AED`)
  }

  return NextResponse.json({
    success: true,
    updated: updated.length,
    closed,
    timestamp: new Date().toISOString(),
  })
}
