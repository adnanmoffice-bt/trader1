import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { getGroups } from '@/lib/whatsapp'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { instanceId, apiToken } = await req.json()
  if (!instanceId || !apiToken) {
    return NextResponse.json({ error: 'Unesi Instance ID i API Token' }, { status: 400 })
  }

  const groups = await getGroups(instanceId, apiToken)
  return NextResponse.json({ groups })
}
