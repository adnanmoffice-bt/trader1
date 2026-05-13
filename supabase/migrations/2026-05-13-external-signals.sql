-- 2026-05-13 Computer A (day)
-- external_signals — write-ahead log for signals pulled from external sources
-- (initially Telegram channel -3910126970).
--
-- Each row represents ONE message we read. parse_status starts at 'pending';
-- parser flips it to 'parsed' or 'unparseable'. execution_status starts at
-- 'pending'; executor flips it to 'executed' / 'skipped' / 'failed'.
--
-- Operator decision 2026-05-13: external-signal path bypasses probe-week
-- kill switch, daily-loss limit, and the SOL/BNB/shorts/BB_SQUEEZE workspace
-- blacklist. War-room path is UNAFFECTED — its safety stack remains intact.
-- This isolation is enforced in app/api/cron/telegram-ingestor/route.ts;
-- nothing in this table is auto-trusted by other cron paths.
--
-- Idempotent: re-running this migration is safe.

CREATE TABLE IF NOT EXISTS external_signals (
  id                   UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  created_at           TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  ingested_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Source identity. Format: '<provider>:<channel_id>' (e.g. 'telegram:-3910126970').
  source               TEXT        NOT NULL,
  external_message_id  BIGINT      NOT NULL,
  message_date         TIMESTAMPTZ,
  sender               TEXT,

  -- Raw payload — always populated, even when parse fails.
  raw_text             TEXT        NOT NULL,
  metadata             JSONB,

  -- Parser output (NULL until parser runs).
  parse_status         TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (parse_status IN ('pending','parsed','unparseable')),
  parsed               JSONB,
  parser_version       TEXT,

  -- Denormalised parsed fields for fast querying.
  instrument           TEXT,
  direction            TEXT        CHECK (direction IN ('long','short','close','hold') OR direction IS NULL),
  entry_price          NUMERIC(18,8),
  stop_loss            NUMERIC(18,8),
  take_profit          NUMERIC(18,8),

  -- Execution outcome.
  execution_status     TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (execution_status IN ('pending','executed','skipped','failed','disabled')),
  executed_trade_id    UUID        REFERENCES trades(id) ON DELETE SET NULL,
  skip_reason          TEXT,
  exec_error           TEXT,
  executed_at          TIMESTAMPTZ
);

-- Dedupe: each Telegram update_id arrives at most once per source.
CREATE UNIQUE INDEX IF NOT EXISTS uq_external_signals_msg_id
  ON external_signals (source, external_message_id);

CREATE INDEX IF NOT EXISTS idx_external_signals_created
  ON external_signals (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_external_signals_pending_exec
  ON external_signals (execution_status)
  WHERE execution_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_external_signals_source_msgid
  ON external_signals (source, external_message_id DESC);

-- Track the last update_id we processed from each source. Avoids replay on
-- restart and lets us resume cleanly.
CREATE TABLE IF NOT EXISTS external_signal_cursors (
  source            TEXT PRIMARY KEY,
  last_update_id    BIGINT NOT NULL DEFAULT 0,
  last_message_id   BIGINT,
  updated_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- RLS — service-role only. No end-user should read this table.
ALTER TABLE external_signals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_signal_cursors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS svc_all_external_signals       ON external_signals;
DROP POLICY IF EXISTS svc_all_external_signal_cursors ON external_signal_cursors;

CREATE POLICY svc_all_external_signals
  ON external_signals
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY svc_all_external_signal_cursors
  ON external_signal_cursors
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
