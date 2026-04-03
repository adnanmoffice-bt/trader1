import { NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'

export async function GET() {
  const db = createServiceSupabase()
  const { data, error } = await db
    .from('polymarket_bets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ data: [], success: true })
  return NextResponse.json({ data, success: true })
}
