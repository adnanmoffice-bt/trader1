// ─────────────────────────────────────────────────────────────────────────────
// Telegram inbound reader (separate from lib/telegram.ts which is outbound).
//
// We use the Telegram Bot API. The reader bot must be:
//   (a) added to the source group/channel (per operator 2026-05-13 +
//       2026-05-13b @Signalii26bot),
//   (b) Privacy Mode disabled via @BotFather (so it can see all group
//       messages, not just commands).
//
// 2026-05-13b — operator added a dedicated reader bot (@Signalii26bot)
// distinct from the outbound notifier bot. We now read
// TELEGRAM_SIGNALS_BOT_TOKEN preferentially, falling back to
// TELEGRAM_BOT_TOKEN for backward compatibility with the initial Phase 1
// deploy where the operator was using a single bot for both directions.
//
// IMPORTANT: keep the two bots separate going forward. Mixing inbound +
// outbound on one bot means a single token rotation kills both paths.
//
// getUpdates is a polling endpoint that returns updates queued for the bot
// since the last `offset`. We persist the last update_id we processed in
// `external_signal_cursors` so we never re-ingest a message and never
// double-execute a signal.
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN = process.env.TELEGRAM_SIGNALS_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN
const BASE = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null

export interface TelegramForwardInfo {
  from_chat_id: number | null
  from_chat_title: string | null
  from_chat_username: string | null
  from_chat_type: string | null   // 'channel' | 'supergroup' | 'group' | 'private' | null
  from_message_id: number | null
  signature: string | null        // forward_signature for channel posts that opt-in
}

export interface TelegramMessageBare {
  update_id: number
  message_id: number
  chat_id: number
  date_iso: string                // ISO-8601 UTC
  sender: string | null           // e.g. 'firstName lastName' or 'channelTitle'
  text: string                    // best-effort text content
  forward: TelegramForwardInfo | null   // populated when message is a forward
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

      // Forward info — Telegram exposes this in two shapes:
      //   - Newer API: forward_origin = { type, chat: {...}, message_id, signature }
      //   - Older API: forward_from_chat = {...}, forward_from_message_id, forward_signature
      // We accept either.
      let forward: TelegramForwardInfo | null = null
      const origin = msg.forward_origin as Record<string, unknown> | undefined
      const legacyChat = msg.forward_from_chat as Record<string, unknown> | undefined
      const chatRef = (origin?.chat as Record<string, unknown> | undefined) ?? legacyChat
      if (chatRef) {
        forward = {
          from_chat_id: Number(chatRef.id ?? 0) || null,
          from_chat_title: (chatRef.title as string | undefined) ?? null,
          from_chat_username: (chatRef.username as string | undefined) ?? null,
          from_chat_type: (chatRef.type as string | undefined) ?? (origin?.type as string | undefined) ?? null,
          from_message_id: Number(origin?.message_id ?? msg.forward_from_message_id ?? 0) || null,
          signature: (origin?.author_signature as string | undefined) ?? (msg.forward_signature as string | undefined) ?? null,
        }
      }

      out.push({
        update_id: updateId,
        message_id: Number(msg.message_id ?? 0),
        chat_id: chatId,
        date_iso,
        sender,
        text,
        forward,
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

export const PARSER_VERSION = 'v1-signal-feed-2026-05-13'

export interface ParsedSignal {
  instrument: string                                // normalised, e.g. 'BTC/USD'
  direction: 'long' | 'short'
  entry: number | null
  entry_low: number | null                          // if a range was given
  entry_high: number | null
  stop_loss: number | null
  take_profit: number | null                        // TP1 (closest, most likely to hit)
  tp2: number | null
  tp3: number | null
  tp4: number | null
  lots_per_1000: number | null                      // optional sizing hint
  format: 'signal-feed' | 'generic'
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

// Match one number, anchored to a label, with optional sign annotation
// after the price (e.g. "TP1: 4692 +65" → grabs 4692 and ignores +65 because
// the [^\d.-]* prefix before the value consumes the colon/space, and the
// capture stops at whitespace).
function numAfter(text: string, labelRegex: RegExp): number | null {
  const m = text.match(labelRegex)
  if (!m) return null
  // First captured group is the price string.
  return num(m[1])
}

/**
 * Best-effort parser for structured signals from Telegram. Returns null when:
 *   - direction (long/short/buy/sell) cannot be inferred
 *   - instrument is unrecognised
 *
 * Handles two families of formats:
 *
 *   A. Signal Feed channel format (multi-line, primary target as of 2026-05-13b):
 *       🔴 XAUUSD SELL
 *       📌 Entry: 4699 – 4698
 *       🎯 TP1: 4692 +65
 *       🎯 TP2: 4686 +125
 *       🎯 TP3: 4683 +155
 *       🎯 TP4: 4680 +185
 *       🛡 SL: 4706.5 -80
 *       ⚖ 0.10 lots per $1000
 *
 *   B. Generic one-line variants kept for fallback:
 *       "BUY BTC/USD @ 80000 SL 79000 TP 82000"
 *       "LONG ETH 2300 Stop: 2250 Target: 2400"
 *       "🟢 #BTCUSDT Entry: 80000 Stop loss: 79000 TP1: 82000"
 *       "SHORT XAUUSD 4700 sl 4730 tp 4640"
 *       "sell EURUSD entry 1.1750 SL 1.1800 TP 1.1650"
 */
export function parseStructuredSignal(text: string): ParsedSignal | null {
  // Normalise whitespace and unicode dashes to plain ASCII before lowercasing,
  // so '4699 – 4698' and '4699 — 4698' both work.
  const normalised = text.replace(/[–—−]/g, '-').replace(/\u00A0/g, ' ')
  const t = normalised.toLowerCase()

  // ── Direction ──────────────────────────────────────────────────────────────
  // Word-bounded match for keywords + naked search for emoji (\b doesn't
  // work around emoji codepoints).
  let direction: 'long' | 'short' | null = null
  if (/\b(long|buy|bull)\b/.test(t) || /🟢|🟩|✅/.test(text)) direction = 'long'
  else if (/\b(short|sell|bear)\b/.test(t) || /🔴|🟥|❌/.test(text)) direction = 'short'
  if (!direction) return null

  // ── Instrument ─────────────────────────────────────────────────────────────
  // Tokenise on whitespace + common punctuation, KEEPING slashes inside
  // tokens so 'BTC/USD' stays whole. Strip leading $, #, @, brackets.
  let instrument: string | null = null
  for (const tokRaw of normalised.split(/[\s,;:()[\]{}!?"'`]+/g)) {
    const tok = tokRaw.replace(/^[#$@]+/, '').replace(/[#$@]+$/, '')
    if (!tok) continue
    const norm = normaliseInstrument(tok)
    if (norm) { instrument = norm; break }
  }
  if (!instrument) return null

  // ── Entry ─────────────────────────────────────────────────────────────────
  // Detect "Entry: A - B" range first (preserve both ends), fall back to a
  // single value. The label can be 'entry', 'enter', '@', 'price' or just a
  // direction keyword followed by a number.
  let entry_low: number | null = null
  let entry_high: number | null = null
  let entry: number | null = null

  // Match an "Entry: X - Y" range. Capture two prices separated by hyphen
  // (after we already normalised en/em dashes to hyphens above).
  const rangeMatch = t.match(/(?:entry|enter|@|price)[^\d-]*([\d,.]+)\s*-\s*([\d,.]+)/)
  if (rangeMatch) {
    const a = num(rangeMatch[1])
    const b = num(rangeMatch[2])
    if (a != null && b != null) {
      entry_low = Math.min(a, b)
      entry_high = Math.max(a, b)
      // For execution, use the side closer to the direction:
      //   LONG → buy near the low end of the range
      //   SHORT → sell near the high end
      entry = direction === 'long' ? entry_low : entry_high
    }
  }

  if (entry == null) {
    entry = numAfter(t, /(?:entry|enter|@|price)[^\d-]*([\d,.]+)/)
         ?? numAfter(t, /(?:long|short|buy|sell)\s+\S+\s+(?:at\s+|@\s*)?([\d,.]+)/)
  }

  // ── Stop loss ─────────────────────────────────────────────────────────────
  // "🛡 SL: 4706.5 -80" — anchor on SL/stop, take the first number, ignore
  // the trailing pip annotation (the next non-digit char ends our capture).
  const stop_loss = numAfter(t, /(?:^|\s)(?:sl|stop[\s-]*loss|stop)[^\d-]*([\d,.]+)/m)

  // ── Take profits ──────────────────────────────────────────────────────────
  // Up to 4 levels. TP1 is what the executor uses; TP2-4 are preserved for
  // future partial-fill / scale-out logic.
  const tp1 = numAfter(t, /(?:^|\s)(?:tp1?|target1?|take[\s-]*profit)[^\d-]*([\d,.]+)/m)
  const tp2 = numAfter(t, /\btp2\b[^\d-]*([\d,.]+)/)
  const tp3 = numAfter(t, /\btp3\b[^\d-]*([\d,.]+)/)
  const tp4 = numAfter(t, /\btp4\b[^\d-]*([\d,.]+)/)

  // ── Lot-sizing hint ───────────────────────────────────────────────────────
  // "0.10 lots per $1000" — preserved as a sizing parameter for the executor.
  const lotsMatch = t.match(/([\d.]+)\s*lots?\s*per\s*\$?\s*(\d[\d,]*)/)
  let lots_per_1000: number | null = null
  if (lotsMatch) {
    const lots = num(lotsMatch[1])
    const per = num(lotsMatch[2])
    if (lots != null && per != null && per > 0) {
      lots_per_1000 = (lots / per) * 1000
    }
  }

  // Sanity: lever the signal against the SL direction. A LONG signal whose
  // "SL" is ABOVE entry, or a SHORT whose "SL" is BELOW entry, indicates a
  // mis-parse (entry/SL fields swapped). Reject the parse rather than fire
  // a backwards order.
  if (entry != null && stop_loss != null) {
    if (direction === 'long' && stop_loss >= entry) return null
    if (direction === 'short' && stop_loss <= entry) return null
  }

  // Same for TP1: must be on the profit side.
  if (entry != null && tp1 != null) {
    if (direction === 'long' && tp1 <= entry) return null
    if (direction === 'short' && tp1 >= entry) return null
  }

  const format: 'signal-feed' | 'generic' = (entry_low != null && entry_high != null && (tp2 != null || tp3 != null)) ? 'signal-feed' : 'generic'

  return {
    instrument,
    direction,
    entry,
    entry_low,
    entry_high,
    stop_loss,
    take_profit: tp1,
    tp2,
    tp3,
    tp4,
    lots_per_1000,
    format,
  }
}
