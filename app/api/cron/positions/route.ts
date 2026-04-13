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
    if (!ticker) {
      console.warn(`[positions] No ticker for ${pos.instrument}, skipping`)
      continue
    }

    const cur = ticker.price

    const { error: updateErr } = await db.from('positions')
      .update({ current_price: cur })
      .eq('id', pos.id)
    if (updateErr) console.error(`[positions] Price update error for ${pos.instrument}:`, updateErr)
    updated.push(pos.instrument)

    // Trailing stop loss: lock in profits as position moves favorably
    const entryPrice = Number(pos.avg_entry_price)
    const atrEstimate = cur * 0.02
    const profitDist = pos.direction === 'long' ? cur - entryPrice : entryPrice - cur

    if (profitDist > atrEstimate * 2) {
      const newSl = pos.direction === 'long'
        ? cur - atrEstimate * 1.5
        : cur + atrEstimate * 1.5
      const currentSl = Number(pos.stop_loss)
      const shouldTrail = pos.direction === 'long' ? newSl > currentSl : newSl < currentSl
      if (shouldTrail) {
        await db.from('positions').update({ stop_loss: newSl }).eq('id', pos.id)
        pos.stop_loss = newSl
      }
    } else if (profitDist > atrEstimate) {
      const currentSl = Number(pos.stop_loss)
      const shouldMove = pos.direction === 'long' ? entryPrice > currentSl : entryPrice < currentSl
      if (shouldMove) {
        await db.from('positions').update({ stop_loss: entryPrice }).eq('id', pos.id)
        pos.stop_loss = entryPrice
      }
    }

    const hitSL = pos.stop_loss && (
      (pos.direction === 'long'  && cur <= Number(pos.stop_loss)) ||
      (pos.direction === 'short' && cur >= Number(pos.stop_loss))
    )
    const hitTP = pos.take_profit && (
      (pos.direction === 'long'  && cur >= Number(pos.take_profit)) ||
      (pos.direction === 'short' && cur <= Number(pos.take_profit))
    )

    if (!hitSL && !hitTP) continue

    const qty = Number(pos.quantity)
    if (entryPrice <= 0 || qty <= 0) {
      console.error(`[positions] Invalid entry/qty for ${pos.instrument}: entry=${entryPrice} qty=${qty}`)
      continue
    }
    const pnl = pos.direction === 'long'
      ? (cur - entryPrice) * qty
      : (entryPrice - cur) * qty
    const pnlPct = (pnl / (entryPrice * qty)) * 100
    const pnlAed = pnl * 3.6725
    const reason = hitSL ? 'stop_loss' : 'take_profit'

    // CRITICAL: Update trade FIRST with proper user_id + is_demo filter, then delete position
    const { error: tradeErr } = await db.from('trades')
      .update({
        status:     hitSL ? 'stopped' : 'closed',
        exit_price: cur,
        pnl,
        pnl_pct:    pnlPct,
        pnl_aed:    pnlAed,
        closed_at:  new Date().toISOString(),
      })
      .eq('instrument', pos.instrument)
      .eq('user_id', pos.user_id)
      .eq('is_demo', pos.is_demo)
      .eq('status', 'open')

    if (tradeErr) {
      console.error(`[positions] Trade close error for ${pos.instrument}:`, tradeErr)
      continue
    }

    // Also close matching demo_trades
    await db.from('demo_trades')
      .update({
        exit_price: cur,
        exit_time: new Date().toISOString(),
        exit_reason: reason,
        pnl,
        pnl_pct: pnlPct,
        pnl_aed: pnlAed,
      })
      .eq('instrument', pos.instrument)
      .is('exit_time', null)

    const { error: delErr } = await db.from('positions').delete().eq('id', pos.id)
    if (delErr) console.error(`[positions] Position delete error for ${pos.instrument}:`, delErr)

    try {
      await db.rpc('update_portfolio_on_close', {
        p_user_id: pos.user_id,
        p_pnl:     pnl,
        p_is_demo: pos.is_demo,
        p_won:     pnl > 0,
      })
    } catch (rpcErr) {
      console.error(`[positions] Portfolio RPC error for ${pos.instrument}:`, rpcErr)
    }

    await sendPositionAlert(pos.instrument, reason, pnlAed, pnlPct).catch(e => console.error('[positions] Telegram error:', e))
    await waPositionAlert(pos.instrument, reason, pnlAed, pnlPct).catch(e => console.error('[positions] WhatsApp error:', e))

    closed.push(`${pos.instrument} ${reason} P&L: ${pnlAed.toFixed(0)} AED`)
  }

  return NextResponse.json({
    success: true,
    updated: updated.length,
    closed,
    timestamp: new Date().toISOString(),
  })
}
