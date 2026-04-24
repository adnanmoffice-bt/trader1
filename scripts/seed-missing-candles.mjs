/**
 * One-off: seed 1h candles for the 8 instruments the audit flagged.
 * 5 empty (ADA, DOT, MATIC, NEAR, APT) + 3 short (DOGE, AVAX, LINK).
 * Fetches 500 candles each from Binance and upserts into price_history.
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
if (!URL || !KEY) { console.error('Missing env'); process.exit(1) }

const PAIRS = {
  'ADA/USD':   'ADAUSDT',
  'DOT/USD':   'DOTUSDT',
  'MATIC/USD': 'MATICUSDT',
  'NEAR/USD':  'NEARUSDT',
  'APT/USD':   'APTUSDT',
  'DOGE/USD':  'DOGEUSDT',
  'AVAX/USD':  'AVAXUSDT',
  'LINK/USD':  'LINKUSDT',
}

async function fetchKlines(binanceSym, interval, limit) {
  // Binance limit per request = 1000. Use 500 for parity with seed cron.
  const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=${interval}&limit=${limit}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${binanceSym}: HTTP ${r.status} ${await r.text()}`)
  return r.json()
}

async function upsertBatch(rows) {
  // Supabase REST batch upsert
  const res = await fetch(`${URL}/rest/v1/price_history?on_conflict=symbol,interval,timestamp`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`upsert failed: ${res.status} ${txt.slice(0, 300)}`)
  }
}

console.log('Seeding 500 1h candles for 8 instruments...\n')
for (const [sym, binanceSym] of Object.entries(PAIRS)) {
  const t0 = Date.now()
  try {
    const klines = await fetchKlines(binanceSym, '1h', 500)
    const rows = klines.map(k => ({
      symbol:    sym,
      open:      Number(k[1]),
      high:      Number(k[2]),
      low:       Number(k[3]),
      close:     Number(k[4]),
      volume:    Number(k[5]),
      interval:  '1h',
      timestamp: new Date(k[0]).toISOString(),
    }))
    // Upsert in chunks of 200 to avoid payload / statement size limits
    for (let i = 0; i < rows.length; i += 200) {
      await upsertBatch(rows.slice(i, i + 200))
    }
    console.log(`  ${sym.padEnd(10)} ${rows.length} candles  (${Date.now() - t0}ms)  latest=${rows.at(-1).timestamp}`)
  } catch (e) {
    console.error(`  ${sym.padEnd(10)} FAIL: ${e.message}`)
  }
}

console.log('\nAlso seeding 200 4h candles for BTC/ETH (war-room forecast input)...\n')
for (const [sym, binanceSym] of [['BTC/USD', 'BTCUSDT'], ['ETH/USD', 'ETHUSDT']]) {
  try {
    const klines = await fetchKlines(binanceSym, '4h', 200)
    const rows = klines.map(k => ({
      symbol:    sym,
      open:      Number(k[1]),
      high:      Number(k[2]),
      low:       Number(k[3]),
      close:     Number(k[4]),
      volume:    Number(k[5]),
      interval:  '4h',
      timestamp: new Date(k[0]).toISOString(),
    }))
    for (let i = 0; i < rows.length; i += 200) {
      await upsertBatch(rows.slice(i, i + 200))
    }
    console.log(`  ${sym.padEnd(10)} 4h ${rows.length} candles`)
  } catch (e) {
    console.error(`  ${sym.padEnd(10)} 4h FAIL: ${e.message}`)
  }
}

console.log('\nDone.')
