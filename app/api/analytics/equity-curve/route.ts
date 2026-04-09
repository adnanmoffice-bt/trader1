import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const db = createServiceSupabase()
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '90')

  const { data } = await db.from('performance_snapshots').select('*')
    .order('date', { ascending: true }).limit(limit)

  return NextResponse.json({ data: data ?? [], success: true })
}
