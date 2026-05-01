import { NextRequest, NextResponse } from 'next/server'
import { runWarRoom } from '@/agents/war-room'
import { createServiceSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const t0 = Date.now()
  const db = createServiceSupabase()

  // Auto-expire stale signals (>12h old and still "active")
  const expireCutoff = new Date(Date.now() - 12 * 3600_000).toISOString()
  const { data: expired } = await db.from('signals')
    .update({ status: 'expired' })
    .eq('status', 'active')
    .lt('created_at', expireCutoff)
    .select('id')
  const expiredCount = expired?.length ?? 0

  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('War Room timeout (280s)')), 280_000)
    )
    await Promise.race([runWarRoom(), timeout])

    await db.from('agent_logs').insert({
      agent: 'signals-cron',
      level: 'ok',
      message: `war-room run complete · expired=${expiredCount}`,
      metadata: { duration_ms: Date.now() - t0, expired_signals: expiredCount },
    }).then(() => {})

    return NextResponse.json({
      success: true,
      mode: 'war-room',
      expired_signals: expiredCount,
      duration_ms: Date.now() - t0,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[cron/signals] War Room error:', err)
    await db.from('agent_logs').insert({
      agent: 'signals-cron',
      level: 'error',
      message: `war-room failed: ${String(err).slice(0, 200)}`,
      metadata: { duration_ms: Date.now() - t0, expired_signals: expiredCount },
    }).then(() => {})
    return NextResponse.json({
      error: String(err).slice(0, 200),
      expired_signals: expiredCount,
      duration_ms: Date.now() - t0,
    }, { status: 500 })
  }
}
