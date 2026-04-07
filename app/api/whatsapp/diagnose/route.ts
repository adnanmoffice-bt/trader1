import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceSupabase()
  const checks: Record<string, unknown> = {}

  // 1. Check user_settings for WhatsApp config
  const { data: enabledUsers, error: err1 } = await db
    .from('user_settings')
    .select('user_id, whatsapp_instance_id, whatsapp_group_id, whatsapp_enabled, whatsapp_group_name')
    .not('whatsapp_instance_id', 'is', null)

  checks.db_users_with_instance_id = enabledUsers?.length ?? 0
  checks.db_query_error = err1?.message ?? null

  if (enabledUsers?.length) {
    checks.users = enabledUsers.map(u => ({
      user_id: u.user_id.slice(0, 8) + '...',
      has_instance_id: !!u.whatsapp_instance_id,
      has_group_id: !!u.whatsapp_group_id,
      enabled: u.whatsapp_enabled,
      group_name: u.whatsapp_group_name,
    }))
  }

  // 2. Check if API token exists (don't expose it)
  const { data: tokenCheck } = await db
    .from('user_settings')
    .select('user_id, whatsapp_api_token')
    .not('whatsapp_instance_id', 'is', null)

  checks.users_with_token = tokenCheck?.filter(u => !!u.whatsapp_api_token).length ?? 0
  checks.users_without_token = tokenCheck?.filter(u => !u.whatsapp_api_token).length ?? 0

  // 3. Check env vars
  checks.env_GREEN_API_INSTANCE_ID = !!process.env.GREEN_API_INSTANCE_ID
  checks.env_GREEN_API_TOKEN = !!process.env.GREEN_API_TOKEN
  checks.env_GREEN_API_GROUP_ID = !!process.env.GREEN_API_GROUP_ID

  // 4. Try Green API state check if we have credentials
  const { data: anyUser } = await db
    .from('user_settings')
    .select('whatsapp_instance_id, whatsapp_api_token')
    .not('whatsapp_api_token', 'is', null)
    .not('whatsapp_instance_id', 'is', null)
    .limit(1)
    .maybeSingle()

  const instanceId = anyUser?.whatsapp_instance_id || process.env.GREEN_API_INSTANCE_ID
  const apiToken = anyUser?.whatsapp_api_token || process.env.GREEN_API_TOKEN

  if (instanceId && apiToken) {
    try {
      const stateUrl = `https://7107.api.greenapi.com/waInstance${instanceId}/getStateInstance/${apiToken}`
      const stateRes = await fetch(stateUrl)
      const stateData = await stateRes.json()
      checks.green_api_state = stateData.stateInstance
      checks.green_api_authorized = stateData.stateInstance === 'authorized'

      if (stateData.stateInstance === 'authorized') {
        const settingsUrl = `https://7107.api.greenapi.com/waInstance${instanceId}/getSettings/${apiToken}`
        const settingsRes = await fetch(settingsUrl)
        const settings = await settingsRes.json()
        checks.green_api_phone = settings.wid?.replace('@c.us', '')
      }
    } catch (e) {
      checks.green_api_error = e instanceof Error ? e.message : String(e)
    }
  } else {
    checks.green_api_state = 'NO_CREDENTIALS_FOUND'
  }

  // 5. Summary
  const problems: string[] = []
  if (!checks.db_users_with_instance_id) problems.push('Nema korisnika sa WhatsApp Instance ID u bazi')
  if (checks.users_without_token) problems.push(`${checks.users_without_token} korisnik(a) nemaju API Token u bazi`)
  if (checks.green_api_state === 'NO_CREDENTIALS_FOUND') problems.push('Nema credentials ni u bazi ni u env vars')
  if (checks.green_api_state && checks.green_api_state !== 'authorized' && checks.green_api_state !== 'NO_CREDENTIALS_FOUND') {
    problems.push(`Green API stanje: ${checks.green_api_state} — treba ponovo skenirati QR kod`)
  }

  const enabledWithGroupAndToken = enabledUsers?.filter(u =>
    u.whatsapp_enabled && u.whatsapp_group_id
  ).length ?? 0
  if (enabledWithGroupAndToken === 0 && (checks.users_with_token as number) > 0) {
    problems.push('Ima token ali whatsapp_enabled=false ili whatsapp_group_id je prazan')
  }

  checks.problems = problems
  checks.would_work = problems.length === 0

  // Test send if requested
  const sendTest = req.nextUrl.searchParams.get('send') === 'true'
  if (sendTest && instanceId && apiToken) {
    const groupId = process.env.GREEN_API_GROUP_ID
    if (groupId) {
      try {
        const sendUrl = `https://7107.api.greenapi.com/waInstance${instanceId}/sendMessage/${apiToken}`
        const sendRes = await fetch(sendUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId: groupId, message: `APEX HEARTBEAT - System alive. Budget: $5.00 remaining. ${new Date().toISOString()}` }),
        })
        const sendData = await sendRes.json()
        checks.test_send = { status: sendRes.status, response: sendData }
      } catch (e) {
        checks.test_send = { error: e instanceof Error ? e.message : String(e) }
      }
    } else {
      checks.test_send = { error: 'No GROUP_ID configured' }
    }
  }

  return NextResponse.json(checks)
}
