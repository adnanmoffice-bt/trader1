import { NextRequest, NextResponse } from 'next/server'
import { runDailyReview } from '@/agents/meta-agent'
import { createServiceSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const t0 = Date.now()
  const db = createServiceSupabase()

  try {
    const result = await runDailyReview()
    await db.from('agent_logs').insert({
      agent: 'meta-agent-cron',
      level: 'ok',
      message: `daily review complete`,
      metadata: { duration_ms: Date.now() - t0, result },
    }).then(() => {})
    return NextResponse.json({
      success: true,
      mode: 'meta-daily',
      ...result,
      duration_ms: Date.now() - t0,
    })
  } catch (err) {
    await db.from('agent_logs').insert({
      agent: 'meta-agent-cron',
      level: 'error',
      message: `daily review failed: ${String(err).slice(0, 200)}`,
      metadata: { duration_ms: Date.now() - t0 },
    }).then(() => {})
    return NextResponse.json({
      success: false,
      error: String(err).slice(0, 300),
      duration_ms: Date.now() - t0,
    }, { status: 500 })
  }
}
