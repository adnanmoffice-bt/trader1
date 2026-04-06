import { NextRequest, NextResponse } from 'next/server'
import { runOrchestrator } from '@/agents'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const t0 = Date.now()

  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Orchestrator timeout (110s)')), 110_000)
    )
    await Promise.race([runOrchestrator(), timeout])

    return NextResponse.json({
      success: true,
      duration_ms: Date.now() - t0,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[cron/signals] Error:', err)
    return NextResponse.json({
      error: String(err).slice(0, 200),
      duration_ms: Date.now() - t0,
    }, { status: 500 })
  }
}
