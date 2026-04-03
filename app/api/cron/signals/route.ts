import { NextRequest, NextResponse } from 'next/server'
import { runOrchestrator } from '@/agents'

export const runtime = 'nodejs'
export const maxDuration = 300  // 5 min max

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await runOrchestrator()
    return NextResponse.json({ success: true, timestamp: new Date().toISOString() })
  } catch (err) {
    console.error('[cron/signals] Error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
