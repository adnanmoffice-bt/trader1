import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const db     = createServiceSupabase()
  const params = req.nextUrl.searchParams
  const status = params.get('status') ?? 'active'
  const limit  = parseInt(params.get('limit') ?? '20')

  const { data, error } = await db
    .from('signals')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data, success: true })
}

export async function POST(req: NextRequest) {
  const db = createServiceSupabase()

  try {
    const body = await req.json()
    const { instrument, direction, entry_price, stop_loss, take_profit_1, take_profit_2, confidence, reasoning } = body

    if (!instrument || !direction || !entry_price || !stop_loss || !take_profit_1) {
      return NextResponse.json({ error: 'Missing required fields: instrument, direction, entry_price, stop_loss, take_profit_1' }, { status: 400 })
    }

    if (!['long', 'short'].includes(direction)) {
      return NextResponse.json({ error: 'Direction must be long or short' }, { status: 400 })
    }

    const slDist = Math.abs(entry_price - stop_loss)
    const tpDist = Math.abs(take_profit_1 - entry_price)
    const rr = slDist > 0 ? Math.round((tpDist / slDist) * 100) / 100 : 0

    const { data, error } = await db.from('signals').insert({
      instrument,
      direction,
      entry_price,
      stop_loss,
      take_profit_1,
      take_profit_2: take_profit_2 || null,
      confidence: confidence || 80,
      risk_reward: rr,
      reasoning: reasoning || 'Manual signal',
      ai_analysis: 'Manually created signal',
      news_sentiment: 'neutral',
      technical_score: 50,
      status: 'active',
    }).select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data, success: true })
  } catch (err) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}
