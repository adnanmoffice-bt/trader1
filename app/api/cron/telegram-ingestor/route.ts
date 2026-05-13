/**
 * /api/cron/telegram-ingestor
 *
 * 2026-05-13 — operator (Computer A, day) instructed the system to scrape
 * an external Telegram signals channel and use it for live trading,
 * skipping demo and the existing safety stack (kill switch, blacklist).
 *
 * This route implements PHASE 1 ONLY:
 *   1. Pull new updates from the configured Telegram channel via Bot API.
 *   2. Persist every message to `external_signals` as raw text.
 *   3. Best-effort parse (lib/telegram-ingest.ts → parseStructuredSignal).
 *   4. NO execution. execution_status stays 'pending' or flips to
 *      'disabled' when the EXECUTOR_ENABLED env flag is false (default).
 *
 * Phase 2 (parser refinement after seeing real messages) and Phase 3
 * (auto-execute on IG) land in subsequent commits once the operator
 * verifies the parsed shape matches reality.
 *
 * Environment variables consumed:
 *   TELEGRAM_BOT_TOKEN          (existing) — the same bot that sends
 *                               outbound notifications; must be a MEMBER of
 *                               the signals group with Privacy Mode OFF.
 *   TELEGRAM_SIGNALS_GROUP_ID   (new)      — e.g. '-3910126970'. Bot will
 *                               filter updates to this chat only; other
 *                               chats the bot is in are ignored.
 *   TELEGRAM_SIGNALS_EXECUTOR_ENABLED (new) — defaults to 'false'. Set
 *                               to 'true' ONLY after operator verifies
 *                               the parser output matches real messages.
 *   CRON_SECRET                 (existing) — bearer auth.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import {
  fetchTelegramUpdates,
  parseStructuredSignal,
  PARSER_VERSION,
} from '@/lib/telegram-ingest'

export const runtime = 'nodejs'
export const maxDuration = 30

const GROUP_ID_RAW = process.env.TELEGRAM_SIGNALS_GROUP_ID
const EXECUTOR_ENABLED =
  (process.env.TELEGRAM_SIGNALS_EXECUTOR_ENABLED ?? '').toLowerCase() === 'true'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN missing' }, { status: 500 })
  }
  if (!GROUP_ID_RAW) {
    return NextResponse.json({ error: 'TELEGRAM_SIGNALS_GROUP_ID missing' }, { status: 500 })
  }
  const groupId = Number(GROUP_ID_RAW)
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: `TELEGRAM_SIGNALS_GROUP_ID not numeric: ${GROUP_ID_RAW}` }, { status: 500 })
  }

  const db = createServiceSupabase()
  const t0 = Date.now()
  const source = `telegram:${groupId}`

  // Read cursor: last update_id we processed for this source.
  const { data: cursor } = await db
    .from('external_signal_cursors')
    .select('last_update_id, last_message_id')
    .eq('source', source)
    .maybeSingle()

  const sinceUpdateId = Number(cursor?.last_update_id ?? 0)

  const fetched = await fetchTelegramUpdates({
    sinceUpdateId,
    chatIdFilter: groupId,
    maxPages: 5,
  })

  if (!fetched.ok) {
    await db.from('agent_logs').insert({
      agent: 'telegram-ingestor-cron',
      level: 'error',
      message: `getUpdates failed: ${fetched.error}`,
      metadata: { sinceUpdateId, duration_ms: Date.now() - t0 },
    }).then(() => {})
    return NextResponse.json({ error: fetched.error, sinceUpdateId }, { status: 502 })
  }

  let inserted = 0
  let parsed = 0
  let unparseable = 0
  let duplicates = 0
  let lastMsgIdSeen = Number(cursor?.last_message_id ?? 0)

  for (const m of fetched.newUpdates) {
    const parsedSig = parseStructuredSignal(m.text)
    const parse_status = parsedSig ? 'parsed' : 'unparseable'
    if (parsedSig) parsed++
    else unparseable++

    const row = {
      source,
      external_message_id: m.message_id,
      message_date: m.date_iso,
      sender: m.sender,
      raw_text: m.text,
      metadata: { update_id: m.update_id, chat_id: m.chat_id },
      parse_status,
      parsed: parsedSig as unknown as Record<string, unknown> | null,
      parser_version: PARSER_VERSION,
      instrument: parsedSig?.instrument ?? null,
      direction: parsedSig?.direction ?? null,
      entry_price: parsedSig?.entry ?? null,
      stop_loss: parsedSig?.stop_loss ?? null,
      take_profit: parsedSig?.take_profit ?? null,
      // Phase 1: never execute. execution_status flips to 'disabled' so
      // the future executor cron skips them; flip to 'pending' to allow
      // them through once Phase 3 lands.
      execution_status: EXECUTOR_ENABLED ? 'pending' : 'disabled',
    }

    const { error } = await db.from('external_signals').insert(row)
    if (error) {
      // Duplicate (uq_external_signals_msg_id) is expected on replay — treat
      // as a no-op. Other errors get logged but don't kill the loop.
      if (String(error.code) === '23505' || /duplicate key/i.test(error.message)) {
        duplicates++
      } else {
        await db.from('agent_logs').insert({
          agent: 'telegram-ingestor-cron',
          level: 'warn',
          message: `insert failed for msg ${m.message_id}: ${error.message}`,
          metadata: { update_id: m.update_id },
        }).then(() => {})
      }
    } else {
      inserted++
      lastMsgIdSeen = Math.max(lastMsgIdSeen, m.message_id)
    }
  }

  // Advance cursor to fetched.lastUpdateId regardless of insert outcome — a
  // duplicate-key error still means we've "processed" that update.
  await db
    .from('external_signal_cursors')
    .upsert(
      { source, last_update_id: fetched.lastUpdateId, last_message_id: lastMsgIdSeen, updated_at: new Date().toISOString() },
      { onConflict: 'source' },
    )

  const summary = {
    source,
    sinceUpdateId,
    lastUpdateId: fetched.lastUpdateId,
    fetched: fetched.newUpdates.length,
    inserted,
    parsed,
    unparseable,
    duplicates,
    executor_enabled: EXECUTOR_ENABLED,
    duration_ms: Date.now() - t0,
  }

  await db.from('agent_logs').insert({
    agent: 'telegram-ingestor-cron',
    level: 'ok',
    message: `ingested ${inserted} (${parsed} parsed, ${unparseable} unparseable, ${duplicates} dupes) executor=${EXECUTOR_ENABLED}`,
    metadata: summary,
  }).then(() => {})

  return NextResponse.json(summary)
}
