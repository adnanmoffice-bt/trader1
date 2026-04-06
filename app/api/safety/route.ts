import { NextResponse } from 'next/server'
import { checkSafety } from '@/lib/safety'

export async function GET() {
  const status = await checkSafety()
  return NextResponse.json({ data: status, success: true })
}
