import { NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'

export async function GET() {
  const db = createServiceSupabase()
  const { data, error } = await db
    .from('agent_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data, success: true })
}
