/**
 * Replace stale MATIC/USD candles (MATICUSDT frozen at 2024-09-10) with
 * live POL data (POLUSDT, the renamed Polygon token).
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

console.log('1) Deleting stale MATIC/USD candles (frozen 2024-09-10)...')
const delRes = await fetch(`${URL}/rest/v1/price_history?symbol=eq.${encodeURIComponent('MATIC/USD')}`, {
  method: 'DELETE',
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'return=representation' },
})
if (!delRes.ok) { console.error(delRes.status, await delRes.text()); process.exit(1) }
const deleted = await delRes.json()
console.log(`   deleted ${deleted.length} rows`)

console.log('2) Seeding POL (POLUSDT) 500 x 1h + 200 x 4h as MATIC/USD...')
for (const interval of ['1h', '4h']) {
  const limit = interval === '1h' ? 500 : 200
  const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=POLUSDT&interval=${interval}&limit=${limit}`)
  const klines = await r.json()
  const rows = klines.map(k => ({
    symbol: 'MATIC/USD',
    open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
    interval,
    timestamp: new Date(k[0]).toISOString(),
  }))
  for (let i = 0; i < rows.length; i += 200) {
    const up = await fetch(`${URL}/rest/v1/price_history?on_conflict=symbol,interval,timestamp`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(i, i+200)),
    })
    if (!up.ok) { console.error(up.status, (await up.text()).slice(0,200)); process.exit(1) }
  }
  console.log(`   ${interval}: ${rows.length} candles, latest=${rows.at(-1).timestamp}`)
}

console.log('\nDone.')
