# APEX Trading Terminal — Master Project Log

> This file is the single source of truth for the entire APEX project.
> Updated: 2026-04-03 | Author: Adnan (Big Ticket Finance Dept)

---

## 1. WHAT IS APEX?

APEX is an **AI-powered trading terminal** — a Bloomberg-style dashboard that uses 5 Claude AI agents to analyze markets, generate trading signals, manage risk, and review trades automatically. It runs on Next.js 15 with Supabase Realtime for live updates and Vercel for hosting + cron jobs.

**Target**: Crypto (BTC, ETH) + Commodities (Brent, Gold) + Indices (SPY)
**Capital**: AED 200,000 paper trading
**Currency**: AED (UAE Dirham) — AED/USD rate: 3.6725
**Timezone**: Asia/Dubai (Abu Dhabi)

---

## 2. TECH STACK (EXACT VERSIONS)

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js | 15.1.0 |
| Runtime | React | 19.0.0 |
| Language | TypeScript | 5.6.0+ |
| Styling | Tailwind CSS | 3.4.0+ |
| Database | Supabase (PostgreSQL + Realtime) | supabase-js 2.45.0 |
| AI | Anthropic Claude | SDK 0.30.0, Model: claude-sonnet-4-20250514 |
| State | Zustand | 5.0.0 |
| Charts | Recharts | 2.13.0 (imported, not fully used yet) |
| HTTP | Axios | 1.7.0 |
| Icons | Lucide React | 0.460.0 |
| WebSocket | ws | 8.18.0 |
| Dates | date-fns | 4.1.0 |
| CSS Utils | clsx 2.1.1, tailwind-merge 2.5.0 |
| Hosting | Vercel (Pro plan needed for per-minute crons) |
| Notifications | Telegram Bot API |

---

## 3. COMPLETE FILE STRUCTURE (27 files)

```
apex-trading/
├── .env.example                          # All env vars (13 integrations)
├── .gitignore                            # Node, Python, IDE, env, PEM
├── README.md                             # Setup guide
├── APEX_PROJECT_LOG.md                   # THIS FILE — master log
├── package.json                          # 13 deps + 9 devDeps
├── tsconfig.json                         # Strict, bundler resolution, @/* paths
├── next.config.ts                        # typedRoutes, remote images
├── tailwind.config.ts                    # Custom dark theme (Bloomberg style)
├── postcss.config.mjs                    # tailwindcss + autoprefixer
├── vercel.json                           # 4 cron jobs
│
├── types/
│   └── index.ts                          # ALL TypeScript interfaces (307 lines)
│                                         # Signal, Trade, Position, Portfolio,
│                                         # MarketData, OHLCV, NewsItem, AgentLog,
│                                         # AgentContext, AgentSignalOutput,
│                                         # PolymarketEvent, PolymarketMarket,
│                                         # DemoTrade, DemoSession, ApiResponse,
│                                         # PaginatedResponse, AppStore
│
├── agents/
│   └── index.ts                          # 5 AI agents (304 lines)
│                                         # runOrchestrator(), runMarketAnalyst(),
│                                         # runSignalGenerator(), runRiskManager(),
│                                         # runTradeReviewer()
│
├── lib/
│   ├── anthropic.ts                      # Claude wrapper — callAgent<T>() + JSON parsing
│   ├── indicators.ts                     # Technical indicators (208 lines)
│   │                                     # ema, rsi, macd, bollingerBands, atr, sma,
│   │                                     # volumeRatio, computeIndicators, technicalScore
│   ├── price-fetcher.ts                  # Market data fetchers (265 lines)
│   │                                     # fetchBinanceTicker, fetchBinanceKlines,
│   │                                     # fetchBinanceKlinesRange, fetchCoinGeckoMarkets,
│   │                                     # fetchFearGreed, fetchPolymarketMarkets,
│   │                                     # fetchPolymarketPrice, fetchAllMarketData
│   ├── store.ts                          # Zustand store (23 lines)
│   ├── supabase.ts                       # Supabase clients (26 lines)
│   │                                     # createBrowserSupabase, createServiceSupabase,
│   │                                     # getBrowserSupabase (singleton)
│   └── telegram.ts                       # Telegram notifications (163 lines)
│                                         # sendSignalAlert, sendPositionAlert,
│                                         # sendMorningBriefing, sendDailyReport,
│                                         # sendDemoReport
│
├── app/
│   ├── globals.css                       # Dark theme CSS vars + scrollbar
│   ├── layout.tsx                        # Root layout, Inter + JetBrains Mono fonts
│   ├── (dashboard)/
│   │   └── page.tsx                      # Main dashboard (372 lines)
│   │                                     # Components: PriceStrip, SignalCard,
│   │                                     # LogItem, Dashboard
│   │                                     # Tabs: Opportunities, Portfolio, Agents, News
│   └── api/
│       ├── prices/route.ts               # GET /api/prices — latest prices + candles
│       ├── signals/route.ts              # GET /api/signals — active signals
│       └── cron/
│           ├── market-data/route.ts      # Cron: fetch prices, store candles,
│           │                             # update positions, check SL/TP (154 lines)
│           └── signals/route.ts          # Cron: run orchestrator pipeline (21 lines)
│
├── components/
│   └── providers/
│       └── RealtimeProvider.tsx           # Supabase Realtime subscriptions (24 lines)
│                                         # Listens: signals, market_data, agent_logs, positions
│
├── supabase/
│   └── schema.sql                        # Complete DB schema (289 lines)
│                                         # 10 tables + RLS + indexes + views + realtime
│
└── scripts/
    └── demo-backtest.py                  # 5-day paper trading simulation (134 lines)
                                          # Uses real Binance historical data
                                          # March 29 – April 3, 2026
```

---

## 4. DATABASE SCHEMA (10 tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `market_data` | Latest prices | symbol (UNIQUE), price, change_pct_24h, source |
| `signals` | AI trading signals | instrument, direction, entry/SL/TP, confidence, status |
| `trades` | Trade history | user_id (FK auth.users), entry/exit, pnl, pnl_aed |
| `positions` | Open positions | user_id, instrument, direction, unrealized_pnl (GENERATED) |
| `portfolio` | Portfolio state | user_id, capital, available_capital, win_count/loss_count |
| `news` | Market news | headline, sentiment, instruments[], ai_summary |
| `agent_logs` | Agent activity | agent, level (ok/warn/error/info), message, metadata |
| `price_history` | OHLCV candles | symbol, open/high/low/close/volume, interval, timestamp |
| `demo_sessions` | Backtest sessions | start/end dates, capital, pnl, sharpe, max_drawdown |
| `demo_trades` | Backtest trades | session_id (FK), entry/exit, pnl, exit_reason |

**Row Level Security**: All tables have RLS enabled.
- Public read: market_data, signals, news, agent_logs, price_history, demo_*
- Service role writes: shared tables
- User-scoped: trades, positions, portfolio

**Realtime**: market_data, signals, news, agent_logs, trades, positions, portfolio, demo_trades

**Views**: `portfolio_summary` (joined portfolio + positions with computed win_rate)

---

## 5. THE 5 AI AGENTS

### 5.1 Orchestrator (`runOrchestrator`)
- **Schedule**: Every 30 minutes via Vercel cron
- **Flow**: For each instrument (BTC/USD, ETH/USD, BRENT, XAU/USD):
  1. Fetch 200 candles from `price_history`
  2. Compute all indicators
  3. Run Market Analyst → sentiment
  4. Run Signal Generator → signal
  5. If confidence >= 65 and not HOLD → run Risk Manager
  6. If approved → save to DB + send Telegram alert

### 5.2 Market Analyst (`runMarketAnalyst`)
- **Purpose**: Fetch latest 5 news headlines from DB, ask Claude for sentiment
- **Output**: "bullish" | "bearish" | "neutral"
- **Fallback**: Returns "neutral" on any error

### 5.3 Signal Generator (`runSignalGenerator`)
- **Purpose**: Takes full AgentContext (price, RSI, MACD, BB, EMA, ATR, etc.)
- **Prompt rules**:
  - SL within 3-5% for crypto, 2-4% for commodities
  - TP1 at minimum R:R 1.5x
  - TP2 at minimum R:R 2.5x
  - HOLD if confidence < 65
  - Max 5% capital per trade
- **Output**: AgentSignalOutput with direction, prices, confidence, reasoning

### 5.4 Risk Manager (`runRiskManager`)
- **Purpose**: Hard rule validation (no AI call needed)
- **Rules**:
  - R:R must be >= 1.5
  - Cannot exceed max positions (3)
  - Must have SL and entry price
  - SL cannot be wider than 6%
- **Output**: boolean (approved/rejected)

### 5.5 Trade Reviewer (`runTradeReviewer`)
- **Schedule**: Daily at 22:00
- **Purpose**: Reviews yesterday's closed trades, asks Claude for coaching feedback
- **Output**: Concise trading coach review (max 100 words)

---

## 6. CRON JOBS (vercel.json)

| Path | Schedule | Purpose |
|------|----------|---------|
| `/api/cron/market-data` | Every 1 min | Fetch prices, store candles, update positions, check SL/TP |
| `/api/cron/signals` | Every 30 min | Run full orchestrator pipeline |
| `/api/cron/positions` | Every 2 min | Position monitoring (endpoint referenced but not in codebase yet) |
| `/api/cron/demo` | Every 15 min | Demo trading (endpoint referenced but not in codebase yet) |

**Auth**: All cron endpoints require `Bearer {CRON_SECRET}` header.

---

## 7. ALL INTEGRATIONS & ENV VARS

| # | Integration | Env Var(s) | Status |
|---|------------|-----------|--------|
| 1 | **Anthropic Claude** | `ANTHROPIC_API_KEY` | ✅ Fully integrated |
| 2 | **Supabase** | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | ✅ Fully integrated |
| 3 | **Telegram Bot** | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | ✅ Fully integrated |
| 4 | **Binance API** | `BINANCE_API_KEY`, `BINANCE_SECRET_KEY` | ✅ Market data (no auth needed), 🟡 Trading (needs keys) |
| 5 | **CoinGecko** | `COINGECKO_API_KEY` | ✅ Market data |
| 6 | **Fear & Greed** | (no key needed) | ✅ Fully integrated |
| 7 | **Polymarket** | `POLYMARKET_PRIVATE_KEY` | ✅ Read-only, 🟡 Trading (needs key) |
| 8 | **Alpha Vantage** | `ALPHA_VANTAGE_API_KEY` | 🔴 Key in env, not yet coded |
| 9 | **Finnhub** | `FINNHUB_API_KEY` | 🔴 Key in env, not yet coded |
| 10 | **NewsAPI** | `NEWS_API_KEY` | 🔴 Key in env, not yet coded |
| 11 | **Kalshi** | `KALSHI_API_KEY`, `KALSHI_PRIVATE_KEY_PATH` | 🔴 Key in env, not yet coded |
| 12 | **Vercel** | (deployment platform) | ✅ vercel.json configured |
| 13 | **Cron Security** | `CRON_SECRET` | ✅ Protects cron endpoints |

**App Config Vars**:
- `NEXT_PUBLIC_APP_URL` — localhost:3000
- `NEXT_PUBLIC_PAPER_TRADING_CAPITAL` — 200,000
- `NEXT_PUBLIC_CURRENCY` — AED

---

## 8. INSTRUMENTS TRACKED

| Symbol | Source | Binance Pair | Type |
|--------|--------|-------------|------|
| BTC/USD | Binance | BTCUSDT | Crypto |
| ETH/USD | Binance | ETHUSDT | Crypto |
| SOL/USD | Binance | SOLUSDT | Crypto |
| BNB/USD | Binance | BNBUSDT | Crypto |
| BRENT | Yahoo (planned) | BZ=F | Commodity |
| WTI | Yahoo (planned) | CL=F | Commodity |
| XAU/USD | Yahoo (planned) | GC=F | Commodity |
| XAG/USD | Yahoo (planned) | SI=F | Commodity |
| SPY | Yahoo (planned) | SPY | Index |
| EUR/USD | Yahoo (planned) | EURUSD=X | Forex |
| USD/JPY | Yahoo (planned) | JPY=X | Forex |

**Active in orchestrator**: BTC/USD, ETH/USD, BRENT, XAU/USD

---

## 9. TECHNICAL INDICATORS (lib/indicators.ts)

All computed from OHLCV candle data:
- **EMA** (20, 50, 200 periods)
- **SMA** (50 period)
- **RSI** (14 period, Wilder smoothing)
- **MACD** (12/26/9 standard)
- **Bollinger Bands** (20 period, 2 std dev, includes %B)
- **ATR** (14 period)
- **Volume Ratio** (current vs 20-period avg)
- **Technical Score** (0-100, weighted composite of all indicators)

---

## 10. UI / DASHBOARD

**Theme**: Bloomberg terminal dark — bg #03030a, green #00ffa3, red #ff3366
**Fonts**: Inter (sans) + JetBrains Mono (monospace)
**Language**: Bosnian/Croatian (Prilike, Vijesti, Agenti, Pozicije, Kapital)

**4 Tabs**:
1. **Prilike (Opportunities)** — Price strip + AI signal cards with confidence bars
2. **Portfolio** — Capital, Open P&L, Win Rate, Positions table
3. **Agenti (Agents)** — Agent status cards + activity log
4. **Vijesti (News)** — Placeholder (NewsAPI not yet integrated)

**Header**: APEX logo + LIVE indicator + Capital + Open P&L + Fear & Greed + Abu Dhabi clock

**Realtime**: Supabase Realtime subscriptions update signals, prices, agent logs, positions automatically.

---

## 11. DEMO BACKTEST (scripts/demo-backtest.py)

- **Period**: March 29 – April 3, 2026
- **Capital**: AED 200,000
- **Instruments**: BTC/USD, ETH/USD
- **Strategy**: RSI + EMA crossover + Bollinger Bands
- **Risk**: Max 5% per trade, Min R:R 1.5, Slippage 0.05%
- **Output**: JSON report + console summary
- **Data**: Real Binance historical klines (1h)

---

## 12. MISSING / TODO (as of 2026-04-03)

- [ ] `/api/cron/positions/route.ts` — Referenced in vercel.json but not in codebase
- [ ] `/api/cron/demo/route.ts` — Referenced in vercel.json but not in codebase
- [ ] NewsAPI integration (news fetching + AI summarization)
- [ ] Alpha Vantage integration (stock/commodity data)
- [ ] Finnhub integration (stock data)
- [ ] Kalshi integration (prediction market)
- [ ] Yahoo Finance data source (BRENT, WTI, XAU, SPY, forex)
- [ ] Recharts chart components (library imported but not used in UI)
- [ ] User authentication UI (Supabase Auth configured but no login page)
- [ ] Trade execution (currently signals only, no auto-execution)
- [ ] Portfolio RPC function `update_portfolio_on_close` (called but not in schema.sql)
- [ ] `unrealized_pnl_aed` field in positions (referenced in types but not in schema)
- [ ] Mobile responsive improvements
- [ ] Dark/light theme toggle

---

## 13. DEPLOY PLAN

1. Push to GitHub: `https://github.com/adnanmoffice-bt/trader1`
2. Connect to Vercel: Import repo → Add env vars → Deploy
3. Set up Supabase: Run `supabase/schema.sql` in SQL Editor
4. Configure Telegram: Create bot via @BotFather, get chat ID
5. Add API keys: Anthropic, Binance, CoinGecko, etc.
6. Vercel Pro ($20/mo) needed for per-minute crons

---

## 14. CHANGELOG

| Date | Action |
|------|--------|
| 2026-04-03 | Project created — full codebase with 27 files |
| 2026-04-03 | Master log created (this file) |
| 2026-04-03 | Git initialized and pushed to GitHub trader1 |
| 2026-04-03 | Supabase project connected — Project ID: thuamsmvqdngemdkrftk |
| 2026-04-03 | Database schema applied — all 10 tables + portfolio_summary view confirmed |
| 2026-04-03 | .env.local configured — Anthropic + Supabase keys set |
| 2026-04-03 | Fixed: market_data upsert (removed id: undefined → destructure) |
| 2026-04-03 | Fixed: Zustand selectors for React 19 compatibility (store destructure → individual selectors) |
| 2026-04-03 | Fixed: Supabase DECIMAL→string conversion (added Number() parsing in dashboard) |
| 2026-04-03 | Fixed: Turbopack incompatibility (removed experimental.typedRoutes from next.config) |
| 2026-04-03 | Fixed: Missing autoprefixer dependency (npm install autoprefixer) |
| 2026-04-03 | Live prices working — BTC $67,161 ETH $2,071 on dashboard |
| 2026-04-03 | Created /api/seed/price-history — bulk seed 200 candles from Binance |
| 2026-04-03 | Created /api/cron/positions — position monitoring with SL/TP checks |
| 2026-04-03 | Created /api/cron/demo — demo trading simulation endpoint |
| 2026-04-03 | Created /api/agent-logs — agent log fetch endpoint |
| 2026-04-03 | Added update_portfolio_on_close RPC function to schema.sql |
| 2026-04-03 | AI Signal Generator tested — Market Analyst + Signal Generator working |
| 2026-04-03 | BTC/USD & ETH/USD: HOLD (55% conf) — AI correctly conservative in Extreme Fear market |
| 2026-04-03 | Dashboard now shows agent activity logs in Agenti tab |
| 2026-04-03 | Seeded 5 market news items for Market Analyst context |
| 2026-04-03 | Created lib/binance-trader.ts — auto buy/sell/SL/TP execution engine |
| 2026-04-03 | Created lib/polymarket-trader.ts — prediction market betting engine |
| 2026-04-03 | Created lib/risk-controls.ts — daily loss limit, position limits, trade size checks |
| 2026-04-03 | Created Polymarket AI Agent — Claude analyzes prediction markets |
| 2026-04-03 | Created /api/cron/polymarket — auto-scan and bet on prediction markets |
| 2026-04-03 | Created /api/kill-switch — emergency stop all positions |
| 2026-04-03 | Created /api/polymarket/bets + /markets — Polymarket data APIs |
| 2026-04-03 | Added polymarket_bets table to schema.sql |
| 2026-04-03 | Auto-execute: approved signals now auto-trade on Binance when configured |
| 2026-04-03 | Dashboard: added Polymarket tab + Kill Switch button |
| 2026-04-03 | Added polymarket cron to vercel.json (every 30min) |
| 2026-04-03 | SESSION PAUSED — all code complete, waiting for API keys from user |
| 2026-04-06 | MULTI-EXCHANGE: Added 8 exchange adapters (Binance, Bybit, OKX, Kraken, KuCoin, Bitget, Gate.io, MEXC) |
| 2026-04-06 | Created lib/exchanges/ — unified IExchange interface + ExchangeManager |
| 2026-04-06 | Each adapter: getBalances, getTicker, getKlines, marketBuy/Sell, SL/TP, testConnection |
| 2026-04-06 | ExchangeManager: multi-exchange orchestration, best ticker, aggregate balance |
| 2026-04-06 | Backwards compat: lib/exchanges/index.ts exports same API as old binance-trader.ts |
| 2026-04-06 | Updated agents/index.ts to use exchange abstraction instead of direct Binance |
| 2026-04-06 | Updated positions cron to use ExchangeManager for price fetching |
| 2026-04-06 | Updated settings page: 8-exchange selector grid, per-exchange credentials, primary exchange |
| 2026-04-06 | Updated test-exchange API: supports all 8 exchanges with passphrase support |
| 2026-04-06 | Updated schema.sql: primary_exchange + exchange_credentials JSONB fields |
| 2026-04-06 | Updated .env.local: API key slots for all 8 exchanges |
| 2026-04-06 | Updated types/index.ts: ExchangeId + ExchangeInfo types |
| 2026-04-06 | Added fetchMultiExchangeTicker + fetchMultiExchangeKlines to price-fetcher.ts |
| 2026-04-09 | TRADINGVIEW INTEGRATION — Major UI overhaul |
| 2026-04-09 | Installed: lightweight-charts v5.1, lightweight-charts-indicators (446 indicators), react-ts-tradingview-widgets |
| 2026-04-09 | Created components/charts/TradingChart.tsx — professional candlestick chart replacing SVG |
| 2026-04-09 | Features: zoom, pan, crosshair, tooltips, multiple timeframes (1m/5m/15m/1h/4h/1D/1W) |
| 2026-04-09 | Indicators: EMA(20,50), SMA(20), Bollinger Bands(20,2), RSI(14), MACD(12,26,9) as toggleable overlays |
| 2026-04-09 | Volume histogram in separate price scale, synced panes for RSI/MACD sub-charts |
| 2026-04-09 | Series markers: BUY/SELL signal arrows + trade entry/exit execution markers on chart |
| 2026-04-09 | Created components/charts/MultiChart.tsx — multi-chart layout (1x1, 2x1, 2x2, 3x1) |
| 2026-04-09 | Created components/widgets/TickerTape.tsx — TradingView scrolling ticker tape (11 symbols) |
| 2026-04-09 | Created components/widgets/TechAnalysis.tsx — TradingView technical analysis gauge widget |
| 2026-04-09 | Created components/widgets/CryptoHeatmap.tsx — TradingView crypto heatmap widget |
| 2026-04-09 | Created components/widgets/EconomicCalendar.tsx — TradingView economic calendar widget |
| 2026-04-09 | Created components/widgets/CryptoScreener.tsx — TradingView crypto screener widget |
| 2026-04-09 | Created components/widgets/MarketOverview.tsx — TradingView market overview (Crypto/Indices/Commodities) |
| 2026-04-09 | New page: /heatmap — full-screen crypto heatmap by market cap |
| 2026-04-09 | New page: /calendar — economic calendar + market overview split view |
| 2026-04-09 | New page: /multi-chart — 2x2 grid chart layout with independent symbol/timeframe per chart |
| 2026-04-09 | New page: /screener — crypto screener sorted by market cap, performance, oscillators |
| 2026-04-09 | Redesigned dashboard: TradingView-inspired layout (chart 9/12 cols, sidebar 3/12 cols) |
| 2026-04-09 | Dashboard sidebar: tabbed panels (PORTFOLIO / ANALYSIS / SIGNALS) |
| 2026-04-09 | ANALYSIS tab: embedded TradingView Technical Analysis widget per symbol |
| 2026-04-09 | Updated NavBar: added CHARTS, HEATMAP, SCREENER, CALENDAR navigation items |
| 2026-04-09 | Build verified: zero TypeScript errors, all 50 routes compiled successfully |
| 2026-04-09 | TRADESVIZ-INSPIRED ANALYTICS — Performance feedback loop for AI agents |
| 2026-04-09 | New DB tables: trade_analytics (MFE/MAE/exit efficiency/R-value per trade) |
| 2026-04-09 | New DB tables: trade_journal (tags, notes, psychology, setup type, mistakes, lessons) |
| 2026-04-09 | New DB tables: performance_snapshots (daily equity curve, streaks, ratios, Kelly) |
| 2026-04-09 | Created lib/trade-analytics.ts — computeTradeAnalytics, computeDailySnapshot, getPerformanceContext, formatPerformanceForPrompt |
| 2026-04-09 | New cron: /api/cron/analytics — computes MFE/MAE/best exit/R-value for all closed trades |
| 2026-04-09 | New cron: /api/cron/performance — daily snapshot + weekly Performance Coach trigger |
| 2026-04-09 | New agent: Performance Coach (agents/performance-coach.ts) — weekly AI analysis of patterns/mistakes/strengths |
| 2026-04-09 | Enhanced Signal Generator: now receives performance context (WR by instrument, streak, exit efficiency, weaknesses) |
| 2026-04-09 | Enhanced Risk Manager: adaptive rules — loss streak protection, instrument WR filter, drawdown filter |
| 2026-04-09 | Enhanced Trade Reviewer: now analyses MFE/MAE/exit efficiency per trade, identifies cut-winner patterns |
| 2026-04-09 | Orchestrator: skips instruments with historically <30% WR over 10+ trades (performance-based filter) |
| 2026-04-09 | New API: /api/analytics (trade analytics with filters), /api/analytics/equity-curve, /api/analytics/calendar |
| 2026-04-09 | New API: /api/analytics/performance (same context AI agents use), /api/journal (CRUD for notes/tags) |
| 2026-04-09 | New components: EquityCurve (lightweight-charts area), TradeCalendar (PnL grid), PerformanceMetrics (11 KPIs), ExitAnalysis (efficiency viz) |
| 2026-04-09 | New page: /analytics — full performance dashboard (overview + exit analysis + calendar tabs) |
| 2026-04-09 | New page: /journal — trading journal with psychology scoring, tags, setup types, day plans |
| 2026-04-09 | Dashboard sidebar: new PERF tab with real-time performance metrics from analytics engine |
| 2026-04-09 | NavBar: added ANALYTICS, JOURNAL links |
| 2026-04-09 | Build verified: zero TypeScript errors, all 59 routes compiled successfully |
| 2026-04-20 | AUDIT of trades since 2026-04-17 fix: 11 trades, 2W/8L, -5.43%. Fixes confirmed working (no shorts, no SOL/BNB, no BB_SQUEEZE) but TECH_SCORE fallback was buying tops |
| 2026-04-20 | fix: demo cron blocks TECH_SCORE fallback when RSI>72 or BB%B>85 (overbought) |
| 2026-04-20 | fix: demo cron adds 2h cooldown per instrument after SL hit — ends "3 ETH SLs in 60min" pattern |
| 2026-04-20 | fix: /api/signals POST now rejects shorts + SOL/USD/BNB/USD to match war-room policy |
| 2026-04-20 | fix: agents/index.ts hardened — BB_SQUEEZE removed, LONG-ONLY enforced, detectBBSqueeze import dropped |
| 2026-04-21 | AUDIT 24h: 1 new entry, 3 closed (0W/3L, -$220), war-room SILENT for 48h+, all losses at RSI 48-50 mid-range |
| 2026-04-21 | ROOT CAUSE: war-room macro gate paused trading 24h straight whenever 2+ high-impact events in rolling 24h window |
| 2026-04-21 | fix: war-room macro pause narrowed — only pauses for high-impact events within next 4h (was 24h) |
| 2026-04-21 | fix: macro-context no longer sets noTradeReason from high-impact event count — war-room owns that gate |
| 2026-04-21 | fix: demo cron MIN_SCORE 70 → 78 (all 3 recent losses fired at score=83) |
| 2026-04-21 | fix: demo cron TECH_SCORE fallback requires trend alignment (price > EMA20 > EMA50) for LONG |
| 2026-04-23 | ui: nav redesign — 12 top-level items → 5 primary (TERMINAL/WAR ROOM/SIGNALS/ANALYTICS/JOURNAL) + CHARTS/LAB dropdowns with click-outside + Escape close |
| 2026-04-23 | docs: added CONTEXT.md (AI-agent knowledge file) + .cursor/rules/context-load.mdc auto-load rule |
| 2026-04-23 | fix(safety): war-room retries SL placement 3x — if still fails, emergency marketSell closes the position before DB records it as open. If emergency sell also fails, DB flags position as NAKED for manual intervention. |
| 2026-04-23 | fix(safety): positions cron verifies exchange state before DB close — checks asset balance, force-sells via marketSell if pre-placed SL/TP did not fire, skips cycle on exchange-API failure instead of marking DB closed. Uses actual fill price as exit_price. |
| 2026-04-24 | AUDIT 24h: 0 real trades, 0 live-exec attempts, 487 war-room scans but only 1 debate (JSON parse fail). Root causes: (a) 8/11 instruments had broken/missing candles, (b) 3 analyzable majors stuck in RANGING regime rejection, (c) 4h macro pause for US Retail Sales, (d) stale portfolio row from 2026-04-07. |
| 2026-04-24 | fix(data): seed 500 x 1h candles for ADA/DOT/MATIC/NEAR/APT (previously 0 candles — never seeded) and DOGE/AVAX/LINK (previously 226 — below data-quality min). All 11 active instruments now at 500+ fresh candles. |
| 2026-04-24 | fix(data): remap MATIC/USD → POLUSDT in lib/price-fetcher.ts — legacy MATICUSDT klines were frozen at 2024-09-10 after Polygon rebrand to POL. Stale MATIC rows deleted, live POL data re-seeded as MATIC/USD. |
| 2026-04-24 | fix(seed): /api/cron/seed now covers all 13 pairs (added ADA/DOT/MATIC/NEAR/APT) and pulls 500 candles per symbol instead of 200. |
| 2026-04-24 | fix(risk): lib/risk-controls.ts DAILY_LOSS_LIMIT_PCT 0.03 → 0.05. Comment claimed "aligned with safety.ts" since 2026-04-03 but safety.ts was bumped to 0.05 on 2026-04-23 (commit be92ffce) and risk-controls drifted. Now genuinely aligned. |
| 2026-04-24 | fix(portfolio): demo cron portfolio sync now sets updated_at — was silently frozen since 2026-04-07 despite data being current. Also removed orphaned is_demo=true placeholder row; app code only ever reads is_demo=false. |
| 2026-04-24 | chore: added scripts/audit-24h.mjs, audit-candles.mjs, audit-portfolio.mjs, seed-missing-candles.mjs, fix-matic-reseed.mjs, sync-portfolio.mjs — reusable operational tooling for future audits. |
| 2026-04-27 | AUDIT 3-day full system: 0 live trades in 72h, 8 demo trades (2W/4L, +$24.30), 998 war-room cycles all rejected by RANGING gate or stale-data. Polymarket Anthropic 400 = "credit balance too low" (1 batch, billing). |
| 2026-04-27 | fix(data): expand market-data candle list to include ADA/DOT/MATIC/NEAR/APT — previous seed was a one-shot manual backfill; market-data hourly refresher is the only auto-cron and these 5 alts were missing from `candleSymbols`, so they re-froze 72h after Apr 24. Adds note that `/api/cron/seed` is NOT in vercel.json. |
| 2026-04-27 | fix(db): user_settings.daily_loss_limit_pct 3 → 5 (only DB row holding old value; lib/safety.ts and lib/risk-controls.ts both 5 since 04-24). |
| 2026-04-27 | DISCOVERY: schema drift — agent_knowledge, performance_snapshots, trade_analytics, trade_journal, polymarket_bets defined in supabase/schema.sql but ABSENT from prod DB. Net effect: meta-agent prompt-rewrites silent-fail; performance/equity/calendar UI permanently empty; polymarket flat-out broken; trade-journal write feature is a 404 producer. Logged as Hard Truths #25–#28 in CONTEXT.md. No code change yet — needs decision: apply schema vs delete dead features. |
| 2026-04-27 | DISCOVERY: heartbeat logging exists ONLY for market-data-cron (5,533 rows / 168h). Signals, positions, demo, polymarket, meta-agent, morning/daily/weekly reports do NOT log to agent_logs — invisible to operational monitoring. Logged in CONTEXT.md #27. |
| 2026-04-27 | DISCOVERY: 4 crons live in code but NOT in vercel.json — /api/cron/seed, /api/cron/performance, /api/cron/analytics, /api/cron/run-all. Logged in CONTEXT.md #26. |
| 2026-04-27 | chore: npm audit fix on axios 1.14→1.15 + follow-redirects (high vuln gone, 2 moderate postcss-in-next remain — needs Next major bump). |
| 2026-04-27 | chore: added scripts/audit-full-system.mjs, audit-deep.mjs, inspect-schema.mjs, inspect-tables-v2.mjs, list-all-tables.mjs, sync-daily-loss-limit.mjs, inspect-poly-error.mjs — broader operational tooling. |
| 2026-04-27 | feat(ui): live Anthropic API spend tile in StatusBar (`AI $X/$5  Nc`) with hover popover showing today + last-7-day bar chart + by-model split + all-time. /api/budget enriched to aggregate from agent_logs.budget-tracker. |
| 2026-04-28 | TRACE overnight: 4 demo SLs on Apr 27 (24/04 19:15 XAU EMA_CROSS / 27/04 02:45 BTC TECH_SCORE / 27/04 02:45 ETH TECH_SCORE / 27/04 09:30 XAU TECH_SCORE) — total -$294.93. All LONGs entered with BB%B 68-100% (near upper band). 0 trades after 17:15 Apr 27 because of macro pause + RANGING gate. Wallet: $4940.05 → $4718.86 (W7/L19). |
| 2026-04-28 | fix(data): backfill 67h candle gap on ADA/DOT/MATIC/NEAR/APT — bumped scripts/seed-missing-candles.mjs to 1000 candles (Binance max), confirmed MATIC mapped to POLUSDT, re-seeded all 8 alts. price_history now has 1000 continuous 1h candles per alt (was 534 with a 67h hole between Apr 24 seed and Apr 27 deploy). War-room data-quality gate (max 4 missing candles) now passes for all 11 active instruments. |
| 2026-04-28 | fix(war-room): RANGING gate calibrated. Previously rejected EVERY single-trigger signal in `regime==='ranging'`, which blocked 100% of BTC/ETH/XAU/etc for 72h+ in a quiet tape. Now: weak ranges (`strength<0.5`, i.e. emaSpread 0.5-1%, almost trending) accept a single STRONG trigger (EMA 12/26 Cross / MACD Crossover / EMA 50 Breakout). RSI Extreme + Volume Spike alone are still gated. Strong ranges (`strength>=0.5`) keep 2+ trigger requirement. Downstream gates unchanged: trend filter, backtest>=35%, vote margin>2, forecast veto, daily-loss limit. Calibration, not removal. Logged as Hard Truth #30. |
| 2026-04-28 | chore: added scripts/trace-overnight-losses.mjs — pulls last 36h of demo_trades + portfolio + sessions for fast post-mortems. |