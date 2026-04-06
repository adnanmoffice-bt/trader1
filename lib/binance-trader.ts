import { createServiceSupabase } from '@/lib/supabase'

const BASE = 'https://api.binance.com'
const API_KEY = process.env.BINANCE_API_KEY ?? ''
const SECRET  = process.env.BINANCE_SECRET_KEY ?? ''

const SYMBOL_MAP: Record<string, string> = {
  'BTC/USD': 'BTCUSDT', 'ETH/USD': 'ETHUSDT', 'SOL/USD': 'SOLUSDT', 'BNB/USD': 'BNBUSDT',
}

const USD_AED = 3.6725
const MAX_RISK_PCT = 0.05
const MAX_POSITIONS = 3

async function hmacSign(queryString: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(queryString))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function binanceRequest(method: 'GET' | 'POST' | 'DELETE', endpoint: string, params: Record<string, string> = {}, signed = false) {
  params.timestamp = Date.now().toString()
  params.recvWindow = '5000'
  const qs = new URLSearchParams(params).toString()
  const signature = signed ? await hmacSign(qs) : ''
  const url = `${BASE}${endpoint}?${qs}${signed ? `&signature=${signature}` : ''}`

  const res = await fetch(url, {
    method,
    headers: { 'X-MBX-APIKEY': API_KEY },
  })
  const data = await res.json()
  if (data.code && data.code < 0) throw new Error(`Binance error ${data.code}: ${data.msg}`)
  return data
}

export function isConfigured(): boolean {
  return Boolean(API_KEY && SECRET)
}

export async function getAccountBalance(): Promise<{ asset: string; free: number; locked: number }[]> {
  const data = await binanceRequest('GET', '/api/v3/account', {}, true)
  return (data.balances ?? [])
    .map((b: { asset: string; free: string; locked: string }) => ({
      asset: b.asset,
      free: parseFloat(b.free),
      locked: parseFloat(b.locked),
    }))
    .filter((b: { free: number; locked: number }) => b.free > 0 || b.locked > 0)
}

export async function getUsdtBalance(): Promise<number> {
  const balances = await getAccountBalance()
  const usdt = balances.find(b => b.asset === 'USDT')
  return usdt?.free ?? 0
}

export async function executeBuy(
  instrument: string,
  notionalUsd: number,
  userId: string,
  signalId: string | null = null,
  stopLoss: number | null = null,
  takeProfit: number | null = null,
): Promise<{ orderId: string; executedQty: number; avgPrice: number } | null> {
  if (!isConfigured()) throw new Error('Binance API not configured')

  const symbol = SYMBOL_MAP[instrument]
  if (!symbol) throw new Error(`Unknown instrument: ${instrument}`)

  const balance = await getUsdtBalance()
  const orderAmount = Math.min(notionalUsd, balance * 0.95)
  if (orderAmount < 10) throw new Error(`Order too small: $${orderAmount.toFixed(2)} (balance: $${balance.toFixed(2)})`)

  const data = await binanceRequest('POST', '/api/v3/order', {
    symbol,
    side: 'BUY',
    type: 'MARKET',
    quoteOrderQty: orderAmount.toFixed(2),
  }, true)

  const executedQty = parseFloat(data.executedQty)
  const cummQuote   = parseFloat(data.cummulativeQuoteQty)
  const avgPrice    = cummQuote / executedQty

  const db = createServiceSupabase()
  await db.from('trades').insert({
    signal_id:   signalId,
    user_id:     userId,
    instrument,
    direction:   'long',
    quantity:    executedQty,
    entry_price: avgPrice,
    stop_loss:   stopLoss,
    take_profit: takeProfit,
    status:      'open',
    is_demo:     false,
    notes:       `Binance order ${data.orderId} | risk-sized $${orderAmount.toFixed(0)}`,
  })

  await db.from('positions').upsert({
    user_id:         userId,
    instrument,
    direction:       'long',
    quantity:        executedQty,
    avg_entry_price: avgPrice,
    current_price:   avgPrice,
    stop_loss:       stopLoss,
    take_profit:     takeProfit,
    is_demo:         false,
  }, { onConflict: 'user_id,instrument,is_demo' })

  await db.from('agent_logs').insert({
    agent: 'orchestrator',
    level: 'ok',
    message: `AUTO-TRADE: BUY ${instrument} qty:${executedQty.toFixed(6)} @ $${avgPrice.toFixed(2)} ($${orderAmount.toFixed(0)} risk-sized)`,
  })

  return { orderId: data.orderId.toString(), executedQty, avgPrice }
}

export async function executeSell(instrument: string, quantity: number): Promise<{ orderId: string; avgPrice: number } | null> {
  if (!isConfigured()) throw new Error('Binance API not configured')

  const symbol = SYMBOL_MAP[instrument]
  if (!symbol) throw new Error(`Unknown instrument: ${instrument}`)

  const stepSize = instrument.includes('BTC') ? 5 : instrument.includes('ETH') ? 4 : 2
  const qty = quantity.toFixed(stepSize)

  const data = await binanceRequest('POST', '/api/v3/order', {
    symbol,
    side: 'SELL',
    type: 'MARKET',
    quantity: qty,
  }, true)

  const cummQuote = parseFloat(data.cummulativeQuoteQty)
  const execQty   = parseFloat(data.executedQty)
  const avgPrice  = cummQuote / execQty

  const db = createServiceSupabase()
  await db.from('agent_logs').insert({
    agent: 'orchestrator',
    level: 'ok',
    message: `AUTO-TRADE: SELL ${instrument} qty:${qty} @ $${avgPrice.toFixed(2)}`,
  })

  return { orderId: data.orderId.toString(), avgPrice }
}

export async function setStopLossAndTakeProfit(
  instrument: string,
  quantity: number,
  stopPrice: number,
  takeProfitPrice: number
): Promise<boolean> {
  if (!isConfigured()) return false

  const symbol = SYMBOL_MAP[instrument]
  if (!symbol) return false

  const stepSize = instrument.includes('BTC') ? 5 : instrument.includes('ETH') ? 4 : 2
  const qty = quantity.toFixed(stepSize)

  try {
    await binanceRequest('POST', '/api/v3/order', {
      symbol,
      side: 'SELL',
      type: 'STOP_LOSS_LIMIT',
      quantity: qty,
      stopPrice: stopPrice.toFixed(2),
      price: (stopPrice * 0.998).toFixed(2),
      timeInForce: 'GTC',
    }, true)

    await binanceRequest('POST', '/api/v3/order', {
      symbol,
      side: 'SELL',
      type: 'TAKE_PROFIT_LIMIT',
      quantity: qty,
      stopPrice: takeProfitPrice.toFixed(2),
      price: (takeProfitPrice * 1.002).toFixed(2),
      timeInForce: 'GTC',
    }, true)

    return true
  } catch (err) {
    console.error('[binance-trader] SL/TP error:', err)
    return false
  }
}

export async function cancelAllOrders(instrument: string): Promise<void> {
  const symbol = SYMBOL_MAP[instrument]
  if (!symbol) return
  try {
    await binanceRequest('DELETE', '/api/v3/openOrders', { symbol }, true)
  } catch { /* no open orders is fine */ }
}

export function calculatePositionSize(capitalUsd: number, entryPrice: number, stopLoss: number): number {
  const riskAmount = capitalUsd * MAX_RISK_PCT
  const riskPerUnit = Math.abs(entryPrice - stopLoss)
  if (riskPerUnit <= 0) return 0
  return riskAmount / riskPerUnit
}

export { MAX_RISK_PCT, MAX_POSITIONS, USD_AED }
