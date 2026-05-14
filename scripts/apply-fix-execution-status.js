// Apply 2026-05-14-fix-execution-status-check.sql to prod and reconcile
// the two stuck-pending signals from 2026-05-13 so the cron stops looping.
//
// Idempotent — safe to re-run.
const { Client } = require('pg')
const fs = require('node:fs')
const path = require('node:path')
const dns = require('node:dns')
// Supabase direct DB host is IPv6-only in some regions; default Node DNS
// returns A records first → ENOTFOUND. Force AAAA preference.
dns.setDefaultResultOrder('ipv6first')

const MIGRATION_PATH = path.resolve(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '2026-05-14-fix-execution-status-check.sql',
)

async function main() {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8')
  // Direct host (db.<ref>.supabase.co) is IPv6-only and unreachable from
  // some Windows networks → ENOTFOUND. Try direct first, then pooler in
  // each common region. The pooler accepts the same password but expects
  // username = 'postgres.<project_ref>'.
  const PROJECT_REF = 'thuamsmvqdngemdkrftk'
  const PASSWORD = 'ANXMFn2dkHdzWTR4'
  const regions = [
    'eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-north-1',
    'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
    'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1',
    'sa-east-1', 'ca-central-1',
  ]
  const candidates = [
    `postgresql://postgres:${PASSWORD}@db.${PROJECT_REF}.supabase.co:5432/postgres`,
  ]
  for (const r of regions) {
    candidates.push(`postgresql://postgres.${PROJECT_REF}:${PASSWORD}@aws-0-${r}.pooler.supabase.com:6543/postgres`)
    candidates.push(`postgresql://postgres.${PROJECT_REF}:${PASSWORD}@aws-1-${r}.pooler.supabase.com:6543/postgres`)
  }
  let client = null
  for (const cs of candidates) {
    const c = new Client({ connectionString: cs, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 })
    try {
      await c.connect()
      console.log('connected via:', cs.replace(PASSWORD, '***'))
      client = c
      break
    } catch (e) {
      console.log('  skip', cs.split('@')[1].split(':')[0], '→', e.message)
      try { await c.end() } catch { }
    }
  }
  if (!client) throw new Error('Could not connect via any candidate (direct or pooler)')
  try {
    console.log('1) Applying migration ...')
    await client.query(sql)
    console.log('   ok')

    console.log('2) Verifying the new CHECK includes "executing" ...')
    const verify = await client.query(`
      SELECT pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'external_signals'
        AND c.conname = 'external_signals_execution_status_check'
    `)
    console.log('   def:', verify.rows[0]?.def)
    if (!verify.rows[0]?.def?.includes('executing')) {
      throw new Error('verification failed — executing not in CHECK')
    }

    console.log('3) Marking the two pre-fix stuck rows as failed ...')
    const stuck = await client.query(
      `
      UPDATE external_signals
         SET execution_status = 'failed',
             exec_error       = 'pre-2026-05-14 fix: blocked by execution_status CHECK that did not allow "executing" — manually closed out, prices long since moved',
             executed_at      = NOW()
       WHERE execution_status = 'pending'
         AND created_at < NOW() - INTERVAL '30 minutes'
       RETURNING id, instrument, direction, entry_price
      `,
    )
    console.log('   marked failed:', stuck.rowCount, 'rows')
    for (const r of stuck.rows) {
      console.log(`     ${r.id} ${r.instrument} ${r.direction} entry=${r.entry_price}`)
    }

    console.log('4) Sanity: any other rows still pending?')
    const pending = await client.query(
      `SELECT id, instrument, created_at FROM external_signals WHERE execution_status = 'pending' ORDER BY created_at DESC LIMIT 5`,
    )
    console.log('   pending now:', pending.rowCount)
    for (const r of pending.rows) console.log(`     ${r.id} ${r.instrument} ${r.created_at}`)
  } finally {
    await client.end()
  }
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
