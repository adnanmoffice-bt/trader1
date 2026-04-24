import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { createServiceSupabase } from '@/lib/supabase'

const SPOT_BASE = 'https://api.binance.com'

async function hmacSign(queryString: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(queryString))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

type BinanceReq = {
  method: 'GET' | 'POST'
  host: string
  path: string
  extra?: Record<string, string>
}

async function signedCall<T = unknown>(
  apiKey: string,
  secret: string,
  req: BinanceReq,
): Promise<{ status: number; data: T }> {
  const params = new URLSearchParams({
    ...(req.extra ?? {}),
    timestamp: Date.now().toString(),
    recvWindow: '5000',
  })
  const qs = params.toString()
  const signature = await hmacSign(qs, secret)
  const url = `${req.host}${req.path}?${qs}&signature=${signature}`
  const res = await fetch(url, {
    method: req.method,
    headers: { 'X-MBX-APIKEY': apiKey },
    cache: 'no-store',
  })
  const text = await res.text()
  let data: unknown
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  return { status: res.status, data: data as T }
}

type SpotBalance = { asset: string; free: string; locked: string }
type SpotAccount = {
  balances?: SpotBalance[]
  canTrade?: boolean
  canWithdraw?: boolean
  permissions?: string[]
  code?: number
  msg?: string
}
type FundingAsset = { asset: string; free: string; locked: string; freeze?: string; withdrawing?: string }
type EarnPosition = { asset: string; totalAmount: string }
type EarnResponse = { rows?: EarnPosition[] }
type WalletAsset = { asset: string; free: number; locked: number; total: number }

function addToMap(map: Map<string, { free: number; locked: number }>, asset: string, free: number, locked: number) {
  const prev = map.get(asset) ?? { free: 0, locked: 0 }
  map.set(asset, { free: prev.free + free, locked: prev.locked + locked })
}

function mapToList(map: Map<string, { free: number; locked: number }>, minTotal = 0): WalletAsset[] {
  return Array.from(map.entries())
    .map(([asset, v]) => ({ asset, free: v.free, locked: v.locked, total: v.free + v.locked }))
    .filter(b => b.total > minTotal)
    .sort((a, b) => b.total - a.total)
}

function findAsset(list: WalletAsset[], asset: string): WalletAsset | undefined {
  return list.find(b => b.asset === asset)
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
    return NextResponse.json({ error: 'Binance API keys not configured', configured: false }, { status: 400 })
  }

  try {
    // Fetch the 3 wallet types in parallel.
    const [spotRes, fundingRes, earnRes] = await Promise.all([
      signedCall<SpotAccount>(apiKey, secret, { method: 'GET', host: SPOT_BASE, path: '/api/v3/account' }),
      signedCall<FundingAsset[]>(apiKey, secret, { method: 'POST', host: SPOT_BASE, path: '/sapi/v1/asset/get-funding-asset' }),
      signedCall<EarnResponse>(apiKey, secret, { method: 'GET', host: SPOT_BASE, path: '/sapi/v1/simple-earn/flexible/position', extra: { size: '100' } }),
    ])

    // SPOT is the master wallet — if it fails, return error.
    if (spotRes.status !== 200) {
      const err = spotRes.data as SpotAccount
      return NextResponse.json({ error: `Binance: ${err.msg ?? spotRes.status}`, configured: true }, { status: 400 })
    }

    // --- SPOT wallet ---
    // Filter out LD* tokens (Simple Earn redemption placeholders — they duplicate Earn positions).
    const spotMap = new Map<string, { free: number; locked: number }>()
    for (const b of spotRes.data.balances ?? []) {
      if (b.asset.startsWith('LD')) continue
      const free = parseFloat(b.free)
      const locked = parseFloat(b.locked)
      if (free + locked <= 0) continue
      addToMap(spotMap, b.asset, free, locked)
    }
    const spotAssets = mapToList(spotMap, 0.0001)

    // --- FUNDING wallet ---
    const fundingMap = new Map<string, { free: number; locked: number }>()
    if (fundingRes.status === 200 && Array.isArray(fundingRes.data)) {
      for (const f of fundingRes.data) {
        const free = parseFloat(f.free) + parseFloat(f.freeze ?? '0') + parseFloat(f.withdrawing ?? '0')
        const locked = parseFloat(f.locked ?? '0')
        if (free + locked <= 0) continue
        addToMap(fundingMap, f.asset, free, locked)
      }
    }
    const fundingAssets = mapToList(fundingMap, 0.0001)

    // --- SIMPLE EARN flexible ---
    const earnMap = new Map<string, { free: number; locked: number }>()
    if (earnRes.status === 200 && earnRes.data?.rows) {
      for (const p of earnRes.data.rows) {
        const amt = parseFloat(p.totalAmount)
        if (amt <= 0) continue
        addToMap(earnMap, p.asset, amt, 0)
      }
    }
    const earnAssets = mapToList(earnMap, 0.0001)

    // --- Merged view (across all three wallets) ---
    const mergedMap = new Map<string, { free: number; locked: number }>()
    for (const m of [spotMap, fundingMap, earnMap]) {
      for (const [asset, v] of m) addToMap(mergedMap, asset, v.free, v.locked)
    }
    const allAssets = mapToList(mergedMap, 0.0001)

    const permissions = spotRes.data.permissions ?? []
    const canTrade = spotRes.data.canTrade ?? false
    const canWithdraw = spotRes.data.canWithdraw ?? false

    const spotUsdt = findAsset(spotAssets, 'USDT')
    const totalUsdt = findAsset(allAssets, 'USDT')
    const totalBtc = findAsset(allAssets, 'BTC')
    const totalEth = findAsset(allAssets, 'ETH')

    // Per-wallet USDT-equivalent-ish totals (just USDT; the UI shows breakdown).
    const spotUsdtTotal = spotUsdt?.total ?? 0
    const fundingUsdt = findAsset(fundingAssets, 'USDT')?.total ?? 0
    const earnUsdt = findAsset(earnAssets, 'USDT')?.total ?? 0

    return NextResponse.json({
      configured: true,
      connected: true,
      // Back-compat fields: these are aggregated across SPOT + FUNDING + EARN so the old UI shows real totals.
      balances: allAssets,
      summary: {
        // Tradable USDT the war-room can actually use right now.
        usdt_free: spotUsdt?.free ?? 0,
        // Total USDT you own across all wallets.
        usdt_total: totalUsdt?.total ?? 0,
        btc_total: totalBtc?.total ?? 0,
        eth_total: totalEth?.total ?? 0,
        total_assets: allAssets.length,
      },
      // Per-wallet breakdown for the UI.
      wallets: {
        spot: {
          assets: spotAssets,
          usdt_free: spotUsdt?.free ?? 0,
          usdt_total: spotUsdtTotal,
          count: spotAssets.length,
        },
        funding: {
          assets: fundingAssets,
          usdt_total: fundingUsdt,
          count: fundingAssets.length,
          ok: fundingRes.status === 200,
        },
        earn_flexible: {
          assets: earnAssets,
          usdt_total: earnUsdt,
          count: earnAssets.length,
          ok: earnRes.status === 200,
        },
      },
      permissions: {
        can_trade: canTrade,
        can_withdraw: canWithdraw,
        types: permissions,
      },
    })
  } catch (err) {
    return NextResponse.json({
      error: `Connection error: ${err instanceof Error ? err.message : 'Unknown'}`,
      configured: true,
      connected: false,
    }, { status: 500 })
  }
}
