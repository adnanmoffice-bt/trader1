import { NextRequest, NextResponse } from 'next/server'
import { calculateAllocation, logAllocation } from '@/lib/profit-engine'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const alloc = await calculateAllocation()
  await logAllocation(alloc)

  // TODO: Send Telegram alert if payout ready
  // if (alloc.payoutReady) await sendPayoutAlert(alloc)

  return NextResponse.json({ success: true, allocation: alloc })
}
