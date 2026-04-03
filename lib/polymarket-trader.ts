import { createServiceSupabase } from '@/lib/supabase'

const GAMMA_API = 'https://gamma-api.polymarket.com'
const CLOB_API  = 'https://clob.polymarket.com'

const PRIVATE_KEY = process.env.POLYMARKET_PRIVATE_KEY ?? ''
const MAX_BET_USD = 30
const MAX_ACTIVE_BETS = 10

export function isConfigured(): boolean {
  return Boolean(PRIVATE_KEY)
}

export interface PolyEvent {
  id: string
  slug: string
  title: string
  description: string
  end_date: string
  active: boolean
  closed: boolean
  markets: PolyMarket[]
}

export interface PolyMarket {
  id: string
  question: string
  condition_id: string
  slug: string
  tokens: Array<{ token_id: string; outcome: string }>
  yes_price: number
  no_price: number
  volume: number
  liquidity: number
  end_date: string
  active: boolean
}

export async function fetchTopEvents(limit = 15): Promise<PolyEvent[]> {
  try {
    const res = await fetch(`${GAMMA_API}/events?active=true&closed=false&limit=${limit}&order=volume&ascending=false`)
    if (!res.ok) return []
    const events = await res.json()

    return (events as Array<Record<string, unknown>>).map(e => ({
      id:          String(e.id ?? ''),
      slug:        String(e.slug ?? ''),
      title:       String(e.title ?? ''),
      description: String(e.description ?? ''),
      end_date:    String(e.endDate ?? ''),
      active:      Boolean(e.active),
      closed:      Boolean(e.closed),
      markets:     ((e.markets ?? []) as Array<Record<string, unknown>>).map(m => ({
        id:           String(m.id ?? ''),
        question:     String(m.question ?? ''),
        condition_id: String(m.conditionId ?? ''),
        slug:         String(m.slug ?? ''),
        tokens:       (m.clobTokenIds as string[] ?? []).map((tid, i) => ({
          token_id: tid,
          outcome: i === 0 ? 'Yes' : 'No',
        })),
        yes_price:  0,
        no_price:   0,
        volume:     Number(m.volume ?? 0),
        liquidity:  Number(m.liquidity ?? 0),
        end_date:   String(m.endDate ?? ''),
        active:     Boolean(m.active),
      })),
    }))
  } catch {
    return []
  }
}

export async function fetchMarketPrices(markets: PolyMarket[]): Promise<PolyMarket[]> {
  const enriched = [...markets]
  for (const m of enriched) {
    if (!m.tokens.length) continue
    try {
      const yesToken = m.tokens[0]?.token_id
      if (!yesToken) continue
      const res = await fetch(`${CLOB_API}/midpoint?token_id=${yesToken}`)
      if (!res.ok) continue
      const d = await res.json()
      m.yes_price = parseFloat(d.mid ?? '0')
      m.no_price  = Math.round((1 - m.yes_price) * 100) / 100
    } catch { /* skip */ }
  }
  return enriched
}

export async function fetchActiveMarkets(tag = ''): Promise<PolyMarket[]> {
  try {
    const url = tag
      ? `${GAMMA_API}/markets?tag_slug=${tag}&active=true&closed=false&limit=20&order=volume&ascending=false`
      : `${GAMMA_API}/markets?active=true&closed=false&limit=20&order=volume&ascending=false`
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()

    const markets: PolyMarket[] = (data as Array<Record<string, unknown>>).map(m => ({
      id:           String(m.id ?? ''),
      question:     String(m.question ?? ''),
      condition_id: String(m.conditionId ?? ''),
      slug:         String(m.slug ?? ''),
      tokens:       (m.clobTokenIds as string[] ?? []).map((tid: string, i: number) => ({
        token_id: tid,
        outcome: i === 0 ? 'Yes' : 'No',
      })),
      yes_price:  0,
      no_price:   0,
      volume:     Number(m.volume ?? 0),
      liquidity:  Number(m.liquidity ?? 0),
      end_date:   String(m.endDate ?? ''),
      active:     Boolean(m.active),
    }))

    return fetchMarketPrices(markets)
  } catch {
    return []
  }
}

export interface BetDecision {
  market_id: string
  question: string
  side: 'YES' | 'NO'
  market_price: number
  ai_probability: number
  edge: number
  amount_usd: number
  reasoning: string
}

export async function placeBet(decision: BetDecision): Promise<{ success: boolean; order_id?: string; error?: string }> {
  if (!isConfigured()) return { success: false, error: 'Polymarket private key not configured' }
  if (decision.amount_usd > MAX_BET_USD) return { success: false, error: `Max bet is $${MAX_BET_USD}` }

  const db = createServiceSupabase()

  // For now, record the bet intent in DB — actual CLOB order execution requires
  // py_clob_client or @polymarket/clob-client with EIP-712 signing.
  // We'll store as a "paper bet" until the wallet integration is complete.
  await db.from('polymarket_bets').insert({
    market_id:      decision.market_id,
    question:       decision.question,
    side:           decision.side,
    entry_price:    decision.side === 'YES' ? decision.market_price : 1 - decision.market_price,
    amount_usd:     decision.amount_usd,
    ai_probability: decision.ai_probability,
    edge:           decision.edge,
    reasoning:      decision.reasoning,
    status:         'open',
  })

  await db.from('agent_logs').insert({
    agent: 'polymarket-scanner',
    level: 'ok',
    message: `BET: ${decision.side} "${decision.question.slice(0, 60)}" @ ${(decision.market_price * 100).toFixed(0)}% | AI: ${(decision.ai_probability * 100).toFixed(0)}% | Edge: ${(decision.edge * 100).toFixed(1)}% | $${decision.amount_usd}`,
  })

  return { success: true, order_id: 'paper-' + Date.now() }
}

export async function getActiveBets(): Promise<Array<Record<string, unknown>>> {
  const db = createServiceSupabase()
  const { data } = await db
    .from('polymarket_bets')
    .select('*')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
  return data ?? []
}

export { MAX_BET_USD, MAX_ACTIVE_BETS }
