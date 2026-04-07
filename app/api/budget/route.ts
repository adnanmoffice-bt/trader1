import { NextResponse } from 'next/server'
import { getDailyBudgetStatus } from '@/lib/anthropic'

export async function GET() {
  return NextResponse.json(await getDailyBudgetStatus())
}
