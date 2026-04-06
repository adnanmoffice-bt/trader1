import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const db = createServiceSupabase()
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '5')
  const meetingId = req.nextUrl.searchParams.get('meeting')

  if (meetingId) {
    const { data } = await db
      .from('war_room_messages')
      .select('*')
      .eq('meeting_id', meetingId)
      .order('created_at', { ascending: true })
    return NextResponse.json({ data: data ?? [], success: true })
  }

  // Get latest meetings (distinct meeting_ids)
  const { data: messages } = await db
    .from('war_room_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)

  if (!messages?.length) {
    return NextResponse.json({ data: [], meetings: [], success: true })
  }

  // Group by meeting_id
  const meetingMap = new Map<string, typeof messages>()
  for (const m of messages) {
    const mid = m.meeting_id
    if (!meetingMap.has(mid)) meetingMap.set(mid, [])
    meetingMap.get(mid)!.push(m)
  }

  // Get latest N meetings
  const meetings = Array.from(meetingMap.entries())
    .map(([id, msgs]) => ({
      id,
      instrument: msgs[0]?.instrument ?? '—',
      messageCount: msgs.length,
      startedAt: msgs[msgs.length - 1]?.created_at,
      decision: msgs.find(m => m.role === 'decision')?.message ?? 'No decision',
      messages: msgs.reverse(),
    }))
    .slice(0, limit)

  return NextResponse.json({ data: messages, meetings, success: true })
}
