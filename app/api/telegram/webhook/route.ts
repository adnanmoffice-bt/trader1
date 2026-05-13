/**
 * /api/telegram/webhook
 *
 * Push endpoint for inbound Telegram updates. Telegram POSTs here within
 * ~100ms of a channel message hitting the group. We:
 *   1. Verify the secret token (Telegram's X-Telegram-Bot-Api-Secret-Token header)
 *   2. Decode the update → message → text + forward metadata
 *   3. Apply the forward-source filter (Signal Feed only)
 *   4. Parse the structured signal
 *   5. Insert into external_signals (idempotent on (source, external_message_id))
 *   6. If executor is enabled AND signal parsed cleanly → fire IG order
 *      synchronously via lib/telegram-executor.tryExecuteSignalById()
 *   7. Return 200 to Telegram in all cases (we don't want Telegram retrying
 *      and creating duplicate inserts; idempotency in step 5 already handles
 *      it, but 200 avoids the retry storm in their logs anyway)
 *
 * Latency target: ~1 second from channel post → IG order POST. That's:
 *   ~100ms Telegram → us
 *   ~100ms DB insert
 *   ~400ms IG /session (cold start) OR ~50ms (warm)
 *   ~200ms IG /positions/otc POST
 *   ~100ms /confirms/{ref} fetch
 *   = ~500ms warm, ~900ms cold
 *
 * Setup (operator runs this ONCE after deploying):
 *   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
 *     -H 'Content-Type: application/json' \
 *     -d '{
 *       "url": "https://<your-vercel-domain>/api/telegram/webhook",
 *       "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
 *       "allowed_updates": ["message", "channel_post", "edited_message"]
 *     }'
 *
 * To verify the webhook is registered:
 *   curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
 *
 * To remove (fall back to cron-only):
 *   curl -X POST "https://api.telegram.org/bot<TOKEN>/deleteWebhook"
 *
 * The cron-based ingestor (/api/cron/telegram-ingestor) keeps running as a
 * SAFETY NET — if the webhook is unreachable for any reason, the cron's
 * getUpdates() call picks up missed messages on the next minute. Telegram
 * Bot API conflict rule: if a webhook is set, getUpdates() returns
 * "Conflict: terminated by other getUpdates request" — meaning you can
 * use webhook OR getUpdates but NOT both at the same time.
 *
 * Operator decision (when going to webhook mode):
 *   Option A — webhook ONLY: remove the telegram-ingestor cron line from
 *     vercel.json. No fallback if webhook breaks.
 *   Option B — webhook + getUpdates fallback: change the ingestor cron to
 *     run only when webhook hasn't been seen in N minutes (TODO). For now,
 *     remove the ingestor cron when you set the webhook, and re-add it if
 *     you ever deleteWebhook.
 *
 * Required env vars:
 *   TELEGRAM_WEBHOOK_SECRET — random string passed to Telegram setWebhook
 *                              and verified on every inbound POST. Reject
 *                              anything that doesn't match.
 *   (plus all the same env vars used by the cron path — same token, group
 *   id, allowlist, executor flag, dry-run flag.)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabase } from '@/lib/supabase'
import { parseStructuredSignal, PARSER_VERSION } from '@/lib/telegram-ingest'
import {
  isExecutorEnabled,
  isDryRun,
  TELEGRAM_EXECUTOR_DEFAULTS,
  tryExecuteSignalById,
} from '@/lib/telegram-executor'

export const runtime = 'nodejs'
export const maxDuration = 30

const REQUIRE_FORWARD =
  (process.env.TELEGRAM_SIGNALS_REQUIRE_FORWARD ?? '').toLowerCase() === 'true'

const FORWARD_FROM_ALLOWLIST: string[] = (process.env.TELEGRAM_SIGNALS_FORWARD_FROM ?? '')
  .split(',').map(s => s.trim()).filter(Boolean)

interface ForwardInfo {
  from_chat_id: number | null
  from_chat_title: string | null
  from_chat_username: string | null
  from_chat_type: string | null
  from_message_id: number | null
  signature: string | null
}

function extractForwardInfo(msg: Record<string, unknown>): ForwardInfo | null {
  const origin = msg.forward_origin as Record<string, unknown> | undefined
  const legacyChat = msg.forward_from_chat as Record<string, unknown> | undefined
  const chatRef = (origin?.chat as Record<string, unknown> | undefined) ?? legacyChat
  if (!chatRef) return null
  return {
    from_chat_id: Number(chatRef.id ?? 0) || null,
    from_chat_title: (chatRef.title as string | undefined) ?? null,
    from_chat_username: (chatRef.username as string | undefined) ?? null,
    from_chat_type: (chatRef.type as string | undefined) ?? (origin?.type as string | undefined) ?? null,
    from_message_id: Number(origin?.message_id ?? msg.forward_from_message_id ?? 0) || null,
    signature: (origin?.author_signature as string | undefined) ?? (msg.forward_signature as string | undefined) ?? null,
  }
}

function forwardMatchesAllowlist(fwd: ForwardInfo): boolean {
  if (FORWARD_FROM_ALLOWLIST.length === 0) return true
  for (const entry of FORWARD_FROM_ALLOWLIST) {
    if (/^-?\d+$/.test(entry) && fwd.from_chat_id != null && String(fwd.from_chat_id) === entry) return true
    const usernameWanted = entry.replace(/^@/, '').toLowerCase()
    if (fwd.from_chat_username && fwd.from_chat_username.toLowerCase() === usernameWanted) return true
    if (fwd.from_chat_title && fwd.from_chat_title.toLowerCase() === entry.toLowerCase()) return true
  }
  return false
}

function flattenText(msg: Record<string, unknown>): string {
  return String(
    msg.text
    ?? msg.caption
    ?? (msg.poll as Record<string, unknown> | undefined)?.question
    ?? '',
  )
}

export async function POST(req: NextRequest) {
  const t0 = Date.now()
  const db = createServiceSupabase()

  // 1. Verify Telegram secret token. Without this, anyone with our URL
  //    could spoof updates. Telegram echoes whatever we set on setWebhook.
  const wantSecret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!wantSecret) {
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }
  const gotSecret = req.headers.get('x-telegram-bot-api-secret-token')
  if (gotSecret !== wantSecret) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let update: Record<string, unknown>
  try {
    update = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }

  const updateId = Number((update.update_id as number | undefined) ?? 0)
  // Channel posts arrive under `channel_post`; group/supergroup forwards
  // under `message`; edits under `edited_message` / `edited_channel_post`.
  const msg = (update.message
            ?? update.channel_post
            ?? update.edited_message
            ?? update.edited_channel_post) as Record<string, unknown> | undefined

  if (!msg) {
    return NextResponse.json({ ok: true, ignored: 'no-message' })
  }

  const text = flattenText(msg)
  if (!text.trim()) {
    return NextResponse.json({ ok: true, ignored: 'empty-text' })
  }

  const chatObj = msg.chat as Record<string, unknown> | undefined
  const chatId = Number(chatObj?.id ?? 0)
  const messageId = Number(msg.message_id ?? 0)
  const dateSec = Number(msg.date ?? 0)
  const dateIso = dateSec > 0 ? new Date(dateSec * 1000).toISOString() : new Date().toISOString()

  // Sender for audit.
  const from = msg.from as Record<string, unknown> | undefined
  const senderChat = msg.sender_chat as Record<string, unknown> | undefined
  let sender: string | null = null
  if (from) sender = [from.first_name, from.last_name].filter(Boolean).join(' ').trim() || (from.username as string | undefined) || null
  else if (senderChat) sender = (senderChat.title as string | undefined) ?? null
  else if (chatObj) sender = (chatObj.title as string | undefined) ?? null

  const forward = extractForwardInfo(msg)

  // 2. Forward-source filter — fast reject before doing any DB work.
  if (REQUIRE_FORWARD && !forward) {
    return NextResponse.json({ ok: true, ignored: 'non-forward' })
  }
  if (forward && !forwardMatchesAllowlist(forward)) {
    return NextResponse.json({ ok: true, ignored: 'wrong-source', forward })
  }

  // 3. Parse.
  const parsed = parseStructuredSignal(text)

  // 4. Insert (idempotent on UNIQUE (source, external_message_id)).
  const source = chatId !== 0 ? `telegram:${chatId}` : 'telegram:webhook'
  const insertPayload = {
    source,
    external_message_id: messageId,
    message_date: dateIso,
    sender,
    raw_text: text,
    metadata: { update_id: updateId, chat_id: chatId, forward, via: 'webhook' },
    parse_status: parsed ? 'parsed' : 'unparseable',
    parsed: parsed as unknown as Record<string, unknown> | null,
    parser_version: PARSER_VERSION,
    instrument: parsed?.instrument ?? null,
    direction: parsed?.direction ?? null,
    entry_price: parsed?.entry ?? null,
    stop_loss: parsed?.stop_loss ?? null,
    take_profit: parsed?.take_profit ?? null,
    execution_status: (parsed && isExecutorEnabled()) ? 'pending' : 'disabled',
  }

  const { data: inserted, error: insErr } = await db.from('external_signals')
    .insert(insertPayload)
    .select('id')
    .single()

  if (insErr) {
    // Duplicate (unique key violation) is expected when cron also picked
    // up this message — find the existing row id so we can still try to
    // execute it.
    const isDup = (insErr.code === '23505') || /duplicate/i.test(insErr.message ?? '')
    if (!isDup) {
      await db.from('agent_logs').insert({
        agent: 'telegram-webhook',
        level: 'error',
        message: `insert failed: ${insErr.message}`,
        metadata: { updateId, chatId, messageId },
      }).then(() => {})
      return NextResponse.json({ ok: true, error: insErr.message })
    }
    // Look up existing row.
    const { data: existing } = await db.from('external_signals')
      .select('id')
      .eq('source', source)
      .eq('external_message_id', messageId)
      .maybeSingle()
    if (existing) {
      const oc = isExecutorEnabled() ? await tryExecuteSignalById(db, existing.id as string) : null
      return NextResponse.json({ ok: true, dedupe: true, signal_id: existing.id, outcome: oc, duration_ms: Date.now() - t0 })
    }
    return NextResponse.json({ ok: true, dedupe: true })
  }

  const signalId = (inserted?.id as string | undefined) ?? null

  // 5. Fire immediately if executor is enabled and the signal parsed.
  let outcome = null
  if (signalId && parsed && isExecutorEnabled()) {
    outcome = await tryExecuteSignalById(db, signalId)
  }

  // 6. Log one heartbeat line for visibility.
  await db.from('agent_logs').insert({
    agent: 'telegram-webhook',
    level: outcome?.status === 'failed' ? 'warn' : 'ok',
    message: `webhook: parsed=${!!parsed} executor=${isExecutorEnabled()} dry_run=${isDryRun()} outcome=${outcome?.status ?? 'no-exec'} dur=${Date.now() - t0}ms`,
    metadata: {
      updateId, chatId, messageId, signalId,
      forward,
      parsed_summary: parsed ? {
        instrument: parsed.instrument, direction: parsed.direction,
        entry: parsed.entry, sl: parsed.stop_loss, tp: parsed.take_profit,
      } : null,
      outcome,
      allowlist: TELEGRAM_EXECUTOR_DEFAULTS.ALLOWLIST,
      duration_ms: Date.now() - t0,
    },
  }).then(() => {})

  return NextResponse.json({
    ok: true,
    signal_id: signalId,
    parsed: !!parsed,
    outcome,
    duration_ms: Date.now() - t0,
  })
}

// Tiny GET handler so operator can curl the URL to confirm the endpoint
// is reachable (without exposing any sensitive state).
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'telegram-webhook',
    expects: 'POST with X-Telegram-Bot-Api-Secret-Token',
    require_forward: REQUIRE_FORWARD,
    allowlist_size: FORWARD_FROM_ALLOWLIST.length,
    executor_enabled: isExecutorEnabled(),
    dry_run: isDryRun(),
    instruments: TELEGRAM_EXECUTOR_DEFAULTS.ALLOWLIST,
  })
}
