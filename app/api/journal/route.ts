import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const db = createServiceSupabase()
  const tradeId = req.nextUrl.searchParams.get('trade_id')
  const date = req.nextUrl.searchParams.get('date')
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '50')

  let query = db.from('trade_journal').select('*').order('created_at', { ascending: false }).limit(limit)
  if (tradeId) query = query.eq('trade_id', tradeId)
  if (date) query = query.eq('date', date)

  const { data } = await query
  return NextResponse.json({ data: data ?? [], success: true })
}

export async function POST(req: NextRequest) {
  const db = createServiceSupabase()
  const body = await req.json()

  const entry = {
    trade_id: body.trade_id || null,
    date: body.date || new Date().toISOString().split('T')[0],
    type: body.type || 'trade',
    tags: body.tags || [],
    notes: body.notes || '',
    psychology_score: body.psychology_score || null,
    setup_type: body.setup_type || null,
    mistakes: body.mistakes || [],
    lessons: body.lessons || '',
  }

  const { data, error } = await db.from('trade_journal').insert(entry).select().single()

  if (error) return NextResponse.json({ error: error.message, success: false }, { status: 400 })
  return NextResponse.json({ data, success: true })
}
