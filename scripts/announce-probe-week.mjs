#!/usr/bin/env node
// One-shot WhatsApp announcement for PROBE WEEK activation.
// Sends a single message to the configured Green API group and exits.

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

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// Resolve config from user_settings first, fall back to env.
let cfg = null
if (SUPA_URL && SUPA_KEY) {
  const r = await fetch(`${SUPA_URL}/rest/v1/user_settings?select=whatsapp_instance_id,whatsapp_api_token,whatsapp_group_id&limit=1`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
  })
  const rows = r.ok ? await r.json() : []
  const row = rows?.[0]
  if (row?.whatsapp_instance_id && row?.whatsapp_api_token) {
    cfg = {
      instanceId: row.whatsapp_instance_id,
      apiToken: row.whatsapp_api_token,
      groupId: row.whatsapp_group_id,
      apiUrl: 'https://7107.api.greenapi.com',
    }
  }
}
if (!cfg) {
  cfg = {
    instanceId: process.env.GREEN_API_INSTANCE_ID,
    apiToken: process.env.GREEN_API_TOKEN,
    groupId: process.env.GREEN_API_GROUP_ID,
    apiUrl: process.env.GREEN_API_URL || 'https://7107.api.greenapi.com',
  }
}

if (!cfg.instanceId || !cfg.apiToken || !cfg.groupId) {
  console.error('No WhatsApp config (instance_id / api_token / group_id missing).')
  console.error('Either set GREEN_API_* env vars or populate user_settings.whatsapp_*.')
  process.exit(1)
}

const message = [
  'APEX PROBE WEEK — ACTIVE',
  '',
  'Real money trading is now ON for one week.',
  'Window: 09 May 2026 to 15 May 2026 (Dubai time).',
  '',
  'Risk per trade: 1.5% of $500 IG account = $7.50',
  'Daily loss limit: 5% = $25/day',
  'Weekly kill switch: $200 cumulative real loss',
  '   -> auto-flips to demo, requires manual reset',
  '',
  'Live-eligible: BTC, ETH, XAU, DOGE, AVAX, LINK, MATIC, NEAR, WTI, BRENT, EUR/USD, GBP/USD, USD/JPY',
  'Blocked from live: ADA, DOT, APT, XAG (data quality / scaling issues)',
  '',
  'Honest expectation:',
  '  60-70% probability of a losing week',
  '  ~5% probability of triggering the $200 kill',
  '  ~20% probability of green week',
  '',
  'Purpose: prove real fill quality and slippage on IG.',
  'Variance is the cost of real-money validation.',
  'Status reports every 2h. Daily audit at end of each Dubai day.',
].join('\n')

console.log('Sending announcement...')
const url = `${cfg.apiUrl}/waInstance${cfg.instanceId}/sendMessage/${cfg.apiToken}`
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chatId: cfg.groupId, message }),
})
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${await res.text()}`)
  process.exit(1)
}
const data = await res.json()
if (data?.idMessage) {
  console.log(`OK — message sent (id=${data.idMessage}).`)
} else {
  console.error('No idMessage in response:', JSON.stringify(data).slice(0, 300))
  process.exit(1)
}
