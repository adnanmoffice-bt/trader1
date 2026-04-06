import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { createServiceSupabase } from '@/lib/supabase'

const BASE = 'https://api.binance.com'

async function hmacSign(queryString: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(queryString))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceSupabase()
  const { data: settings } = await db
    .from('user_settings')
    .select('binance_api_key, binance_secret_key')
    .eq('user_id', user.id)
    .single()

  const apiKey = settings?.binance_api_key || process.env.BINANCE_API_KEY
  const secret = settings?.binance_secret_key || process.env.BINANCE_SECRET_KEY

  if (!apiKey || !secret) {
    return NextResponse.json({ error: 'Binance API ključevi nisu konfigurisani', configured: false }, { status: 400 })
  }

  try {
    const params: Record<string, string> = {
      timestamp: Date.now().toString(),
      recvWindow: '5000',
    }
    const qs = new URLSearchParams(params).toString()
    const signature = await hmacSign(qs, secret)
    const url = `${BASE}/api/v3/account?${qs}&signature=${signature}`

    const res = await fetch(url, {
      headers: { 'X-MBX-APIKEY': apiKey },
    })
    const data = await res.json()

    if (data.code && data.code < 0) {
      return NextResponse.json({ error: `Binance: ${data.msg}`, configured: true }, { status: 400 })
    }

    const balances = (data.balances ?? [])
      .map((b: { asset: string; free: string; locked: string }) => ({
        asset: b.asset,
        free: parseFloat(b.free),
        locked: parseFloat(b.locked),
        total: parseFloat(b.free) + parseFloat(b.locked),
      }))
      .filter((b: { total: number }) => b.total > 0.001)
      .sort((a: { total: number }, b: { total: number }) => b.total - a.total)

    const usdt = balances.find((b: { asset: string }) => b.asset === 'USDT')
    const btc = balances.find((b: { asset: string }) => b.asset === 'BTC')
    const eth = balances.find((b: { asset: string }) => b.asset === 'ETH')

    const permissions = data.permissions ?? []
    const canTrade = data.canTrade ?? false
    const canWithdraw = data.canWithdraw ?? false

    return NextResponse.json({
      configured: true,
      connected: true,
      balances,
      summary: {
        usdt_free: usdt?.free ?? 0,
        usdt_total: usdt?.total ?? 0,
        btc_total: btc?.total ?? 0,
        eth_total: eth?.total ?? 0,
        total_assets: balances.length,
      },
      permissions: {
        can_trade: canTrade,
        can_withdraw: canWithdraw,
        types: permissions,
      },
    })
  } catch (err) {
    return NextResponse.json({
      error: `Greška pri povezivanju: ${err instanceof Error ? err.message : 'Unknown'}`,
      configured: true,
      connected: false,
    }, { status: 500 })
  }
}
