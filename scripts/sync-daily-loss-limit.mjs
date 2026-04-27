#!/usr/bin/env node
// One-shot: align user_settings.daily_loss_limit_pct with lib/safety.ts (5%).
// History: lib/safety.ts moved 3 → 5 in commit be92ffce on 2026-04-23 but DB
// kept the old default. lib/risk-controls.ts was aligned on 2026-04-24 in
// commit 552f516. This closes the loop on the DB row.

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
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

const before = await fetch(`${URL}/rest/v1/user_settings?select=user_id,daily_loss_limit_pct`, { headers }).then(r => r.json())
console.log('BEFORE:', JSON.stringify(before, null, 2))

const upd = await fetch(`${URL}/rest/v1/user_settings?daily_loss_limit_pct=eq.3`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ daily_loss_limit_pct: 5 }),
}).then(r => r.json())
console.log('UPDATED:', JSON.stringify(upd, null, 2))

const after = await fetch(`${URL}/rest/v1/user_settings?select=user_id,daily_loss_limit_pct`, { headers }).then(r => r.json())
console.log('AFTER:', JSON.stringify(after, null, 2))
