import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { createExchange, EXCHANGE_CONFIGS } from '@/lib/exchanges'
import type { ExchangeId } from '@/lib/exchanges'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { exchange: exchangeId, apiKey, secretKey, passphrase } = await req.json()

  if (!apiKey || !secretKey) {
    return NextResponse.json({ success: false, error: 'Unesi oba ključa' }, { status: 400 })
  }

  const exId = (exchangeId || 'binance') as ExchangeId
  const config = EXCHANGE_CONFIGS[exId]
  if (!config) {
    return NextResponse.json({ success: false, error: `Nepoznat exchange: ${exId}` }, { status: 400 })
  }

  const needsPassphrase = ['okx', 'kucoin', 'bitget'].includes(exId)
  if (needsPassphrase && !passphrase) {
    return NextResponse.json({ success: false, error: `${config.name} zahtijeva Passphrase` }, { status: 400 })
  }

  try {
    const ex = createExchange(exId, { apiKey, secretKey, passphrase })
    const result = await ex.testConnection()

    if (!result.success) {
      return NextResponse.json({
        success: false,
        error: result.error || `Greška pri povezivanju na ${config.name}`,
      })
    }

    return NextResponse.json({
      success: true,
      exchange: exId,
      exchangeName: config.name,
      canTrade: result.canTrade,
      canWithdraw: result.canWithdraw,
      quoteBalance: result.quoteBalance,
      quoteAsset: config.quoteAsset,
      warning: result.canWithdraw
        ? `UPOZORENJE: Withdrawal je uključen na ${config.name}! Preporučujemo da ga isključiš.`
        : null,
    })
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: `Greška: ${err instanceof Error ? err.message : 'Nepoznata greška'}`,
    })
  }
}
