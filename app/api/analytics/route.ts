import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const db = createServiceSupabase()
  const sp = req.nextUrl.searchParams
  const instrument = sp.get('instrument')
  const from = sp.get('from')
  const to = sp.get('to')
  const limit = parseInt(sp.get('limit') ?? '100')

  let query = db.from('trade_analytics').select('*, demo_trades!inner(instrument, direction, pnl, pnl_pct, entry_price, exit_price, entry_time, exit_time, confidence, signal_reason)')
    .order('computed_at', { ascending: false }).limit(limit)

  if (instrument) query = query.eq('instrument', instrument)
  if (from) query = query.gte('computed_at', `${from}T00:00:00`)
  if (to) query = query.lte('computed_at', `${to}T23:59:59`)

  const { data, error } = await query

  if (error) {
    const fallbackQuery = db.from('trade_analytics').select('*')
      .order('computed_at', { ascending: false }).limit(limit)
    const { data: fallback } = instrument
      ? await fallbackQuery.eq('instrument', instrument)
      : await fallbackQuery
    return NextResponse.json({ data: fallback ?? [], success: true })
  }

  const records = data ?? []
  const mfes = records.map(r => +r.mfe_pct).filter(v => !isNaN(v))
  const maes = records.map(r => +r.mae_pct).filter(v => !isNaN(v))
  const exitEffs = records.map(r => +r.exit_efficiency_pct).filter(v => !isNaN(v))
  const rVals = records.map(r => +r.r_value).filter(v => !isNaN(v))
  const avg = (a: number[]) => a.length > 0 ? a.reduce((s, v) => s + v, 0) / a.length : 0

  return NextResponse.json({
    data: records,
    summary: {
      total: records.length,
      avg_mfe_pct: avg(mfes).toFixed(2),
      avg_mae_pct: avg(maes).toFixed(2),
      avg_exit_efficiency: avg(exitEffs).toFixed(1),
      avg_r_value: avg(rVals).toFixed(2),
    },
    success: true,
  })
}
