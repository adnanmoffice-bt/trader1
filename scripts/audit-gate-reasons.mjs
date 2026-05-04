// Quick gate-stack rejection breakdown — counts every distinct reason in
// war_room_messages.data.reason for the last N hours. Companion to audit-10d.mjs.
//
// Usage: node scripts/audit-gate-reasons.mjs [hours=96]
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
const HOURS = Number(process.argv[2] || 96)
const since = new Date(Date.now() - HOURS * 3600 * 1000).toISOString()

async function getAll(table, qs, max = 50000) {
  const rows = []
  for (let off = 0; off < max; off += 1000) {
    const r = await fetch(`${URL}/rest/v1/${table}?${qs}&limit=1000&offset=${off}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    })
    if (!r.ok) return rows
    const j = await r.json()
    if (!Array.isArray(j) || j.length === 0) break
    rows.push(...j)
    if (j.length < 1000) break
  }
  return rows
}

console.log(`=== GATE-REJECTION BREAKDOWN (${HOURS}h) ===\n`)
const wr = await getAll(
  'war_room_messages',
  `created_at=gte.${since}&role=in.(blocked,decision,close)&select=role,instrument,data`,
)

const byRole = {}
const byReason = {}
const byReasonInstr = {}

for (const m of wr) {
  byRole[m.role] = (byRole[m.role] || 0) + 1
  const reason = m.data?.reason || m.data?.action || '(none)'
  byReason[reason] = (byReason[reason] || 0) + 1
  const k = `${reason} :: ${m.instrument}`
  byReasonInstr[k] = (byReasonInstr[k] || 0) + 1
}

console.log('--- by role ---')
for (const [r, n] of Object.entries(byRole).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${r.padEnd(12)} ${n}`)
}

console.log('\n--- by reason (top 30) ---')
const sortedReasons = Object.entries(byReason).sort((a, b) => b[1] - a[1])
const total = sortedReasons.reduce((a, [, n]) => a + n, 0)
for (const [r, n] of sortedReasons.slice(0, 30)) {
  const pct = total ? ((n / total) * 100).toFixed(1) : '0.0'
  console.log(`  ${r.padEnd(28)} ${n.toString().padStart(5)} (${pct}%)`)
}

console.log('\n--- top 20 (reason, instrument) pairs ---')
const sortedPairs = Object.entries(byReasonInstr).sort((a, b) => b[1] - a[1])
for (const [k, n] of sortedPairs.slice(0, 20)) {
  console.log(`  ${k.padEnd(50)} ${n}`)
}

console.log('\n--- over-tightening watch (any single gate > 80% on one instrument) ---')
const byInstr = {}
for (const m of wr) {
  if (!m.instrument) continue
  byInstr[m.instrument] = byInstr[m.instrument] || { total: 0, byReason: {} }
  byInstr[m.instrument].total++
  const reason = m.data?.reason || m.data?.action || '(none)'
  byInstr[m.instrument].byReason[reason] = (byInstr[m.instrument].byReason[reason] || 0) + 1
}
let flagged = 0
for (const [instr, info] of Object.entries(byInstr)) {
  for (const [reason, n] of Object.entries(info.byReason)) {
    const pct = (n / info.total) * 100
    if (pct > 80 && info.total >= 10) {
      console.log(`  FLAG: ${instr} ${reason} ${n}/${info.total} (${pct.toFixed(0)}%)`)
      flagged++
    }
  }
}
if (!flagged) console.log('  none flagged.')

console.log('\n=== DONE ===')
