import { NextRequest, NextResponse } from 'next/server'
import { runPolymarketScanner } from '@/agents'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runPolymarketScanner()
    return NextResponse.json({ success: true, ...result, timestamp: new Date().toISOString() })
  } catch (err) {
    console.error('[cron/polymarket] Error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
