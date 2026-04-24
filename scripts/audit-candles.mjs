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

async function countSymbol(sym) {
  const res = await fetch(`${URL}/rest/v1/price_history?select=timestamp&symbol=eq.${encodeURIComponent(sym)}&interval=eq.1h&order=timestamp.desc&limit=1`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact' },
  })
  const range = res.headers.get('content-range') // "0-0/XXX"
  const count = range ? Number(range.split('/')[1]) : 0
  const rows = await res.json()
  const latest = rows[0]?.timestamp ?? null
  return { sym, count, latest }
}

const SYMS = ['BTC/USD','ETH/USD','XAU/USD','DOGE/USD','AVAX/USD','LINK/USD','ADA/USD','DOT/USD','MATIC/USD','NEAR/USD','APT/USD','BNB/USD','SOL/USD']
console.log('price_history 1h candle count per symbol:')
for (const s of SYMS) {
  const r = await countSymbol(s)
  const age = r.latest ? Math.round((Date.now() - new Date(r.latest).getTime())/3600000) : null
  console.log(`  ${r.sym.padEnd(10)} count=${String(r.count).padStart(5)}  latest=${r.latest ?? 'none'}  age=${age ?? '—'}h`)
}
