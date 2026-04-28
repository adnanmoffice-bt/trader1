/**
 * Trace overnight demo losses.
 * Portfolio went from W7/L16/$4940.05 → W7/L19/$4718.86 between 27/04 ~13:00 and
 * 28/04 ~09:45 Dubai. That's 3 fresh losses with 0 wins. The 24h audit shows no
 * trades opened OR closed inside the 24h window, so something doesn't add up.
 *
 * This pulls all demo_trades closed in the last 36h and the active session
 * to see what actually happened.
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
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }
const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString()
const tm = (iso) => iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', hour12: false }) : '—'

console.log(`=== TRACE OVERNIGHT (last 36h, since ${tm(since)} Dubai) ===\n`)

console.log('━━━ ACTIVE demo_session ━━━')
const sess = await fetch(`${URL}/rest/v1/demo_sessions?status=eq.running&order=created_at.desc&limit=1`, { headers }).then(r => r.json())
for (const s of sess) {
  console.log(`  id=${s.id}`)
  console.log(`  start=${s.start_date}  end=${s.end_date}`)
  console.log(`  initial=$${s.initial_capital}  final=$${s.final_capital}  pnl=$${s.total_pnl} (${s.total_pnl_pct}%)`)
  console.log(`  wins=${s.win_count}  losses=${s.loss_count}  total=${s.total_trades}`)
  console.log(`  maxDD=${s.max_drawdown}`)
}

console.log('\n━━━ portfolio (is_demo=false) ━━━')
const pf = await fetch(`${URL}/rest/v1/portfolio?is_demo=eq.false`, { headers }).then(r => r.json())
for (const p of pf) {
  console.log(`  capital=$${p.capital}  W${p.win_count}/L${p.loss_count}  realized=$${p.realized_pnl}  upd=${tm(p.updated_at)}`)
}

console.log('\n━━━ DEMO TRADES closed in last 36h ━━━')
const closed = await fetch(`${URL}/rest/v1/demo_trades?exit_time=gte.${since}&order=exit_time.desc&limit=50`, { headers }).then(r => r.json())
console.log(`  count=${closed.length}`)
for (const t of closed) {
  const pnl = Number(t.pnl ?? t.pnl_aed ?? 0)
  console.log(`  ${tm(t.exit_time)}  ${t.instrument.padEnd(10)} ${t.direction.padEnd(5)} entry=$${Number(t.entry_price).toFixed(2)} exit=$${Number(t.exit_price).toFixed(2)} reason=${t.exit_reason}  pnl=$${pnl.toFixed(2)} (${Number(t.pnl_pct ?? 0).toFixed(2)}%)`)
  console.log(`         opened ${tm(t.entry_time)}  conf=${t.confidence}  reason: ${(t.signal_reason || '').slice(0, 90)}`)
}

console.log('\n━━━ DEMO TRADES opened in last 36h ━━━')
const opened = await fetch(`${URL}/rest/v1/demo_trades?entry_time=gte.${since}&order=entry_time.desc&limit=50`, { headers }).then(r => r.json())
console.log(`  count=${opened.length}`)
for (const t of opened) {
  const pnl = t.pnl == null ? 'open' : `$${Number(t.pnl).toFixed(2)}`
  console.log(`  ${tm(t.entry_time)}  ${t.instrument.padEnd(10)} ${t.direction.padEnd(5)} entry=$${Number(t.entry_price).toFixed(2)} qty=${Number(t.quantity).toFixed(4)}  status=${t.exit_time ? t.exit_reason : 'OPEN'}  pnl=${pnl}`)
}

console.log('\n━━━ Currently OPEN demo trades ━━━')
const open = await fetch(`${URL}/rest/v1/demo_trades?exit_time=is.null&order=entry_time.desc`, { headers }).then(r => r.json())
console.log(`  count=${open.length}`)
for (const t of open) {
  console.log(`  ${tm(t.entry_time)}  ${t.instrument.padEnd(10)} ${t.direction.padEnd(5)} entry=$${Number(t.entry_price).toFixed(2)} SL=$${Number(t.stop_loss).toFixed(2)} TP=$${Number(t.take_profit).toFixed(2)} conf=${t.confidence}`)
}

console.log('\n━━━ All demo_sessions for context ━━━')
const allSess = await fetch(`${URL}/rest/v1/demo_sessions?order=created_at.desc&limit=10`, { headers }).then(r => r.json())
for (const s of allSess) {
  console.log(`  ${s.start_date} → ${s.end_date}  ${s.status}  ${s.win_count}W/${s.loss_count}L  pnl=$${Number(s.total_pnl||0).toFixed(2)}  capital=$${Number(s.final_capital||s.initial_capital).toFixed(2)}`)
}

console.log('\n=== DONE ===')
