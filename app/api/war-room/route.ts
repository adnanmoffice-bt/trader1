import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const db = createServiceSupabase()
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '50')
  const meetingParam = req.nextUrl.searchParams.get('meeting')
  const debatesOnly = req.nextUrl.searchParams.get('debates') !== 'false'

  // Single meeting detail
  if (meetingParam) {
    const { data } = await db.from('war_room_messages').select('*')
      .eq('meeting_id', meetingParam).order('created_at', { ascending: true })
    return NextResponse.json({ data: data ?? [], meetings: [], success: true })
  }

  // Get all meetings that have DECISIONS (= full debates)
  // This is much faster than loading all messages
  const { data: decisionMsgs } = await db.from('war_room_messages').select('meeting_id, instrument, message, data, created_at')
    .eq('role', 'decision').order('created_at', { ascending: false }).limit(limit)

  if (!decisionMsgs?.length) {
    // Fallback: get recent close messages (quick scans)
    const { data: closeMsgs } = await db.from('war_room_messages').select('meeting_id, instrument, message, created_at')
      .eq('role', 'close').order('created_at', { ascending: false }).limit(limit)

    const meetings = (closeMsgs ?? []).map(m => ({
      id: m.meeting_id, instrument: m.instrument ?? '—', messageCount: 1,
      startedAt: m.created_at, decision: m.message, hasDebate: false, messages: [m],
    }))
    return NextResponse.json({ data: closeMsgs ?? [], meetings, success: true })
  }

  // Build meeting list from decisions
  const meetings = decisionMsgs.map(d => {
    const outcomeData = d.data as Record<string, unknown> | null
    const executed = outcomeData?.execute === true
    const votesFor = Number(outcomeData?.votesFor ?? 0)
    const votesAgainst = Number(outcomeData?.votesAgainst ?? 0)

    return {
      id: d.meeting_id,
      instrument: d.instrument ?? '—',
      messageCount: 14, // typical full debate
      startedAt: d.created_at,
      decision: d.message,
      hasDebate: true,
      executed,
      votesFor,
      votesAgainst,
      messages: [], // loaded on demand when meeting is selected
    }
  })

  return NextResponse.json({ data: [], meetings, success: true })
}
