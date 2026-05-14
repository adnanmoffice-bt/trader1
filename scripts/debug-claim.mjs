// Verify claimSignalRow path now works end-to-end. Inserts a synthetic
// pending row, attempts the claim, asserts execution_status='executing',
// then deletes the test row. No real money touched.
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
const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

const fakeMsgId = 999_000_000 + Math.floor(Math.random() * 1_000_000)
const insBody = {
  source: 'telegram:__claimtest__',
  external_message_id: fakeMsgId,
  message_date: new Date().toISOString(),
  raw_text: 'CLAIM-TEST — synthetic, do not execute',
  metadata: { test: true },
  parse_status: 'pending',
  execution_status: 'pending',
  parser_version: 'claim-test',
}
const ins = await fetch(`${URL}/rest/v1/external_signals`, {
  method: 'POST', headers, body: JSON.stringify(insBody),
})
const insRows = await ins.json()
console.log('insert status:', ins.status, 'id:', insRows[0]?.id)
const id = insRows[0]?.id
if (!id) process.exit(1)

const claim = await fetch(`${URL}/rest/v1/external_signals?id=eq.${id}&execution_status=eq.pending`, {
  method: 'PATCH', headers, body: JSON.stringify({ execution_status: 'executing' }),
})
console.log('claim status:', claim.status)
const claimedRows = await claim.json()
console.log('claimed:', JSON.stringify(claimedRows, null, 2))

await fetch(`${URL}/rest/v1/external_signals?id=eq.${id}`, { method: 'DELETE', headers })
console.log('cleanup ok')

if (claim.status !== 200 || !Array.isArray(claimedRows) || claimedRows.length !== 1) {
  console.log('VERIFY FAILED')
  process.exit(2)
}
console.log('VERIFY OK — claim now flips pending→executing successfully')
