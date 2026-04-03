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
