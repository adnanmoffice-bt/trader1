import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { ExchangeManager, getPrimaryExchange } from '@/lib/exchanges'
import { sendPositionAlert } from '@/lib/telegram'
import { notifyPositionAlert as waPositionAlert } from '@/lib/whatsapp'

export const runtime = 'nodejs'
export const maxDuration = 60

// Map APEX instrument → Binance base asset ticker.
// Most are literal (BTC/USD → BTC), but XAU/USD is tokenized as PAXG on Binance.
function getBaseAsset(instrument: string): string {
  const map: Record<string, string> = { 'XAU/USD': 'PAXG' }
  return map[instrument] ?? instrument.split('/')[0]
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const t0 = Date.now()
  const db = createServiceSupabase()
  const mgr = new ExchangeManager()
  const { data: positions } = await db.from('positions').select('*')
  if (!positions?.length) {
    await db.from('agent_logs').insert({
      agent: 'positions-cron',
      level: 'ok',
      message: 'tick complete · no open positions',
      metadata: { duration_ms: Date.now() - t0, positions_open: 0 },
    }).then(() => {})
    return NextResponse.json({ success: true, message: 'No open positions', timestamp: new Date().toISOString() })
  }

  const closed: string[] = []
  const updated: string[] = []
  const skipped: string[] = []

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

    const reason = hitSL ? 'stop_loss' : 'take_profit'

    // ─────────────────────────────────────────────────────────────────────────
    // EXCHANGE RECONCILIATION (only for real, non-demo positions)
    // ─────────────────────────────────────────────────────────────────────────
    // Before marking the DB as closed, verify the actual exchange state.
    // Three possible exchange states:
    //   (a) asset already sold (pre-placed SL/TP fired on Binance) → use cur as approx exit
    //   (b) asset still held   (pre-placed orders never fired)    → cancel open orders + force marketSell
    //   (c) exchange error                                         → skip this cycle, retry next run
    //
    // Demo positions skip this branch and close directly in DB as before.
    let exitPrice = cur
    let exchangeVerified = false
    let forcedClose = false

    if (!pos.is_demo) {
      try {
        const ex = getPrimaryExchange()
        if (!ex.isConfigured()) {
          await db.from('agent_logs').insert({
            agent: 'positions-cron', level: 'warn',
            message: `${pos.instrument}: close skipped — primary exchange not configured; cannot verify real position state`,
          })
          skipped.push(`${pos.instrument} (exchange not configured)`)
          continue
        }

        const balances = await ex.getBalances()
        const base = getBaseAsset(pos.instrument)
        const assetBal = balances.find(b => b.asset === base)
        const exchangeTotal = assetBal?.total ?? 0
        const exchangeFree = assetBal?.free ?? 0

        if (exchangeTotal >= qty * 0.9) {
          // (b) Full position still on exchange → pre-placed SL/TP did not fire.
          //     Cancel any leftover open orders + force marketSell.
          await ex.cancelAllOrders(pos.instrument).catch(() => { /* non-critical */ })
          const sellQty = Math.min(qty, exchangeFree)
          if (sellQty <= 0) {
            await db.from('agent_logs').insert({
              agent: 'positions-cron', level: 'warn',
              message: `${pos.instrument}: position flagged closed but balance is locked (free=${exchangeFree} total=${exchangeTotal}) — retry next cycle`,
            })
            skipped.push(`${pos.instrument} (balance locked)`)
            continue
          }
          const sellRes = await ex.marketSell(pos.instrument, sellQty).catch(() => null)
          if (!sellRes) {
            await db.from('agent_logs').insert({
              agent: 'positions-cron', level: 'error',
              message: `${pos.instrument}: force marketSell FAILED during reconciliation — retry next cycle. Manual check advised.`,
            })
            skipped.push(`${pos.instrument} (force sell failed)`)
            continue
          }
          exitPrice = sellRes.avgPrice
          forcedClose = true
          await db.from('agent_logs').insert({
            agent: 'positions-cron', level: 'ok',
            message: `${pos.instrument}: force-closed qty=${sellRes.executedQty.toFixed(6)} @ $${sellRes.avgPrice.toFixed(2)} (pre-placed ${reason.toUpperCase()} order had not fired)`,
          })
          exchangeVerified = true
        } else if (exchangeTotal < qty * 0.1) {
          // (a) Almost nothing left → pre-placed SL/TP already sold the asset.
          //     Clean up any stale open orders + close DB with current ticker as exit approximation.
          await ex.cancelAllOrders(pos.instrument).catch(() => { /* non-critical */ })
          exitPrice = cur
          exchangeVerified = true
        } else {
          // Weird partial state (e.g. 50% filled SL). Sell whatever is left.
          await ex.cancelAllOrders(pos.instrument).catch(() => { /* non-critical */ })
          const sellQty = Math.min(exchangeFree, qty)
          if (sellQty > 0) {
            const sellRes = await ex.marketSell(pos.instrument, sellQty).catch(() => null)
            if (sellRes) {
              exitPrice = sellRes.avgPrice
              forcedClose = true
              await db.from('agent_logs').insert({
                agent: 'positions-cron', level: 'warn',
                message: `${pos.instrument}: partial state — sold residual qty=${sellRes.executedQty.toFixed(6)} @ $${sellRes.avgPrice.toFixed(2)} (exchange had ${exchangeTotal} of expected ${qty})`,
              })
              exchangeVerified = true
            } else {
              skipped.push(`${pos.instrument} (partial sell failed)`)
              continue
            }
          } else {
            exitPrice = cur
            exchangeVerified = true
          }
        }
      } catch (e) {
        // Any unexpected exchange-API failure → do NOT close the DB yet.
        await db.from('agent_logs').insert({
          agent: 'positions-cron', level: 'error',
          message: `${pos.instrument}: exchange reconciliation threw — ${String(e).slice(0, 200)}. Skipping this cycle.`,
        })
        skipped.push(`${pos.instrument} (exception)`)
        continue
      }
    }

    const pnl = pos.direction === 'long'
      ? (exitPrice - entryPrice) * qty
      : (entryPrice - exitPrice) * qty
    const pnlPct = (pnl / (entryPrice * qty)) * 100
    const pnlAed = pnl

    // Update trade row (unchanged logic, just uses verified exitPrice now)
    const { error: tradeErr } = await db.from('trades')
      .update({
        status:     hitSL ? 'stopped' : 'closed',
        exit_price: exitPrice,
        pnl,
        pnl_pct:    pnlPct,
        pnl_aed:    pnlAed,
        closed_at:  new Date().toISOString(),
        notes:      forcedClose
          ? `Force-closed by positions cron (pre-placed ${reason.toUpperCase()} did not fire)`
          : undefined,
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
        exit_price: exitPrice,
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

    const suffix = pos.is_demo ? '[demo]' : exchangeVerified ? (forcedClose ? '[forced]' : '[verified]') : '[unverified]'
    closed.push(`${pos.instrument} ${reason} P&L: $${pnlAed.toFixed(0)} ${suffix}`)
  }

  await db.from('agent_logs').insert({
    agent: 'positions-cron',
    level: closed.length > 0 ? 'ok' : 'info',
    message: `tick complete · open=${positions.length} updated=${updated.length} closed=${closed.length} skipped=${skipped.length}`,
    metadata: {
      duration_ms: Date.now() - t0,
      positions_open: positions.length,
      positions_closed: closed.length,
      closed_summary: closed.slice(0, 5),
    },
  }).then(() => {})

  return NextResponse.json({
    success: true,
    updated: updated.length,
    closed,
    skipped,
    timestamp: new Date().toISOString(),
  })
}
