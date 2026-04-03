-- ══════════════════════════════════════════════════════════════════════════════
-- APEX TRADING TERMINAL — Complete Database Schema
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════════════════

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- ─── Market Data ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS market_data (
  id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  symbol      VARCHAR(20) NOT NULL,
  price       DECIMAL(18,8) NOT NULL,
  change_24h  DECIMAL(18,8) DEFAULT 0,
  change_pct_24h DECIMAL(10,4) DEFAULT 0,
  volume_24h  DECIMAL(24,2) DEFAULT 0,
  high_24h    DECIMAL(18,8),
  low_24h     DECIMAL(18,8),
  open_24h    DECIMAL(18,8),
  market_cap  DECIMAL(24,2),
  source      VARCHAR(50) DEFAULT 'binance',
  fetched_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(symbol)
);

-- ─── Signals ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS signals (
  id               UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  instrument       VARCHAR(20) NOT NULL,
  direction        VARCHAR(10) NOT NULL CHECK (direction IN ('long','short','hold')),
  entry_price      DECIMAL(18,8),
  stop_loss        DECIMAL(18,8),
  take_profit_1    DECIMAL(18,8),
  take_profit_2    DECIMAL(18,8),
  confidence       SMALLINT NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  risk_reward      DECIMAL(6,2),
  reasoning        TEXT NOT NULL,
  ai_analysis      TEXT NOT NULL,
  news_sentiment   VARCHAR(10) DEFAULT 'neutral' CHECK (news_sentiment IN ('bullish','bearish','neutral')),
  technical_score  SMALLINT DEFAULT 50 CHECK (technical_score BETWEEN 0 AND 100),
  status           VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','triggered','expired','cancelled')),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  expires_at       TIMESTAMPTZ DEFAULT NOW() + INTERVAL '4 hours'
);

CREATE INDEX idx_signals_status ON signals(status);
CREATE INDEX idx_signals_created ON signals(created_at DESC);
CREATE INDEX idx_signals_instrument ON signals(instrument);

-- ─── Trades ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trades (
  id           UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  signal_id    UUID REFERENCES signals(id) ON DELETE SET NULL,
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  instrument   VARCHAR(20) NOT NULL,
  direction    VARCHAR(10) NOT NULL CHECK (direction IN ('long','short')),
  quantity     DECIMAL(18,8) NOT NULL,
  entry_price  DECIMAL(18,8) NOT NULL,
  exit_price   DECIMAL(18,8),
  stop_loss    DECIMAL(18,8),
  take_profit  DECIMAL(18,8),
  pnl          DECIMAL(18,8),
  pnl_pct      DECIMAL(10,4),
  pnl_aed      DECIMAL(18,2),
  status       VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','closed','stopped')),
  is_demo      BOOLEAN DEFAULT FALSE,
  opened_at    TIMESTAMPTZ DEFAULT NOW(),
  closed_at    TIMESTAMPTZ,
  notes        TEXT
);

CREATE INDEX idx_trades_user ON trades(user_id);
CREATE INDEX idx_trades_status ON trades(status);
CREATE INDEX idx_trades_demo ON trades(is_demo);

-- ─── Positions ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS positions (
  id                   UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id              UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  instrument           VARCHAR(20) NOT NULL,
  direction            VARCHAR(10) NOT NULL,
  quantity             DECIMAL(18,8) NOT NULL,
  avg_entry_price      DECIMAL(18,8) NOT NULL,
  current_price        DECIMAL(18,8) NOT NULL DEFAULT 0,
  unrealized_pnl       DECIMAL(18,8) GENERATED ALWAYS AS (
    CASE
      WHEN direction = 'long'  THEN (current_price - avg_entry_price) * quantity
      WHEN direction = 'short' THEN (avg_entry_price - current_price) * quantity
      ELSE 0
    END
  ) STORED,
  unrealized_pnl_pct   DECIMAL(10,4) GENERATED ALWAYS AS (
    CASE
      WHEN avg_entry_price > 0 AND direction = 'long'
        THEN ((current_price - avg_entry_price) / avg_entry_price) * 100
      WHEN avg_entry_price > 0 AND direction = 'short'
        THEN ((avg_entry_price - current_price) / avg_entry_price) * 100
      ELSE 0
    END
  ) STORED,
  stop_loss            DECIMAL(18,8),
  take_profit          DECIMAL(18,8),
  is_demo              BOOLEAN DEFAULT FALSE,
  opened_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, instrument, is_demo)
);

-- ─── Portfolio ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portfolio (
  id               UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id          UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  capital          DECIMAL(18,2) NOT NULL DEFAULT 200000,
  available_capital DECIMAL(18,2) NOT NULL DEFAULT 200000,
  realized_pnl     DECIMAL(18,2) DEFAULT 0,
  win_count        INTEGER DEFAULT 0,
  loss_count       INTEGER DEFAULT 0,
  is_demo          BOOLEAN DEFAULT FALSE,
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, is_demo)
);

-- ─── News ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS news (
  id               UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  headline         TEXT NOT NULL,
  source           VARCHAR(50) NOT NULL,
  url              TEXT,
  sentiment        VARCHAR(10) DEFAULT 'neutral' CHECK (sentiment IN ('bullish','bearish','neutral')),
  sentiment_score  DECIMAL(4,3) DEFAULT 0 CHECK (sentiment_score BETWEEN -1 AND 1),
  instruments      TEXT[] DEFAULT '{}',
  ai_summary       TEXT,
  published_at     TIMESTAMPTZ NOT NULL,
  fetched_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_news_published ON news(published_at DESC);
CREATE INDEX idx_news_sentiment ON news(sentiment);

-- ─── Agent Logs ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_logs (
  id         UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  agent      VARCHAR(30) NOT NULL,
  level      VARCHAR(10) DEFAULT 'info' CHECK (level IN ('ok','warn','error','info')),
  message    TEXT NOT NULL,
  metadata   JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_logs_created ON agent_logs(created_at DESC);
CREATE INDEX idx_agent_logs_agent ON agent_logs(agent);

-- ─── Price History (for charts) ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS price_history (
  id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  symbol      VARCHAR(20) NOT NULL,
  open        DECIMAL(18,8) NOT NULL,
  high        DECIMAL(18,8) NOT NULL,
  low         DECIMAL(18,8) NOT NULL,
  close       DECIMAL(18,8) NOT NULL,
  volume      DECIMAL(24,2) NOT NULL,
  interval    VARCHAR(10) NOT NULL DEFAULT '1h',
  timestamp   TIMESTAMPTZ NOT NULL,
  UNIQUE(symbol, interval, timestamp)
);

CREATE INDEX idx_price_history_symbol ON price_history(symbol, interval, timestamp DESC);

-- ─── Demo Sessions ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS demo_sessions (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  initial_capital DECIMAL(18,2) NOT NULL DEFAULT 200000,
  final_capital   DECIMAL(18,2),
  total_pnl       DECIMAL(18,2),
  total_pnl_pct   DECIMAL(10,4),
  win_count       INTEGER DEFAULT 0,
  loss_count      INTEGER DEFAULT 0,
  max_drawdown    DECIMAL(10,4),
  sharpe_ratio    DECIMAL(8,4),
  total_trades    INTEGER DEFAULT 0,
  status          VARCHAR(20) DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS demo_trades (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  session_id    UUID REFERENCES demo_sessions(id) ON DELETE CASCADE,
  instrument    VARCHAR(20) NOT NULL,
  direction     VARCHAR(10) NOT NULL,
  entry_price   DECIMAL(18,8) NOT NULL,
  exit_price    DECIMAL(18,8),
  stop_loss     DECIMAL(18,8) NOT NULL,
  take_profit   DECIMAL(18,8) NOT NULL,
  quantity      DECIMAL(18,8) NOT NULL,
  confidence    SMALLINT,
  signal_reason TEXT,
  entry_time    TIMESTAMPTZ NOT NULL,
  exit_time     TIMESTAMPTZ,
  exit_reason   VARCHAR(20) CHECK (exit_reason IN ('take_profit','stop_loss','manual','open')),
  pnl           DECIMAL(18,8),
  pnl_pct       DECIMAL(10,4),
  pnl_aed       DECIMAL(18,2)
);

-- ─── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE market_data    ENABLE ROW LEVEL SECURITY;
ALTER TABLE signals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades         ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio      ENABLE ROW LEVEL SECURITY;
ALTER TABLE news           ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_trades    ENABLE ROW LEVEL SECURITY;

-- Public read (market data, signals, news, agent logs, demo)
CREATE POLICY "public_read_market_data"  ON market_data   FOR SELECT USING (true);
CREATE POLICY "public_read_signals"      ON signals        FOR SELECT USING (true);
CREATE POLICY "public_read_news"         ON news           FOR SELECT USING (true);
CREATE POLICY "public_read_agent_logs"   ON agent_logs     FOR SELECT USING (true);
CREATE POLICY "public_read_price_hist"   ON price_history  FOR SELECT USING (true);
CREATE POLICY "public_read_demo_sess"    ON demo_sessions  FOR SELECT USING (true);
CREATE POLICY "public_read_demo_trades"  ON demo_trades    FOR SELECT USING (true);

-- Service role only for writes on shared tables
CREATE POLICY "service_write_market_data" ON market_data   FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_write_signals"     ON signals        FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_write_news"        ON news           FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_write_agent_logs"  ON agent_logs     FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_write_price_hist"  ON price_history  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_write_demo"        ON demo_sessions  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_write_demo_trades" ON demo_trades    FOR ALL USING (auth.role() = 'service_role');

-- User-scoped tables
CREATE POLICY "user_own_trades"     ON trades     FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_own_positions"  ON positions  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_own_portfolio"  ON portfolio  FOR ALL USING (auth.uid() = user_id);

-- ─── Realtime Publications ────────────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE
  market_data, signals, news, agent_logs, trades, positions, portfolio, demo_trades;

ALTER TABLE market_data   REPLICA IDENTITY FULL;
ALTER TABLE signals       REPLICA IDENTITY FULL;
ALTER TABLE positions     REPLICA IDENTITY FULL;
ALTER TABLE demo_trades   REPLICA IDENTITY FULL;

-- ─── Portfolio Update RPC ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_portfolio_on_close(
  p_user_id UUID,
  p_pnl     DECIMAL,
  p_is_demo BOOLEAN,
  p_won     BOOLEAN
) RETURNS VOID AS $$
BEGIN
  UPDATE portfolio
  SET
    realized_pnl     = realized_pnl + p_pnl,
    available_capital = available_capital + p_pnl,
    win_count        = win_count + CASE WHEN p_won THEN 1 ELSE 0 END,
    loss_count       = loss_count + CASE WHEN p_won THEN 0 ELSE 1 END,
    updated_at       = NOW()
  WHERE user_id = p_user_id AND is_demo = p_is_demo;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── Seed: Default portfolio for demo user ────────────────────────────────────
-- Run after creating a user in Auth:
-- INSERT INTO portfolio (user_id, capital, available_capital, is_demo)
-- VALUES ('YOUR_USER_UUID', 200000, 200000, true),
--        ('YOUR_USER_UUID', 200000, 200000, false);

-- ─── Useful Views ─────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW portfolio_summary AS
SELECT
  p.user_id,
  p.capital,
  p.available_capital,
  p.realized_pnl,
  p.win_count,
  p.loss_count,
  CASE WHEN (p.win_count + p.loss_count) > 0
    THEN ROUND(p.win_count::DECIMAL / (p.win_count + p.loss_count) * 100, 1)
    ELSE 0
  END AS win_rate,
  COALESCE(SUM(pos.unrealized_pnl), 0) AS unrealized_pnl,
  p.realized_pnl + COALESCE(SUM(pos.unrealized_pnl), 0) AS total_pnl,
  p.is_demo
FROM portfolio p
LEFT JOIN positions pos ON pos.user_id = p.user_id AND pos.is_demo = p.is_demo
GROUP BY p.id, p.user_id, p.capital, p.available_capital, p.realized_pnl,
         p.win_count, p.loss_count, p.is_demo;
