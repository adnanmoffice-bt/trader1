/**
 * Move USDT from Funding (and optionally Simple Earn flexible) into Spot.
 *
 * SAFETY:
 *   - Read-only by default. Requires --confirm to actually move funds.
 *   - Requires --amount=N (must be a positive integer USDT).
 *   - Optional --redeem=N to also pull N USDT from Simple Earn flexible
 *     back to Spot before the Funding transfer.
 *   - Detects whether Binance "Auto-Subscribe to Simple Earn" appears active
 *     on the account (looks for AUTO subscription events in the last 7 days).
 *     Warns and refuses to run unless --force is passed.
 *
 * USAGE:
 *   Dry-run (always safe):
 *     node scripts/move-funding-to-spot.mjs --amount=1100
 *
 *   Real run (after disabling Auto-Subscribe in Binance UI):
 *     node scripts/move-funding-to-spot.mjs --amount=1100 --confirm
 *
 *   Real run that ALSO redeems 500 USDT from Simple Earn flexible:
 *     node scripts/move-funding-to-spot.mjs --amount=1100 --redeem=500 --confirm
 *
 *   Override the auto-subscribe guard (NOT recommended — sweep will likely
 *   pull the funds back at ~22:00 Dubai):
 *     node scripts/move-funding-to-spot.mjs --amount=1100 --confirm --force
 *
 * REQUIRES: BINANCE_API_KEY + BINANCE_SECRET_KEY in .env.local with
 *   spot trading + universal-transfer + simple-earn permissions.
 */

import crypto from 'node:crypto'
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

const API = process.env.BINANCE_API_KEY
const SECRET = process.env.BINANCE_SECRET_KEY
const BASE = 'https://api.binance.com'

if (!API || !SECRET) {
  console.error('Missing BINANCE_API_KEY or BINANCE_SECRET_KEY in .env.local')
  process.exit(1)
}

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=')
  return [k, v ?? true]
}))

const AMOUNT = Number(args.amount)
const REDEEM = Number(args.redeem || 0)
const CONFIRM = !!args.confirm
const FORCE = !!args.force

if (!Number.isFinite(AMOUNT) || AMOUNT <= 0) {
  console.error('Usage: node scripts/move-funding-to-spot.mjs --amount=N [--redeem=N] [--confirm] [--force]')
  process.exit(1)
}

function sign(qs) { return crypto.createHmac('sha256', SECRET).update(qs).digest('hex') }

async function signedReq(method, endpoint, extra = {}) {
  const params = new URLSearchParams({ timestamp: Date.now().toString(), recvWindow: '10000', ...extra })
  const qs = params.toString()
  const url = `${BASE}${endpoint}?${qs}&signature=${sign(qs)}`
  const res = await fetch(url, { method, headers: { 'X-MBX-APIKEY': API } })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  return { status: res.status, data }
}

function dubai(ts) { return new Date(Number(ts)).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', hour12: false }) }

console.log('=== move-funding-to-spot ===')
console.log(`Amount Funding → Spot:        $${AMOUNT.toFixed(2)} USDT`)
if (REDEEM > 0) console.log(`Earn flexible → Spot redeem:  $${REDEEM.toFixed(2)} USDT`)
console.log(`Confirm flag:                 ${CONFIRM ? 'YES (will execute)' : 'no (dry-run)'}`)
console.log()

// 1. Check current balances + permissions
console.log('1) Checking balances + permissions ...')
const acct = await signedReq('GET', '/api/v3/account')
if (acct.status !== 200) { console.error('   Account check FAIL:', acct.data); process.exit(1) }
if (!acct.data.canTrade) { console.error('   API key cannot trade — abort'); process.exit(1) }

const spotUsdt = Number((acct.data.balances || []).find(b => b.asset === 'USDT')?.free || 0)
console.log(`   Spot USDT free (before):  $${spotUsdt.toFixed(2)}`)

const fundingRes = await signedReq('POST', '/sapi/v1/asset/get-funding-asset', { needBtcValuation: 'false' })
const fundingUsdt = fundingRes.status === 200
  ? Number((fundingRes.data || []).find(b => b.asset === 'USDT')?.free || 0)
  : 0
console.log(`   Funding USDT free:        $${fundingUsdt.toFixed(2)}`)

const earnRes = await signedReq('GET', '/sapi/v1/simple-earn/flexible/position', { asset: 'USDT' })
const earnUsdt = earnRes.status === 200
  ? Number((earnRes.data?.rows || []).find(r => r.asset === 'USDT')?.totalAmount || 0)
  : 0
console.log(`   Simple Earn USDT total:   $${earnUsdt.toFixed(2)}`)

// 2. Sanity checks
if (AMOUNT > fundingUsdt) {
  console.error(`\n   ERROR: requested $${AMOUNT} > Funding $${fundingUsdt.toFixed(2)}`)
  process.exit(1)
}
if (REDEEM > 0 && REDEEM > earnUsdt) {
  console.error(`\n   ERROR: requested redeem $${REDEEM} > Earn $${earnUsdt.toFixed(2)}`)
  process.exit(1)
}

// 3. Auto-subscribe guard — look for AUTO subscriptions in the last 7 days
console.log('\n2) Auto-subscribe guard — scanning last 7 days of Earn subscriptions ...')
const since = Date.now() - 7 * 86400_000
const subRes = await signedReq('GET', '/sapi/v1/simple-earn/flexible/history/subscriptionRecord', {
  startTime: String(since), size: '100', current: '1', asset: 'USDT',
})
let autoSubDetected = false
if (subRes.status === 200) {
  const rows = subRes.data?.rows || []
  const autoRows = rows.filter(r => String(r.type).toUpperCase() === 'AUTO')
  if (autoRows.length > 0) {
    autoSubDetected = true
    console.log(`   ⚠ Found ${autoRows.length} AUTO subscription event(s) in last 7d. Most recent:`)
    for (const r of autoRows.slice(0, 3)) {
      console.log(`     ${dubai(r.time)}  USDT  amount=${r.amount}  type=${r.type}`)
    }
    console.log('\n   This means Binance Auto-Subscribe to Simple Earn is still ENABLED on this account.')
    console.log('   Any USDT transferred to Spot will be silently moved back to Earn at ~22:00 Dubai.')
    console.log('   FIX: Binance UI → Earn → Simple Earn → Manage (gear) → Auto-Subscribe → toggle OFF for USDT.')
    console.log('   (Or: Binance UI → Wallet → Auto-Invest → pause any USDT plan.)')
  } else {
    console.log('   ✓ No AUTO subscription events found for USDT in last 7d. Looks safe.')
  }
} else {
  console.log('   (could not query subscription history — proceeding anyway)')
}

if (autoSubDetected && !FORCE) {
  console.log('\nABORT: refusing to transfer while Auto-Subscribe still appears active.')
  console.log('   Disable it in the Binance UI first, OR re-run with --force to override.')
  process.exit(1)
}

// 4. Plan
console.log('\n3) Plan:')
const plannedRedeem = REDEEM > 0
const plannedTransfer = AMOUNT > 0
if (plannedRedeem) console.log(`   STEP A: redeem $${REDEEM} USDT from Simple Earn flexible → Spot`)
if (plannedTransfer) console.log(`   STEP B: transfer $${AMOUNT} USDT from Funding → Spot`)
const expectedSpotAfter = spotUsdt + (plannedRedeem ? REDEEM : 0) + (plannedTransfer ? AMOUNT : 0)
console.log(`   Expected Spot USDT after: ~$${expectedSpotAfter.toFixed(2)}`)

if (!CONFIRM) {
  console.log('\nDRY-RUN. No funds moved. Re-run with --confirm to execute.')
  process.exit(0)
}

// 5. Execute
console.log('\n4) EXECUTING ...')

if (plannedRedeem) {
  console.log(`   STEP A: redeem $${REDEEM} USDT from Earn ...`)
  const r = await signedReq('POST', '/sapi/v1/simple-earn/flexible/redeem', {
    productId: 'USDT001',
    amount: String(REDEEM),
    destAccount: 'SPOT',
  })
  if (r.status !== 200 || r.data?.success === false) {
    console.error('   STEP A FAILED:', r.status, r.data)
    process.exit(1)
  }
  console.log('   STEP A OK:', r.data)
  console.log('   waiting 4s for Spot to settle ...')
  await new Promise(res => setTimeout(res, 4000))
}

if (plannedTransfer) {
  console.log(`   STEP B: transfer $${AMOUNT} Funding → Spot ...`)
  const r = await signedReq('POST', '/sapi/v1/asset/transfer', {
    type: 'FUNDING_MAIN',
    asset: 'USDT',
    amount: String(AMOUNT),
  })
  if (r.status !== 200) {
    console.error('   STEP B FAILED:', r.status, r.data)
    process.exit(1)
  }
  console.log('   STEP B OK: tranId =', r.data?.tranId)
}

// 6. Verify
console.log('\n5) Verifying new Spot balance ...')
await new Promise(res => setTimeout(res, 2000))
const acct2 = await signedReq('GET', '/api/v3/account')
const spotUsdt2 = Number((acct2.data.balances || []).find(b => b.asset === 'USDT')?.free || 0)
console.log(`   Spot USDT free (after):   $${spotUsdt2.toFixed(2)}  (was $${spotUsdt.toFixed(2)})`)

console.log('\nDONE. Reminder: if you have not disabled Auto-Subscribe in the Binance UI,')
console.log('these funds will be swept back into Simple Earn at ~22:00 Dubai today.')
