import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const db = createServiceSupabase()
  const month = req.nextUrl.searchParams.get('month')

  let query = db.from('performance_snapshots')
    .select('date, daily_pnl, trade_count, win_count, loss_count, win_rate, equity')
    .order('date', { ascending: true })

  if (month) {
    query = query.gte('date', `${month}-01`).lt('date', `${month}-32`)
  } else {
    query = query.limit(90)
  }

  const { data } = await query

  return NextResponse.json({ data: data ?? [], success: true })
}
