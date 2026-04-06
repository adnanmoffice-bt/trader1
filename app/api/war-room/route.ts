import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const db = createServiceSupabase()
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '10')

  // Try war_room_messages table first
  const { data: wrData, error: wrErr } = await db
    .from('war_room_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(300)

  if (!wrErr && wrData && wrData.length > 0) {
    const meetingMap = new Map<string, typeof wrData>()
    for (const m of wrData) {
      if (!meetingMap.has(m.meeting_id)) meetingMap.set(m.meeting_id, [])
      meetingMap.get(m.meeting_id)!.push(m)
    }
    const meetings = Array.from(meetingMap.entries()).map(([id, msgs]) => ({
      id, instrument: msgs[0]?.instrument ?? '—', messageCount: msgs.length,
      startedAt: msgs[msgs.length - 1]?.created_at,
      decision: msgs.find(m => m.role === 'decision')?.message ?? 'No decision',
      messages: msgs.reverse(),
    })).slice(0, limit)
    return NextResponse.json({ data: wrData, meetings, success: true })
  }

  // Fallback: read from agent_logs where War Room messages were stored
  const { data: logs } = await db
    .from('agent_logs')
    .select('*')
    .like('message', '%[WAR ROOM]%')
    .order('created_at', { ascending: false })
    .limit(300)

  if (!logs?.length) {
    return NextResponse.json({ data: [], meetings: [], success: true })
  }

  // Parse agent_logs into War Room format
  // Group by metadata.meeting_id or by time clusters
  const meetingMap = new Map<string, Array<Record<string, unknown>>>()

  for (const log of logs) {
    const meta = (log.metadata ?? {}) as Record<string, unknown>
    const mid = String(meta.meeting_id ?? 'unknown')
    if (!meetingMap.has(mid)) meetingMap.set(mid, [])
    meetingMap.get(mid)!.push({
      id: log.id,
      meeting_id: mid,
      agent: log.agent,
      role: String(meta.role ?? (log.level === 'ok' ? 'decision' : log.level === 'warn' ? 'alert' : 'speak')),
      message: String(log.message).replace('[WAR ROOM] ', ''),
      instrument: null,
      created_at: log.created_at,
      data: meta,
    })
  }

  // If no meeting_ids in metadata, group by time (5-min windows)
  if (meetingMap.size === 1 && meetingMap.has('unknown')) {
    meetingMap.clear()
    let currentMid = ''
    let lastTime = 0
    for (const log of logs.reverse()) {
      const t = new Date(log.created_at).getTime()
      if (t - lastTime > 120000 || !currentMid) {
        currentMid = `meeting-${t}`
      }
      lastTime = t
      if (!meetingMap.has(currentMid)) meetingMap.set(currentMid, [])

      // Detect instrument from message
      const instrMatch = String(log.message).match(/(BTC\/USD|ETH\/USD|SOL\/USD|BNB\/USD|XAU\/USD|BRENT)/i)

      meetingMap.get(currentMid)!.push({
        id: log.id,
        meeting_id: currentMid,
        agent: log.agent,
        role: String(log.message).includes('DECISION') ? 'decision'
          : String(log.message).includes('Meeting started') ? 'open'
          : String(log.message).includes('adjourned') || String(log.message).includes('Skipping') ? 'close'
          : String(log.message).includes('ALERT') || String(log.message).includes('REJECTED') ? 'alert'
          : 'speak',
        message: String(log.message).replace('[WAR ROOM] ', ''),
        instrument: instrMatch?.[1] ?? null,
        created_at: log.created_at,
      })
    }
  }

  const meetings = Array.from(meetingMap.entries()).map(([id, msgs]) => ({
    id,
    instrument: String(msgs.find(m => m.instrument)?.instrument ?? '—'),
    messageCount: msgs.length,
    startedAt: String(msgs[0]?.created_at ?? ''),
    decision: String(msgs.find(m => String(m.role) === 'decision')?.message ?? msgs.find(m => String(m.role) === 'close')?.message ?? 'No decision'),
    messages: msgs,
  })).slice(0, limit)

  const allMsgs = meetings.flatMap(m => m.messages)

  return NextResponse.json({ data: allMsgs, meetings, success: true })
}
