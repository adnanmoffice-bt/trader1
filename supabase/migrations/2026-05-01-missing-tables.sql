-- ══════════════════════════════════════════════════════════════════════════════
-- 2026-05-01 — Create the 5 tables that were defined in schema.sql but never
-- applied to prod. Fully idempotent: safe to run as many times as you want.
--
-- Tables created:
--   1. polymarket_bets       (legacy — Polymarket integration was scrapped)
--   2. war_room_messages     (already exists in prod, included for safety)
--   3. agent_knowledge       (agents recall lessons across sessions)
--   4. trade_analytics       (per-trade post-mortem stats)
--   5. trade_journal         (human-readable trade rationale)
--   6. performance_snapshots (daily capital / WR / Sharpe snapshots)
--
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── 1. polymarket_bets ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS polymarket_bets (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  market_id       VARCHAR(100) NOT NULL,
  question        TEXT NOT NULL,
  side            VARCHAR(5) NOT NULL CHECK (side IN ('YES','NO')),
  entry_price     DECIMAL(6,4) NOT NULL,
  current_price   DECIMAL(6,4),
  amount_usd      DECIMAL(10,2) NOT NULL,
  pnl_usd         DECIMAL(10,2),
  ai_probability  DECIMAL(6,4),
  edge            DECIMAL(6,4),
  reasoning       TEXT,
  status          VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','won','lost','sold')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_poly_bets_status ON polymarket_bets(status);
ALTER TABLE polymarket_bets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read_poly_bets" ON polymarket_bets;
CREATE POLICY "public_read_poly_bets" ON polymarket_bets FOR SELECT USING (true);
DROP POLICY IF EXISTS "service_write_poly_bets" ON polymarket_bets;
CREATE POLICY "service_write_poly_bets" ON polymarket_bets FOR ALL USING (auth.role() = 'service_role');

-- ─── 2. agent_knowledge ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_knowledge (
  id           UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  agent_id     VARCHAR(50) NOT NULL,
  type         VARCHAR(30) NOT NULL CHECK (type IN ('lesson','pattern','mistake','observation','rule')),
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,
  context      JSONB,
  confidence   SMALLINT DEFAULT 50 CHECK (confidence BETWEEN 0 AND 100),
  trade_id     UUID,
  active       BOOLEAN DEFAULT true,
  applied_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  expires_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ak_agent_active ON agent_knowledge(agent_id, type, active);
CREATE INDEX IF NOT EXISTS idx_ak_created      ON agent_knowledge(created_at DESC);
ALTER TABLE agent_knowledge ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read_knowledge" ON agent_knowledge;
CREATE POLICY "public_read_knowledge" ON agent_knowledge FOR SELECT USING (true);
DROP POLICY IF EXISTS "service_write_knowledge" ON agent_knowledge;
CREATE POLICY "service_write_knowledge" ON agent_knowledge FOR ALL USING (auth.role() = 'service_role');

-- ─── 3. trade_analytics ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_analytics (
  id                  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  trade_id            UUID,
  instrument          VARCHAR(20) NOT NULL,
  direction           VARCHAR(10) NOT NULL,
  entry_price         DECIMAL(18,8),
  exit_price          DECIMAL(18,8),
  stop_loss           DECIMAL(18,8),
  take_profit         DECIMAL(18,8),
  pnl_usd             DECIMAL(12,2),
  pnl_r               DECIMAL(8,4),
  hold_duration_mins  INTEGER,
  mfe_usd             DECIMAL(12,2),
  mae_usd             DECIMAL(12,2),
  mfe_pct             DECIMAL(10,4),
  mae_pct             DECIMAL(10,4),
  exit_reason         VARCHAR(40),
  regime_at_entry     VARCHAR(20),
  conviction_at_entry SMALLINT,
  triggers_at_entry   JSONB,
  computed_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ta_trade      ON trade_analytics(trade_id);
CREATE INDEX IF NOT EXISTS idx_ta_instrument ON trade_analytics(instrument);
CREATE INDEX IF NOT EXISTS idx_ta_computed   ON trade_analytics(computed_at DESC);
ALTER TABLE trade_analytics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read_trade_analytics" ON trade_analytics;
CREATE POLICY "public_read_trade_analytics" ON trade_analytics FOR SELECT USING (true);
DROP POLICY IF EXISTS "service_write_trade_analytics" ON trade_analytics;
CREATE POLICY "service_write_trade_analytics" ON trade_analytics FOR ALL USING (auth.role() = 'service_role');

-- ─── 4. trade_journal ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_journal (
  id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  trade_id    UUID,
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  title       TEXT NOT NULL,
  rationale   TEXT NOT NULL,
  lessons     TEXT,
  tags        TEXT[],
  mood        VARCHAR(20),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tj_trade ON trade_journal(trade_id);
CREATE INDEX IF NOT EXISTS idx_tj_date  ON trade_journal(date DESC);
CREATE INDEX IF NOT EXISTS idx_tj_tags  ON trade_journal USING GIN(tags);
ALTER TABLE trade_journal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read_trade_journal" ON trade_journal;
CREATE POLICY "public_read_trade_journal" ON trade_journal FOR SELECT USING (true);
DROP POLICY IF EXISTS "service_write_trade_journal" ON trade_journal;
CREATE POLICY "service_write_trade_journal" ON trade_journal FOR ALL USING (auth.role() = 'service_role');

-- ─── 5. performance_snapshots ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS performance_snapshots (
  id                       UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  date                     DATE NOT NULL DEFAULT CURRENT_DATE,
  capital_usd              DECIMAL(12,2),
  realized_pnl_usd         DECIMAL(12,2),
  unrealized_pnl_usd       DECIMAL(12,2),
  trade_count              INTEGER,
  win_count                INTEGER,
  loss_count               INTEGER,
  win_rate_pct             DECIMAL(5,2),
  avg_win_usd              DECIMAL(12,2),
  avg_loss_usd             DECIMAL(12,2),
  profit_factor            DECIMAL(8,4),
  sharpe_ratio             DECIMAL(8,4),
  sortino_ratio            DECIMAL(8,4),
  max_drawdown_pct         DECIMAL(8,4),
  best_instrument          VARCHAR(20),
  worst_instrument         VARCHAR(20),
  avg_hold_duration_mins   INTEGER,
  avg_mfe_pct              DECIMAL(10,4),
  avg_mae_pct              DECIMAL(10,4),
  avg_exit_efficiency_pct  DECIMAL(10,4),
  kelly_fraction           DECIMAL(10,6),
  created_at               TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ps_date ON performance_snapshots(date DESC);
ALTER TABLE performance_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read_perf_snap" ON performance_snapshots;
CREATE POLICY "public_read_perf_snap" ON performance_snapshots FOR SELECT USING (true);
DROP POLICY IF EXISTS "service_write_perf_snap" ON performance_snapshots;
CREATE POLICY "service_write_perf_snap" ON performance_snapshots FOR ALL USING (auth.role() = 'service_role');

-- ─── Realtime publications (safe — ignores duplicate_object) ──────────────────
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE polymarket_bets;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE agent_knowledge;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE trade_analytics;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE performance_snapshots;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Verification (optional — run separately to confirm) ─────────────────────
-- SELECT table_name
-- FROM information_schema.tables
-- WHERE table_schema='public'
--   AND table_name IN ('polymarket_bets','agent_knowledge','trade_analytics','trade_journal','performance_snapshots')
-- ORDER BY table_name;
-- Expected: 5 rows.
