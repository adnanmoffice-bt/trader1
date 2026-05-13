// ─────────────────────────────────────────────────────────────────────────────
// Telegram inbound reader (separate from lib/telegram.ts which is outbound).
//
// We use the Telegram Bot API. The bot must be:
//   (a) added to the source group/channel (already done per operator 2026-05-13),
//   (b) Privacy Mode disabled via @BotFather (so it can see all group messages,
//       not just commands).
//
// getUpdates is a polling endpoint that returns updates queued for the bot
// since the last `offset`. We persist the last update_id we processed in
// `external_signal_cursors` so we never re-ingest a message and never
// double-execute a signal.
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const BASE = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null

export interface TelegramMessageBare {
  update_id: number
  message_id: number
  chat_id: number
  date_iso: string                // ISO-8601 UTC
  sender: string | null           // e.g. 'firstName lastName' or 'channelTitle'
  text: string                    // best-effort text content
  raw: Record<string, unknown>    // full update object for forensics
}

export interface TelegramFetchResult {
  ok: boolean
  newUpdates: TelegramMessageBare[]
  lastUpdateId: number
  error?: string
}

/**
 * Pull all new updates from the bot since `sinceUpdateId`.
 * Returns only messages from `chatIdFilter` (so we can ignore updates from
 * other chats this bot is in, e.g. our own notification chat).
 *
 * NOTE: getUpdates pages internally — we follow the pagination via the
 * returned `update_id` until the API returns an empty page.
 */
export async function fetchTelegramUpdates(opts: {
  sinceUpdateId: number
  chatIdFilter: number
  maxPages?: number
}): Promise<TelegramFetchResult> {
  if (!BASE) {
    return { ok: false, newUpdates: [], lastUpdateId: opts.sinceUpdateId, error: 'TELEGRAM_BOT_TOKEN not configured' }
  }

  const out: TelegramMessageBare[] = []
  let offset = opts.sinceUpdateId + 1
  let lastUpdateId = opts.sinceUpdateId
  const maxPages = opts.maxPages ?? 5  // 100 updates/page × 5 = 500 messages/cron tick

  for (let page = 0; page < maxPages; page++) {
    const url = `${BASE}/getUpdates?offset=${offset}&limit=100&timeout=0&allowed_updates=${encodeURIComponent(JSON.stringify(['message', 'channel_post', 'edited_message', 'edited_channel_post']))}`
    let resp: Response
    try {
      resp = await fetch(url, { method: 'GET' })
    } catch (e) {
      return { ok: false, newUpdates: out, lastUpdateId, error: `network error: ${String(e)}` }
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      return { ok: false, newUpdates: out, lastUpdateId, error: `HTTP ${resp.status}: ${body.slice(0, 200)}` }
    }

    let body: { ok: boolean; result?: unknown[]; description?: string }
    try {
      body = await resp.json() as typeof body
    } catch {
      return { ok: false, newUpdates: out, lastUpdateId, error: 'invalid JSON from Telegram' }
    }
    if (!body.ok) {
      return { ok: false, newUpdates: out, lastUpdateId, error: body.description ?? 'unknown Telegram error' }
    }
    const updates = Array.isArray(body.result) ? body.result as Array<Record<string, unknown>> : []
    if (updates.length === 0) break

    for (const upd of updates) {
      const updateId = Number(upd.update_id)
      if (Number.isFinite(updateId)) {
        lastUpdateId = Math.max(lastUpdateId, updateId)
        offset = Math.max(offset, updateId + 1)
      }

      const msg = (upd.message ?? upd.channel_post ?? upd.edited_message ?? upd.edited_channel_post) as Record<string, unknown> | undefined
      if (!msg) continue

      const chat = msg.chat as Record<string, unknown> | undefined
      const chatId = Number(chat?.id ?? 0)
      if (chatId !== opts.chatIdFilter) continue

      const text = String(msg.text ?? msg.caption ?? '').trim()
      if (!text) continue

      const fromObj = msg.from as Record<string, unknown> | undefined
      const sender = fromObj
        ? `${fromObj.first_name ?? ''} ${fromObj.last_name ?? ''}`.trim() || String(fromObj.username ?? '') || null
        : String(chat?.title ?? null) || null

      const dateSec = Number(msg.date ?? 0)
      const date_iso = dateSec > 0 ? new Date(dateSec * 1000).toISOString() : new Date().toISOString()

      out.push({
        update_id: updateId,
        message_id: Number(msg.message_id ?? 0),
        chat_id: chatId,
        date_iso,
        sender,
        text,
        raw: upd,
      })
    }

    if (updates.length < 100) break  // last page
  }

  return { ok: true, newUpdates: out, lastUpdateId }
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser stub — final form lands after operator pastes 3-5 real examples
// (per 2026-05-13 operator decision: "build_after_first").
//
// This parser handles the MOST COMMON structured forms. Anything it cannot
// match returns null and the row gets parse_status='unparseable'.
// ─────────────────────────────────────────────────────────────────────────────

export const PARSER_VERSION = 'v0-generic-2026-05-13'

export interface ParsedSignal {
  instrument: string                                // normalised, e.g. 'BTC/USD'
  direction: 'long' | 'short'
  entry: number | null
  stop_loss: number | null
  take_profit: number | null
}

// Normalise common ticker spellings → instrument keys used by lib/exchanges/index.ts
const INSTRUMENT_ALIASES: Record<string, string> = {
  BTC: 'BTC/USD',     BTCUSD: 'BTC/USD',    BTCUSDT: 'BTC/USD',   'BTC/USDT': 'BTC/USD',  'BTC/USD': 'BTC/USD',
  ETH: 'ETH/USD',     ETHUSD: 'ETH/USD',    ETHUSDT: 'ETH/USD',   'ETH/USDT': 'ETH/USD',  'ETH/USD': 'ETH/USD',
  XAU: 'XAU/USD',     XAUUSD: 'XAU/USD',    GOLD: 'XAU/USD',      'XAU/USD': 'XAU/USD',
  XAG: 'XAG/USD',     XAGUSD: 'XAG/USD',    SILVER: 'XAG/USD',    'XAG/USD': 'XAG/USD',
  WTI: 'WTI',         CL: 'WTI',            USOIL: 'WTI',
  BRENT: 'BRENT',     UKOIL: 'BRENT',       BCO: 'BRENT',
  EURUSD: 'EUR/USD',  'EUR/USD': 'EUR/USD',
  GBPUSD: 'GBP/USD',  'GBP/USD': 'GBP/USD',
  USDJPY: 'USD/JPY',  'USD/JPY': 'USD/JPY',
  SPY: 'SPY',         SP500: 'SPY',         SPX: 'SPY',
  QQQ: 'QQQ',         NDX: 'QQQ',           NAS100: 'QQQ',
}

function normaliseInstrument(raw: string): string | null {
  const k = raw.toUpperCase().replace(/[\s$_-]/g, '')
  return INSTRUMENT_ALIASES[k] ?? null
}

function num(s: string | undefined): number | null {
  if (!s) return null
  const cleaned = s.replace(/[, ]/g, '').replace(/[^\d.\-]/g, '')
  const v = parseFloat(cleaned)
  return Number.isFinite(v) ? v : null
}

/**
 * Best-effort parser for structured signals. Returns null when:
 *   - direction (long/short/buy/sell) cannot be inferred
 *   - instrument is unrecognised
 *
 * Examples it matches:
 *   "BUY BTC/USD @ 80000 SL 79000 TP 82000"
 *   "LONG ETH 2300 Stop: 2250 Target: 2400"
 *   "🟢 #BTCUSDT Entry: 80000 Stop loss: 79000 TP1: 82000"
 *   "SHORT XAUUSD 4700 sl 4730 tp 4640"
 */
export function parseStructuredSignal(text: string): ParsedSignal | null {
  const t = text.toLowerCase()

  // Word-bounded match for keywords + naked search for emoji (\b doesn't
  // work around emoji codepoints).
  let direction: 'long' | 'short' | null = null
  if (/\b(long|buy|bull)\b/.test(t) || /🟢|🟩|✅/.test(text)) direction = 'long'
  else if (/\b(short|sell|bear)\b/.test(t) || /🔴|🟥|❌/.test(text)) direction = 'short'
  if (!direction) return null

  // Tokenise on whitespace + common punctuation, KEEPING slashes inside
  // tokens so 'BTC/USD' stays whole. Strip leading $, #, @, brackets.
  let instrument: string | null = null
  const tokens = text.split(/[\s,;:()[\]{}!?"'`]+/g)
  for (const tokRaw of tokens) {
    const tok = tokRaw.replace(/^[#$@]+/, '').replace(/[#$@]+$/, '')
    if (!tok) continue
    const norm = normaliseInstrument(tok)
    if (norm) { instrument = norm; break }
  }
  if (!instrument) return null

  const entry = num((t.match(/(?:entry|enter|@|price)[^\d-]*([\d,.]+)/) ?? [])[1])
                ?? num((t.match(/(?:long|short|buy|sell)\s+\S+\s+(?:at\s+|@\s*)?([\d,.]+)/) ?? [])[1])

  const stop_loss = num((t.match(/(?:sl|stop[\s-]*loss|stop)[^\d-]*([\d,.]+)/) ?? [])[1])

  const take_profit = num((t.match(/(?:tp1?|target|take[\s-]*profit)[^\d-]*([\d,.]+)/) ?? [])[1])

  return { instrument, direction, entry, stop_loss, take_profit }
}
