/**
 * scripts/import-telegram-export.mjs
 *
 * One-shot importer for Telegram Desktop "Export chat history" JSON files.
 *
 * Telegram Bot API CANNOT read messages older than when the bot joined the
 * group. To collect historical signals, the operator must use Telegram
 * Desktop:
 *   ⋮ menu on group → Export chat history → choose Machine-readable JSON,
 *   uncheck media (photos, videos, voice, stickers). Save the resulting
 *   `result.json` somewhere reachable.
 *
 * Then run:
 *   node scripts/import-telegram-export.mjs path/to/result.json
 *
 * Optional flags:
 *   --source=<custom-source-tag>   defaults to telegram:<chat_id>
 *   --dry                          parse & report, do not write to DB
 *   --since=YYYY-MM-DD             skip messages before this date
 *   --limit=N                      stop after N inserts (testing)
 *
 * SAFETY:
 *   - Every imported row is written with execution_status='disabled'. Even
 *     if TELEGRAM_SIGNALS_EXECUTOR_ENABLED is true, historical messages
 *     never fire orders. (Phase 3 executor will additionally check
 *     message_date freshness, but defence-in-depth.)
 *   - Idempotent on UNIQUE (source, external_message_id). Re-runs skip
 *     existing rows.
 *
 * Read-only with respect to Telegram. Writes only to external_signals
 * and agent_logs.
 */
import fs from 'node:fs'
import path from 'node:path'

function loadEnvLocal() {
  const p = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(p)) return
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
}
loadEnvLocal()

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.')
  process.exit(1)
}
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

const argv = process.argv.slice(2)
const filePath = argv.find(a => !a.startsWith('--'))
if (!filePath) {
  console.error('Usage: node scripts/import-telegram-export.mjs <path-to-result.json> [--source=...] [--dry] [--since=YYYY-MM-DD] [--limit=N]')
  process.exit(1)
}
const flag = (name) => {
  const f = argv.find(a => a.startsWith(`--${name}=`))
  return f ? f.split('=').slice(1).join('=') : null
}
const has = (name) => argv.includes(`--${name}`)
const dryRun = has('dry')
const sinceISO = flag('since') ? new Date(flag('since')).toISOString() : null
const limit = flag('limit') ? Number(flag('limit')) : Infinity
const sourceOverride = flag('source')

console.log(`Reading ${filePath}${dryRun ? ' (DRY RUN — no DB writes)' : ''}`)
const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
const chatId = raw.id ?? raw.chat?.id ?? null
const source = sourceOverride || (chatId != null ? `telegram:${chatId}` : 'telegram:imported')
const messages = Array.isArray(raw.messages) ? raw.messages : []
console.log(`source=${source}  chat title="${raw.name ?? ''}"  total messages in file: ${messages.length}`)

// ── Inline parser ──────────────────────────────────────────────────────────
// We replicate lib/telegram-ingest.ts → parseStructuredSignal here to keep
// this script dependency-free (no TS transpile needed).
// Keep this block in sync if the live parser is updated.
const INSTRUMENT_ALIASES = {
  BTC: 'BTC/USD', BTCUSD: 'BTC/USD', BTCUSDT: 'BTC/USD', 'BTC/USDT': 'BTC/USD', 'BTC/USD': 'BTC/USD',
  ETH: 'ETH/USD', ETHUSD: 'ETH/USD', ETHUSDT: 'ETH/USD', 'ETH/USDT': 'ETH/USD', 'ETH/USD': 'ETH/USD',
  XAU: 'XAU/USD', XAUUSD: 'XAU/USD', GOLD: 'XAU/USD', 'XAU/USD': 'XAU/USD',
  XAG: 'XAG/USD', XAGUSD: 'XAG/USD', SILVER: 'XAG/USD', 'XAG/USD': 'XAG/USD',
  WTI: 'WTI', CL: 'WTI', USOIL: 'WTI',
  BRENT: 'BRENT', UKOIL: 'BRENT', BCO: 'BRENT',
  EURUSD: 'EUR/USD', 'EUR/USD': 'EUR/USD',
  GBPUSD: 'GBP/USD', 'GBP/USD': 'GBP/USD',
  USDJPY: 'USD/JPY', 'USD/JPY': 'USD/JPY',
  SPY: 'SPY', SP500: 'SPY', SPX: 'SPY',
  QQQ: 'QQQ', NDX: 'QQQ', NAS100: 'QQQ',
}
const PARSER_VERSION = 'v0-generic-2026-05-13-import'
function normaliseInstrument(rawTok) {
  const k = String(rawTok).toUpperCase().replace(/[\s$_-]/g, '')
  return INSTRUMENT_ALIASES[k] ?? null
}
function num(s) {
  if (!s) return null
  const cleaned = String(s).replace(/[, ]/g, '').replace(/[^\d.\-]/g, '')
  const v = parseFloat(cleaned)
  return Number.isFinite(v) ? v : null
}
function parseStructuredSignal(text) {
  if (!text) return null
  const t = String(text).toLowerCase()
  let direction = null
  if (/\b(long|buy|bull)\b/.test(t) || /🟢|🟩|✅/.test(text)) direction = 'long'
  else if (/\b(short|sell|bear)\b/.test(t) || /🔴|🟥|❌/.test(text)) direction = 'short'
  if (!direction) return null
  let instrument = null
  const tokens = String(text).split(/[\s,;:()[\]{}!?"'`]+/g)
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

// ── Telegram export message → text extractor ───────────────────────────────
// Export schema: each message has `text` which is either a string OR an
// array of mixed strings + objects like { type:'mention', text:'@x' }, etc.
function flattenText(t) {
  if (!t) return ''
  if (typeof t === 'string') return t
  if (Array.isArray(t)) return t.map(p => typeof p === 'string' ? p : (p?.text ?? '')).join('')
  if (typeof t === 'object' && typeof t.text === 'string') return t.text
  return ''
}

let totalSeen = 0
let totalSkipped = 0
let parsed = 0
let unparseable = 0
let inserted = 0
let dupes = 0
let errors = 0
const sample = []

const rowsBatch = []
async function flushBatch() {
  if (!rowsBatch.length) return
  if (dryRun) {
    inserted += rowsBatch.length
    rowsBatch.length = 0
    return
  }
  // PostgREST batch insert; Prefer: resolution=ignore-duplicates skips
  // unique-key conflicts silently. Returning=representation so we can count
  // how many actually landed.
  const resp = await fetch(`${URL}/rest/v1/external_signals`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation,resolution=ignore-duplicates' },
    body: JSON.stringify(rowsBatch),
  })
  if (!resp.ok) {
    errors += rowsBatch.length
    const body = await resp.text().catch(() => '')
    console.error(`  batch insert failed (${resp.status}): ${body.slice(0, 300)}`)
    rowsBatch.length = 0
    return
  }
  const result = await resp.json()
  const landed = Array.isArray(result) ? result.length : 0
  inserted += landed
  dupes += rowsBatch.length - landed
  rowsBatch.length = 0
}

for (const m of messages) {
  totalSeen++
  if (m.type !== 'message') { totalSkipped++; continue }
  const text = flattenText(m.text)
  if (!text.trim()) { totalSkipped++; continue }
  if (sinceISO && m.date && new Date(m.date).toISOString() < sinceISO) { totalSkipped++; continue }
  if (inserted >= limit) break

  const parsedSig = parseStructuredSignal(text)
  if (parsedSig) parsed++; else unparseable++
  if (sample.length < 5 && parsedSig) sample.push({ text: text.slice(0, 120), parsedSig })

  const msgDateIso = m.date ? new Date(m.date).toISOString() : null
  const row = {
    source,
    external_message_id: Number(m.id),
    message_date: msgDateIso,
    sender: m.from ?? m.actor ?? null,
    raw_text: text,
    metadata: { import_run: true, original_type: m.type, file: path.basename(filePath) },
    parse_status: parsedSig ? 'parsed' : 'unparseable',
    parsed: parsedSig,
    parser_version: PARSER_VERSION,
    instrument: parsedSig?.instrument ?? null,
    direction: parsedSig?.direction ?? null,
    entry_price: parsedSig?.entry ?? null,
    stop_loss: parsedSig?.stop_loss ?? null,
    take_profit: parsedSig?.take_profit ?? null,
    execution_status: 'disabled',   // historical rows NEVER execute
  }
  rowsBatch.push(row)
  if (rowsBatch.length >= 500) await flushBatch()
}
await flushBatch()

console.log('\n── import summary ──')
console.log(`  total messages in file : ${totalSeen}`)
console.log(`  skipped (non-message)  : ${totalSkipped}`)
console.log(`  parsed                 : ${parsed}`)
console.log(`  unparseable            : ${unparseable}`)
console.log(`  ${dryRun ? 'would-insert' : 'inserted (new) '}        : ${inserted}`)
console.log(`  duplicates skipped     : ${dupes}`)
console.log(`  insert errors          : ${errors}`)
if (sample.length) {
  console.log('\n  parsed sample (first 5):')
  for (const s of sample) console.log(`    "${s.text}"  →  ${JSON.stringify(s.parsedSig)}`)
}

if (!dryRun) {
  await fetch(`${URL}/rest/v1/agent_logs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      agent: 'telegram-import',
      level: errors ? 'warn' : 'ok',
      message: `imported ${inserted} rows (${parsed} parsed / ${unparseable} unparseable / ${dupes} dupes)`,
      metadata: { source, file: path.basename(filePath), totalSeen, totalSkipped, parsed, unparseable, inserted, dupes, errors },
    }),
  }).catch(() => {})
}
