/**
 * scripts/setup-telegram-webhook.mjs
 *
 * Registers (or removes) the Telegram webhook for the signals reader bot.
 *
 * USAGE:
 *
 *   # Register:
 *   node scripts/setup-telegram-webhook.mjs set https://your-vercel-domain.vercel.app
 *
 *   # Inspect current state:
 *   node scripts/setup-telegram-webhook.mjs info
 *
 *   # Remove (fall back to cron-based getUpdates polling):
 *   node scripts/setup-telegram-webhook.mjs delete
 *
 * Reads from .env.local:
 *   TELEGRAM_SIGNALS_BOT_TOKEN   (preferred) or TELEGRAM_BOT_TOKEN
 *   TELEGRAM_WEBHOOK_SECRET      (required for 'set'; random 32+ char string)
 *
 * Notes:
 *   - You CANNOT have both setWebhook AND getUpdates polling active at once.
 *     If a webhook is registered, the cron ingestor will start getting
 *     "Conflict: terminated by other getUpdates request" errors. Either
 *     remove the webhook OR comment out the telegram-ingestor cron in
 *     vercel.json.
 *   - The secret_token is sent by Telegram on every inbound POST as the
 *     `X-Telegram-Bot-Api-Secret-Token` header. The webhook handler rejects
 *     any POST without a matching value.
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

const TOKEN = process.env.TELEGRAM_SIGNALS_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET
if (!TOKEN) {
  console.error('Missing TELEGRAM_SIGNALS_BOT_TOKEN (or TELEGRAM_BOT_TOKEN) in env.')
  process.exit(1)
}

const args = process.argv.slice(2)
const cmd = args[0] ?? 'info'

async function tg(method, body) {
  const url = `https://api.telegram.org/bot${TOKEN}/${method}`
  const res = await fetch(url, body ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } : undefined)
  const json = await res.json()
  if (!json.ok) throw new Error(`${method} → ${JSON.stringify(json)}`)
  return json.result
}

if (cmd === 'info') {
  const r = await tg('getWebhookInfo')
  console.log(JSON.stringify(r, null, 2))
  process.exit(0)
}

if (cmd === 'delete') {
  const r = await tg('deleteWebhook', { drop_pending_updates: false })
  console.log('Webhook removed:', r)
  console.log('Cron-based ingestor (getUpdates) will resume on next run.')
  process.exit(0)
}

if (cmd === 'set') {
  const baseUrl = args[1]
  if (!baseUrl) {
    console.error('Missing base URL. Example:\n  node scripts/setup-telegram-webhook.mjs set https://apex-trading.vercel.app')
    process.exit(1)
  }
  if (!SECRET) {
    console.error('Missing TELEGRAM_WEBHOOK_SECRET in env.\nGenerate one (any 32+ random chars) and set it in .env.local AND on Vercel.')
    process.exit(1)
  }
  const webhookUrl = baseUrl.replace(/\/+$/, '') + '/api/telegram/webhook'
  const r = await tg('setWebhook', {
    url: webhookUrl,
    secret_token: SECRET,
    allowed_updates: ['message', 'channel_post', 'edited_message', 'edited_channel_post'],
    drop_pending_updates: false,
    max_connections: 40,
  })
  console.log('Webhook registered:', webhookUrl)
  console.log('Result:', r)
  console.log('\nNext: confirm /api/cron/telegram-ingestor is removed from vercel.json')
  console.log('      (cannot run webhook AND getUpdates polling at the same time).')
  process.exit(0)
}

console.error(`Unknown command: ${cmd}\nUsage:\n  setup-telegram-webhook.mjs info\n  setup-telegram-webhook.mjs set <base-url>\n  setup-telegram-webhook.mjs delete`)
process.exit(1)
