import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { testConnection, sendMessage } from '@/lib/whatsapp'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { instanceId, apiToken, groupId, action } = await req.json()

  if (action === 'test-connection') {
    if (!instanceId || !apiToken) {
      return NextResponse.json({ success: false, error: 'Unesi Instance ID i API Token' })
    }
    const result = await testConnection(instanceId, apiToken)
    return NextResponse.json({
      success: result.ok,
      phone: result.phone,
      error: result.error,
    })
  }

  if (action === 'test-message') {
    if (!instanceId || !apiToken || !groupId) {
      return NextResponse.json({ success: false, error: 'Konfiguracija nije kompletna' })
    }

    const testMsg = `✅ *APEX Trading Terminal*
━━━━━━━━━━━━━━━━━━
Test message — WhatsApp integration is working!
⏰ ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Dubai' })}`

    try {
      const url = `https://7107.api.greenapi.com/waInstance${instanceId}/sendMessage/${apiToken}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: groupId, message: testMsg }),
      })
      const data = await res.json()

      if (data.idMessage) {
        return NextResponse.json({ success: true, messageId: data.idMessage })
      }
      return NextResponse.json({ success: false, error: JSON.stringify(data) })
    } catch (err) {
      return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Greška' })
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
