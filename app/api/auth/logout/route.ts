import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function POST() {
  const supabase = await createServerSupabase()
  await supabase.auth.signOut()
  return NextResponse.json({ success: true })
}
