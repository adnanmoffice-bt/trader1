# APEX — AI Trading Terminal

> Bloomberg-killer trading dashboard powered by Claude AI agents, Supabase Realtime, and Vercel.

## Stack
- **Frontend**: Next.js 15 + TypeScript + Tailwind CSS
- **Database**: Supabase (PostgreSQL + Realtime WebSocket)
- **AI Agents**: Anthropic Claude Sonnet 4
- **Hosting**: Vercel (cron jobs + API routes)
- **Notifications**: Telegram Bot
- **Data**: Binance API + CoinGecko + Fear & Greed + Polymarket

## Quick Start

```bash
# 1. Clone
git clone https://github.com/adnanmoffice-bt/trader1.git
cd trader1

# 2. Install
npm install

# 3. Environment
cp .env.example .env.local
# Fill in your keys (see .env.example for instructions)

# 4. Database — paste supabase/schema.sql into Supabase SQL Editor

# 5. Run
npm run dev
```

## Project Structure

```
apex-trading/
├── app/
│   ├── (dashboard)/page.tsx    # Main dashboard UI
│   └── api/
│       ├── cron/               # Vercel cron jobs
│       ├── signals/            # Signal API
│       └── prices/             # Price API
├── agents/index.ts             # All 5 AI agents
├── lib/
│   ├── supabase.ts            # DB client
│   ├── anthropic.ts           # Claude client
│   ├── indicators.ts          # RSI, MACD, BB, EMA
│   ├── price-fetcher.ts       # Binance, CoinGecko, Polymarket
│   ├── telegram.ts            # Notifications
│   └── store.ts               # Zustand state
├── types/index.ts             # All TypeScript types
├── supabase/schema.sql        # Complete DB schema
├── scripts/demo-backtest.py   # 5-day paper trading demo
└── vercel.json                # Cron schedule
```

## Agents

| Agent | Schedule | Purpose |
|-------|----------|---------|
| Orchestrator | Every 30min | Coordinates all agents |
| Market Analyst | Every 15min | News sentiment via Claude |
| Signal Generator | Every 30min | RSI+MACD+BB → LONG/SHORT |
| Risk Manager | Per signal | Validates R:R, SL, position limits |
| Trade Reviewer | Daily 22:00 | Reviews closed trades |

## 5-Day Demo Backtest

```bash
pip install requests --break-system-packages
python3 scripts/demo-backtest.py
```

Simulates March 29–April 3, 2026 using real Binance historical data.

## Environment Variables

See `.env.example` for all required and optional keys.

## Deploy to Vercel

```bash
# Push to GitHub
git add . && git commit -m "feat: initial APEX trading terminal"
git push origin main

# Connect to Vercel dashboard → Import repo → Add env vars → Deploy
```

**Note**: Vercel Pro required for per-minute cron jobs ($20/mo).

---

Built by Adnan — Big Ticket Finance Department
