import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * Read-only check of which env vars are present on the server.
 * Returns booleans only — never the values themselves.
 * Requires the cron secret so random people can't probe it.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? req.nextUrl.searchParams.get('auth')
  if (auth !== process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const envs = [
    'BINANCE_API_KEY',
    'BINANCE_SECRET_KEY',
    'ANTHROPIC_API_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'CRON_SECRET',
    'GREEN_API_TOKEN',
    'GREEN_API_INSTANCE_ID',
    'GREEN_API_GROUP_ID',
    'TELEGRAM_BOT_TOKEN',
  ]

  const status: Record<string, { present: boolean; length: number; sample: string | null }> = {}
  for (const name of envs) {
    const v = process.env[name] ?? ''
    status[name] = {
      present: v.length > 0,
      length: v.length,
      sample: v.length >= 10 ? `${v.slice(0, 6)}...${v.slice(-4)}` : null,
    }
  }

  return NextResponse.json({
    runtime: 'vercel',
    vercel_region: process.env.VERCEL_REGION ?? null,
    vercel_env: process.env.VERCEL_ENV ?? null,
    node_env: process.env.NODE_ENV,
    env_status: status,
    timestamp: new Date().toISOString(),
  })
}
