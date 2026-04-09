import { NextResponse } from 'next/server'
import { getPerformanceContext } from '@/lib/trade-analytics'

export async function GET() {
  const ctx = await getPerformanceContext()
  return NextResponse.json({ data: ctx, success: true })
}
