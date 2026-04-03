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
