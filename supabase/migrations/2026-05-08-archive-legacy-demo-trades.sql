-- ══════════════════════════════════════════════════════════════════════════════
-- 2026-05-08 — Archive legacy demo_trades (pre 2026-04-17 SOL/BNB/BB_SQUEEZE era)
-- ══════════════════════════════════════════════════════════════════════════════
-- Purpose:
--   The Trade Analytics dashboard ("ALL TIME") was showing -$6,441 across 151
--   trades, dominated by 102 trades from before 2026-04-17 when SOL/USD,
--   BNB/USD and the BB_SQUEEZE trigger were still in rotation. All three have
--   since been disabled (workspace rules + LIVE_INSTRUMENT_BLACKLIST). The
--   numbers are misleading to operators and investors — they describe a config
--   that no longer exists.
--
-- This migration:
--   1) Adds an `archived_at TIMESTAMPTZ` column to `demo_trades` (idempotent).
--   2) Marks every trade closed before 2026-04-17 as archived.
--   3) Indexes `archived_at` so the API can filter `IS NULL` cheaply.
--
-- Reversible: `UPDATE demo_trades SET archived_at = NULL` un-archives. The
-- column itself is non-destructive — no row is deleted, no field overwritten.
--
-- Dashboard (`/api/demo`) filters `archived_at IS NULL` by default; pass
-- `?include_archived=true` for research scripts to see everything.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE demo_trades
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_demo_trades_archived_at
  ON demo_trades (archived_at)
  WHERE archived_at IS NULL;

-- Archive every closed pre-cutoff trade. Cutoff = 2026-04-17 (SOL/BNB blacklist
-- date + BB_SQUEEZE rule landing). Open trades are left untouched (none should
-- exist that old, but defensive guard).
UPDATE demo_trades
SET archived_at = NOW()
WHERE archived_at IS NULL
  AND exit_time IS NOT NULL
  AND exit_time < '2026-04-17T00:00:00Z';

-- Sanity check (commented; uncomment to verify counts):
-- SELECT
--   COUNT(*) FILTER (WHERE archived_at IS NULL)        AS active_trades,
--   COUNT(*) FILTER (WHERE archived_at IS NOT NULL)    AS archived_trades,
--   SUM(pnl) FILTER (WHERE archived_at IS NULL)        AS active_pnl,
--   SUM(pnl) FILTER (WHERE archived_at IS NOT NULL)    AS archived_pnl
-- FROM demo_trades;
