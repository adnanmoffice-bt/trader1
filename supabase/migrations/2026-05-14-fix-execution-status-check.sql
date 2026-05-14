-- 2026-05-14 Computer A (day) — CRITICAL execution-path fix
--
-- Problem (production data, verified 2026-05-14 ~08:50 Dubai):
--   The atomic "claim" step in lib/telegram-executor.ts → claimSignalRow()
--   does:
--     UPDATE external_signals
--       SET execution_status = 'executing'
--       WHERE id = X AND execution_status = 'pending'
--
--   The original CHECK constraint (2026-05-13-external-signals.sql) only
--   allowed: 'pending','executed','skipped','failed','disabled'.
--   It did NOT include 'executing'.
--
--   Postgres rejected every UPDATE with 23514 (check constraint violation).
--   The supabase-js client returned `data: null, error: {...}`. The caller
--   only destructured `data` and ignored `error`, so the failure was
--   completely silent. Webhook + cron both reported "race-lost" once a
--   minute for ~13 hours and the rows stayed `pending`. ZERO IG orders fired
--   for two real Signal Feed XAU/USD setups (one would have hit SL at -30
--   pips, the other would have hit TP1+TP2 at +210 pips).
--
-- This migration:
--   1. Drops the old CHECK and re-adds it with 'executing' included.
--   2. Idempotent — re-running it is a no-op.
--   3. No data backfill needed; the column itself is unchanged.
--
-- Companion code patch (same commit) hardens claimSignalRow() so a future
-- schema mismatch can never silently break execution again.

ALTER TABLE external_signals
  DROP CONSTRAINT IF EXISTS external_signals_execution_status_check;

ALTER TABLE external_signals
  ADD CONSTRAINT external_signals_execution_status_check
  CHECK (execution_status IN (
    'pending',     -- inserted, not yet claimed
    'executing',   -- atomically claimed by webhook OR cron, IG order in flight
    'executed',    -- IG order placed, trade row written
    'skipped',     -- safety floor (allowlist / freshness / dry-run)
    'failed',      -- IG order errored, or trades insert errored
    'disabled'     -- parser failed OR executor flag off at ingest time
  ));
