import { NextResponse } from 'next/server'
import { calculateAllocation } from '@/lib/profit-engine'

export async function GET() {
  const alloc = await calculateAllocation()
  return NextResponse.json({ data: alloc, success: true })
}
