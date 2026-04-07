/**
 * World State Builder — Live macro/geopolitical context for War Room agents.
 *
 * Fetches VIX, DXY, Bond yields, economic calendar, and news headlines
 * so agents never trade blind. All sources are free/public APIs.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MacroSnapshot {
  vix:          number | null
  vixTrend:     'rising' | 'falling' | 'stable' | null
  dxy:          number | null
  dxyChange:    number | null
  us10y:        number | null
  us02y:        number | null
  yieldCurve:   'normal' | 'inverted' | 'flat' | null
  goldPrice:    number | null
  oilWTI:       number | null
  fearGreed:    number | null
  fearLabel:    string | null
  spyChange:    number | null
  qqqChange:    number | null
  upcomingEvents: EconEvent[]
  headlines:    string[]
  riskLevel:    'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'
  noTradeReason: string | null
  timestamp:    string
}

export interface EconEvent {
  title: string
  country: string
  impact: 'low' | 'medium' | 'high'
  date: string
  time: string
}

// ─── Yahoo Finance helpers ───────────────────────────────────────────────────

async function fetchYahooQuote(symbol: string): Promise<{ price: number; prevClose: number; change: number } | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 300 } }
    )
    if (!res.ok) return null
    const data = await res.json()
    const meta = data?.chart?.result?.[0]?.meta
    if (!meta) return null
    const price = meta.regularMarketPrice ?? 0
    const prevClose = meta.previousClose ?? price
    return { price, prevClose, change: prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0 }
  } catch { return null }
}

async function fetchYahooHistory(symbol: string, days = 5): Promise<number[]> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${days}d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 600 } }
    )
    if (!res.ok) return []
    const data = await res.json()
    const closes: number[] = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []
    return closes.filter((c: number | null) => c != null)
  } catch { return [] }
}

// ─── Economic Calendar (Forex Factory) ───────────────────────────────────────

async function fetchEconomicCalendar(): Promise<EconEvent[]> {
  try {
    const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return []
    const events = await res.json() as Array<{
      title: string; country: string; impact: string; date: string; time?: string
    }>

    const now = new Date()
    const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    return events
      .filter(e => {
        const eventDate = new Date(e.date)
        return eventDate >= now && eventDate <= next24h
      })
      .map(e => ({
        title: e.title,
        country: e.country,
        impact: (e.impact === 'High' ? 'high' : e.impact === 'Medium' ? 'medium' : 'low') as EconEvent['impact'],
        date: e.date,
        time: e.time ?? '',
      }))
      .slice(0, 10)
  } catch { return [] }
}

// ─── News Headlines (free RSS proxy) ─────────────────────────────────────────

async function fetchNewsHeadlines(): Promise<string[]> {
  const feeds = [
    'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang=en-US',
  ]

  const headlines: string[] = []

  for (const url of feeds) {
    try {
      const res = await fetch(url, { next: { revalidate: 900 } })
      if (!res.ok) continue
      const text = await res.text()
      const titleMatches = text.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/g)
      if (titleMatches) {
        for (const m of titleMatches.slice(1, 8)) {
          const clean = m.replace(/<title><!\[CDATA\[/, '').replace(/\]\]><\/title>/, '').trim()
          if (clean) headlines.push(clean)
        }
      }
    } catch { continue }
  }

  return headlines.slice(0, 10)
}

// ─── Risk Level Calculator ───────────────────────────────────────────────────

function computeRiskLevel(vix: number | null, fearGreed: number | null, highImpactEvents: number): {
  level: MacroSnapshot['riskLevel']
  noTradeReason: string | null
} {
  let score = 0

  if (vix != null) {
    if (vix > 35) score += 3
    else if (vix > 25) score += 2
    else if (vix > 20) score += 1
  }

  if (fearGreed != null) {
    if (fearGreed <= 15) score += 2
    else if (fearGreed <= 25) score += 1
    if (fearGreed >= 85) score += 1
  }

  if (highImpactEvents > 0) score += 2

  let noTradeReason: string | null = null
  if (vix != null && vix > 40) noTradeReason = `VIX at ${vix} — extreme volatility, avoid new positions`
  if (highImpactEvents >= 2) noTradeReason = `${highImpactEvents} high-impact events in next 24h — wait for clarity`

  const level: MacroSnapshot['riskLevel'] =
    score >= 5 ? 'EXTREME' : score >= 3 ? 'HIGH' : score >= 2 ? 'MEDIUM' : 'LOW'

  return { level, noTradeReason }
}

// ─── Main Builder ────────────────────────────────────────────────────────────

export async function buildMacroContext(): Promise<MacroSnapshot> {
  const [vixQ, dxyQ, us10yQ, us02yQ, goldQ, oilQ, spyQ, qqqQ, vixHist, events, headlines, fngRes] =
    await Promise.allSettled([
      fetchYahooQuote('^VIX'),
      fetchYahooQuote('DX-Y.NYB'),
      fetchYahooQuote('^TNX'),
      fetchYahooQuote('^TWO'),
      fetchYahooQuote('GC=F'),
      fetchYahooQuote('CL=F'),
      fetchYahooQuote('SPY'),
      fetchYahooQuote('QQQ'),
      fetchYahooHistory('^VIX', 5),
      fetchEconomicCalendar(),
      fetchNewsHeadlines(),
      fetch('https://api.alternative.me/fng/?limit=1').then(r => r.json()).catch(() => null),
    ])

  const vix = vixQ.status === 'fulfilled' ? vixQ.value?.price ?? null : null
  const dxy = dxyQ.status === 'fulfilled' ? dxyQ.value?.price ?? null : null
  const dxyChange = dxyQ.status === 'fulfilled' ? dxyQ.value?.change ?? null : null
  const us10y = us10yQ.status === 'fulfilled' ? us10yQ.value?.price ?? null : null
  const us02y = us02yQ.status === 'fulfilled' ? us02yQ.value?.price ?? null : null
  const gold = goldQ.status === 'fulfilled' ? goldQ.value?.price ?? null : null
  const oil = oilQ.status === 'fulfilled' ? oilQ.value?.price ?? null : null
  const spyChange = spyQ.status === 'fulfilled' ? spyQ.value?.change ?? null : null
  const qqqChange = qqqQ.status === 'fulfilled' ? qqqQ.value?.change ?? null : null

  const vixHistory = vixHist.status === 'fulfilled' ? vixHist.value : []
  let vixTrend: MacroSnapshot['vixTrend'] = null
  if (vixHistory.length >= 3 && vix != null) {
    const avg = vixHistory.slice(-3).reduce((a, b) => a + b, 0) / 3
    vixTrend = vix > avg * 1.05 ? 'rising' : vix < avg * 0.95 ? 'falling' : 'stable'
  }

  let yieldCurve: MacroSnapshot['yieldCurve'] = null
  if (us10y != null && us02y != null) {
    const spread = us10y - us02y
    yieldCurve = spread < -0.1 ? 'inverted' : spread > 0.3 ? 'normal' : 'flat'
  }

  const fngData = fngRes.status === 'fulfilled' ? fngRes.value : null
  const fearGreed = fngData?.data?.[0] ? parseInt(fngData.data[0].value) : null
  const fearLabel = fngData?.data?.[0]?.value_classification ?? null

  const calendarEvents = events.status === 'fulfilled' ? events.value : []
  const newsHeadlines = headlines.status === 'fulfilled' ? headlines.value : []
  const highImpactCount = calendarEvents.filter(e => e.impact === 'high').length

  const { level, noTradeReason } = computeRiskLevel(vix, fearGreed, highImpactCount)

  return {
    vix, vixTrend, dxy, dxyChange, us10y, us02y, yieldCurve,
    goldPrice: gold, oilWTI: oil, fearGreed, fearLabel,
    spyChange, qqqChange,
    upcomingEvents: calendarEvents,
    headlines: newsHeadlines,
    riskLevel: level,
    noTradeReason,
    timestamp: new Date().toISOString(),
  }
}

// ─── Human-readable summary for agent prompts ────────────────────────────────

export function formatMacroContext(m: MacroSnapshot): string {
  const lines: string[] = [
    `══ LIVE WORLD STATE (${new Date(m.timestamp).toUTCString()}) ══`,
    '',
    '── MARKET RISK INDICATORS ──',
    `VIX (Fear Index):     ${m.vix?.toFixed(1) ?? '?'} ${m.vixTrend ? `[${m.vixTrend}]` : ''}`,
    `DXY (US Dollar):      ${m.dxy?.toFixed(2) ?? '?'} (${m.dxyChange != null ? (m.dxyChange >= 0 ? '+' : '') + m.dxyChange.toFixed(2) + '%' : '?'})`,
    `US 10Y Yield:         ${m.us10y?.toFixed(2) ?? '?'}%`,
    `US 2Y Yield:          ${m.us02y?.toFixed(2) ?? '?'}%`,
    `Yield Curve:          ${m.yieldCurve ?? '?'} ${m.yieldCurve === 'inverted' ? '⚠️ RECESSION SIGNAL' : ''}`,
    `Fear & Greed:         ${m.fearGreed ?? '?'}/100 (${m.fearLabel ?? '?'})`,
    `Gold:                 $${m.goldPrice?.toFixed(0) ?? '?'}`,
    `WTI Oil:              $${m.oilWTI?.toFixed(2) ?? '?'}`,
    `SPY daily:            ${m.spyChange != null ? (m.spyChange >= 0 ? '+' : '') + m.spyChange.toFixed(2) + '%' : '?'}`,
    `QQQ daily:            ${m.qqqChange != null ? (m.qqqChange >= 0 ? '+' : '') + m.qqqChange.toFixed(2) + '%' : '?'}`,
    `RISK LEVEL:           ${m.riskLevel}${m.noTradeReason ? ` — ${m.noTradeReason}` : ''}`,
  ]

  if (m.upcomingEvents.length > 0) {
    lines.push('', '── ECONOMIC CALENDAR (next 24h) ──')
    for (const e of m.upcomingEvents) {
      const icon = e.impact === 'high' ? '🔴' : e.impact === 'medium' ? '🟡' : '⚪'
      lines.push(`  ${icon} ${e.country} ${e.time || ''} — ${e.title}`)
    }
  }

  if (m.headlines.length > 0) {
    lines.push('', '── MARKET NEWS ──')
    for (const h of m.headlines) {
      lines.push(`  • ${h}`)
    }
  }

  lines.push('')
  return lines.join('\n')
}
