import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { activateKillSwitch, deactivateKillSwitch } from '@/lib/safety'
import { notifyKillSwitch as waKillSwitch } from '@/lib/whatsapp'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  // Allow both authenticated users and cron secret
  const auth = req.headers.get('authorization')
  const isCron = auth === `Bearer ${process.env.CRON_SECRET}`

  if (!user && !isCron) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { action?: string } = {}
  try { body = await req.json() } catch { /* empty body = activate */ }

  if (body.action === 'deactivate') {
    await deactivateKillSwitch()
    await waKillSwitch(false).catch(e => console.error('[kill-switch] WhatsApp error:', e))
    return NextResponse.json({ success: true, message: 'Kill switch deactivated' })
  }

  await activateKillSwitch()
  await waKillSwitch(true, 'Manually activated from Settings').catch(e => console.error('[kill-switch] WhatsApp error:', e))
  return NextResponse.json({ success: true, message: 'Kill switch activated — trading halted' })
}
