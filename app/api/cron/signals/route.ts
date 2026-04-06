import { NextRequest, NextResponse } from 'next/server'
import { runWarRoom } from '@/agents/war-room'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const t0 = Date.now()

  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('War Room timeout (280s)')), 280_000)
    )
    await Promise.race([runWarRoom(), timeout])

    return NextResponse.json({
      success: true,
      mode: 'war-room',
      duration_ms: Date.now() - t0,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[cron/signals] War Room error:', err)
    return NextResponse.json({
      error: String(err).slice(0, 200),
      duration_ms: Date.now() - t0,
    }, { status: 500 })
  }
}
