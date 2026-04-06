import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { createServiceSupabase } from '@/lib/supabase'

function mask(value: string | null | undefined): string {
  if (!value || value.length < 8) return value ? '••••' : ''
  return '••••••••' + value.slice(-4)
}

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceSupabase()
  const { data } = await db
    .from('user_settings')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (!data) {
    return NextResponse.json({
      settings: {
        trading_mode: 'demo',
        binance_configured: false,
        telegram_configured: false,
        whatsapp_configured: false,
        whatsapp_enabled: false,
        max_drawdown_pct: 15,
        daily_loss_limit_pct: 3,
        max_positions: 3,
        risk_per_trade_pct: 2,
        min_risk_reward: 1.5,
        max_sl_pct: 6,
        initial_capital: 5000,
        currency: 'AED',
        notifications_enabled: true,
        auto_trade_enabled: false,
      },
      exists: false,
    })
  }

  return NextResponse.json({
    settings: {
      trading_mode: data.trading_mode,
      binance_api_key_masked: mask(data.binance_api_key),
      binance_configured: Boolean(data.binance_api_key && data.binance_secret_key),
      telegram_bot_token_masked: mask(data.telegram_bot_token),
      telegram_chat_id: data.telegram_chat_id ?? '',
      telegram_configured: Boolean(data.telegram_bot_token && data.telegram_chat_id),
      whatsapp_instance_id: data.whatsapp_instance_id ?? '',
      whatsapp_configured: Boolean(data.whatsapp_instance_id && data.whatsapp_api_token),
      whatsapp_enabled: data.whatsapp_enabled ?? false,
      whatsapp_group_id: data.whatsapp_group_id ?? '',
      max_drawdown_pct: Number(data.max_drawdown_pct),
      daily_loss_limit_pct: Number(data.daily_loss_limit_pct),
      max_positions: data.max_positions,
      risk_per_trade_pct: Number(data.risk_per_trade_pct),
      min_risk_reward: Number(data.min_risk_reward),
      max_sl_pct: Number(data.max_sl_pct),
      initial_capital: Number(data.initial_capital),
      currency: data.currency,
      notifications_enabled: data.notifications_enabled,
      auto_trade_enabled: data.auto_trade_enabled,
    },
    exists: true,
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const db = createServiceSupabase()

  const updateFields: Record<string, unknown> = { updated_at: new Date().toISOString() }

  const allowedFields = [
    'trading_mode', 'max_drawdown_pct', 'daily_loss_limit_pct',
    'max_positions', 'risk_per_trade_pct', 'min_risk_reward', 'max_sl_pct',
    'initial_capital', 'currency', 'notifications_enabled', 'auto_trade_enabled',
    'whatsapp_enabled',
  ]

  for (const key of allowedFields) {
    if (body[key] !== undefined) updateFields[key] = body[key]
  }

  if (body.binance_api_key !== undefined) updateFields.binance_api_key = body.binance_api_key || null
  if (body.binance_secret_key !== undefined) updateFields.binance_secret_key = body.binance_secret_key || null
  if (body.telegram_bot_token !== undefined) updateFields.telegram_bot_token = body.telegram_bot_token || null
  if (body.telegram_chat_id !== undefined) updateFields.telegram_chat_id = body.telegram_chat_id || null
  if (body.whatsapp_instance_id !== undefined) updateFields.whatsapp_instance_id = body.whatsapp_instance_id || null
  if (body.whatsapp_api_token !== undefined) updateFields.whatsapp_api_token = body.whatsapp_api_token || null
  if (body.whatsapp_group_id !== undefined) updateFields.whatsapp_group_id = body.whatsapp_group_id || null

  if (body.trading_mode === 'live') {
    const { data: existing } = await db
      .from('user_settings')
      .select('binance_api_key, binance_secret_key')
      .eq('user_id', user.id)
      .single()

    const hasKeys = (existing?.binance_api_key || body.binance_api_key) &&
                    (existing?.binance_secret_key || body.binance_secret_key)

    if (!hasKeys) {
      return NextResponse.json({ error: 'Binance API ključevi su potrebni za LIVE mod' }, { status: 400 })
    }
  }

  const { error } = await db
    .from('user_settings')
    .upsert({
      user_id: user.id,
      ...updateFields,
    }, { onConflict: 'user_id' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
