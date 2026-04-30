/**
 * News-impact scorer for war-room pre-execution gate.
 *
 * Pulls free RSS feeds (CryptoPanic free tier, CoinDesk, CoinTelegraph,
 * plus the macro headlines already fetched via lib/macro-context.ts) and
 * asks Claude to score impact on a -100..+100 scale for the proposed
 * trade direction. A score < -40 vetoes a LONG entry.
 *
 * Fails open: if Claude or feeds error, returns score:0, allowed:true.
 */

import { callAgent } from '@/lib/anthropic'
import type { Instrument } from '@/types'

const FEEDS = [
  // CryptoPanic public RSS
  'https://cryptopanic.com/news/rss/',
  // CoinDesk
  'https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml',
  // CoinTelegraph
  'https://cointelegraph.com/rss',
]

interface NewsItem {
  title: string
  source: string
  publishedAt?: string
}

async function fetchFeed(url: string): Promise<NewsItem[]> {
  try {
    const res = await fetch(url, {
      next: { revalidate: 600 },
      headers: { 'User-Agent': 'Mozilla/5.0 apex-trading/1.0' },
    })
    if (!res.ok) return []
    const xml = await res.text()
    const items: NewsItem[] = []
    const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/g) ?? []
    for (const item of itemMatches.slice(0, 8)) {
      const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)
      const dateMatch = item.match(/<pubDate>([^<]+)<\/pubDate>/)
      if (titleMatch?.[1]) {
        items.push({
          title: titleMatch[1].trim().slice(0, 180),
          source: new URL(url).hostname.replace(/^www\./, ''),
          publishedAt: dateMatch?.[1],
        })
      }
    }
    return items
  } catch { return [] }
}

/** Filter to news in the last `withinMinutes` minutes (where pubDate parses). */
function recentOnly(items: NewsItem[], withinMinutes: number): NewsItem[] {
  const cutoff = Date.now() - withinMinutes * 60_000
  return items.filter(it => {
    if (!it.publishedAt) return true  // keep undated items (better safe than sorry)
    const t = new Date(it.publishedAt).getTime()
    return Number.isFinite(t) ? t >= cutoff : true
  })
}

export interface NewsImpactResult {
  allowed: boolean
  /** -100 (very bearish for LONG) … +100 (very bullish) */
  score: number
  reason: string
  headlineCount: number
  topHeadlines: string[]
}

interface ClaudeNewsScore {
  score: number
  rationale: string
}

/**
 * Score news impact for a proposed LONG on `instrument`. Veto if score <= -40.
 * @param withinMinutes window of news to consider (default 60min)
 */
export async function evaluateNewsImpactForLong(
  instrument: Instrument,
  withinMinutes = 60,
): Promise<NewsImpactResult> {
  try {
    const allItems = (await Promise.all(FEEDS.map(fetchFeed))).flat()
    const fresh = recentOnly(allItems, withinMinutes)
    if (fresh.length === 0) {
      return { allowed: true, score: 0, reason: 'no recent news in window', headlineCount: 0, topHeadlines: [] }
    }

    // Filter to crypto-related headlines for crypto instruments. Gold gets all.
    const isCrypto = instrument !== 'XAU/USD'
    const cryptoKw = /\b(bitcoin|btc|ethereum|eth|crypto|defi|altcoin|sec|cftc|stablecoin|liquidat|hack|exploit|etf|halv|miner|onchain)\b/i
    const tickerStripped = instrument.split('/')[0]
    const tickerRe = new RegExp(`\\b${tickerStripped}\\b`, 'i')

    const scoped = fresh.filter(h =>
      isCrypto ? (cryptoKw.test(h.title) || tickerRe.test(h.title)) : true,
    ).slice(0, 12)

    if (scoped.length === 0) {
      return { allowed: true, score: 0, reason: 'no instrument-relevant headlines', headlineCount: fresh.length, topHeadlines: [] }
    }

    const headlinesText = scoped.map((h, i) => `${i + 1}. [${h.source}] ${h.title}`).join('\n')

    const result = await callAgent<ClaudeNewsScore>({
      system: `You are a crypto/macro news-impact scorer. Given a list of recent headlines and a proposed LONG trade on ${instrument}, output a JSON {"score": number from -100 to +100, "rationale": short string under 120 chars}.

  -100 = catastrophic for LONG (regulatory crackdown, exchange hack, war, hard rate hike)
  -40  = clearly negative (negative ETF flow, large miner sell-off, hawkish Fed surprise)
   0   = neutral / mixed / no relevant news
  +40  = clearly positive (institutional adoption, dovish surprise, supply shock)
  +100 = euphoria-grade catalyst (ETF approval, halving completion, debasement panic)

  Be CONSERVATIVE — only assign |score| > 40 when the news clearly drives short-term price.`,
      user: `Trade: LONG ${instrument} in next 1-4h. Recent headlines (last ${withinMinutes}min):\n${headlinesText}\n\nReturn JSON only.`,
      maxTokens: 200,
      timeoutMs: 12000,
      expectJson: true,
    })

    const score = Math.max(-100, Math.min(100, Math.round(result.score ?? 0)))
    const allowed = score > -40

    return {
      allowed,
      score,
      reason: result.rationale ?? (allowed ? 'no veto' : 'news veto'),
      headlineCount: scoped.length,
      topHeadlines: scoped.slice(0, 4).map(h => h.title),
    }
  } catch (e) {
    return {
      allowed: true,
      score: 0,
      reason: `news-scorer error (fail-open): ${String(e).slice(0, 80)}`,
      headlineCount: 0,
      topHeadlines: [],
    }
  }
}
