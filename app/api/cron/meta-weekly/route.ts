import { NextRequest, NextResponse } from 'next/server'
import { runWeeklyDeepReview } from '@/agents/meta-agent'

export const runtime = 'nodejs'
export const maxDuration = 180

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const t0 = Date.now()

  try {
    const result = await runWeeklyDeepReview()
    return NextResponse.json({
      success: true,
      mode: 'meta-weekly',
      ...result,
      duration_ms: Date.now() - t0,
    })
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: String(err).slice(0, 300),
      duration_ms: Date.now() - t0,
    }, { status: 500 })
  }
}
