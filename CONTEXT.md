# APEX — AI Agent Knowledge File

> Pročitaj OVO, plus `APEX_PROJECT_LOG.md` (master log korisnika) i `.cursor/rules/apex-trading.mdc`, prije bilo kakvog rada.
> Posljednje ažurirano: 2026-04-23 nakon kloniranja na novi kompjuter.

---

## TL;DR — Šta je APEX trenutno

- **Bloomberg-style AI trading terminal** koji **trguje pravim novcem** na Binance-u.
- 12 ekspertnih AI agenata vode "War Room" debatu prije svake trgovine.
- Meta Agent svakodnevno (cron) ocjenjuje agente i auto-prepisuje slabe sistem-promptove.
- Live URL: **https://trader1-nu.vercel.app/** (Vercel region: `lhr1` = London).
- Korisnik: 1 admin user (Adnan). Login na `/login`, dashboard na `/`.
- Trenutni kapital reference: ~$5000 USD (NE više AED — migriran u commit `d730a9c`).

## Tech stack (lock-stepped verzije)

- Next.js **^16.2.2** (turbopack), React **19**, TypeScript strict, Tailwind 3.4.
- Supabase (Postgres + Realtime + RLS + Auth).
- Anthropic Claude **claude-sonnet-4-20250514**, SDK ^0.82.0.
- Charts: `lightweight-charts` 5.1 + `lightweight-charts-indicators` + `react-ts-tradingview-widgets`.
- Exchange SDK: `@binance/spot` ^28 + custom adapters za 7 drugih exchange-eva.
- Path alias: `@/*` → root.

## Repo + Deploy

- GitHub: `adnanmoffice-bt/trader1`
- Branch: `main` (jedini, nema PR review-a, push direktno)
- Vercel: auto-deploy na push, region `lhr1`, **Vercel Pro** (potrebno za per-min crons).
- `package.json` name: `apex-trading`, ali repo se zove `trader1`.

---

## Arhitektura — fajl by fajl (samo bitno)

### `agents/`

| Fajl | Šta radi |
|---|---|
| `war-room.ts` | **Glavna mašina.** Čita 12 instrumenata, detektuje triggere, vodi 12-agent debatu, donosi EXECUTE/REJECT odluku, snima u DB, šalje Telegram+WhatsApp, otvara demo poziciju, i AKO `user_settings.trading_mode='live'` → izvršava REAL trade na Binance-u. |
| `agent-prompts.ts` | Sistem promptovi za svih 12 agenata (Macro, Correlation, Bull-ICT, Bear-Wyckoff, Scalper, Trend, Market-Analyst, Signal-Generator, Risk-Manager, Trade-Reviewer, Master-Agent, Orchestrator). Token limiti po agentu. |
| `meta-agent.ts` | Daily review (06:00 Dubai cron) + Weekly deep review (Nedelja 08:00). Skoruje svakog agenta po historijskoj tačnosti, AUTO-GENERIŠE poboljšane promptove i sprema u `agent_knowledge` tablu. War-room onda preferira DB prompt nad default-om. |
| `performance-coach.ts` | Sedmična AI analiza pattern-a/grešaka/snaga. |
| `index.ts` | Stari `runOrchestrator` (legacy, prije war-room migracije). |

### `lib/`

| Fajl | Ključno |
|---|---|
| `anthropic.ts` | `callAgent<T>()` — JSON parser, daily budget gate (`getDailyBudgetStatus()`). |
| `safety.ts` | `checkSafety()` — kill-switch, drawdown (75% hard stop), daily loss (5% Dubai-day boundary), max 3 pozicije. `getRecoveryMode(dd)` → 4 tier-a: Normal / Cautious(10-25%) / Recovery(25-50%) / Survival(>50%). `dubaiDayStartUTC()` jer Dubai UTC+4. |
| `risk-controls.ts` | `hardRiskCheck`, `checkDailyLossLimit`, `getTradeStats` (Kelly), `riskBasedPositionSize`. |
| `indicators.ts` | EMA, RSI, MACD, BB (sa %B), ATR, volume ratio, `technicalScore`, `detect*` triggeri (`EMACross`, `MACDCross`, `RSIExtreme`, `EMA50Breakout`, `VolumeSpike`, BBSqueeze REMOVED), `detectRegime`, `quickBacktest`. |
| `forecast.ts` | ARIMA + Monte Carlo + Seasonality + vol regime → `combinedSignal` (-100..100). |
| `macro-context.ts` | VIX, DXY, US10Y, Oil, F&G, yield curve, upcoming high-impact events. War-room pauza ako event < 4h dalje. |
| `data-quality.ts` | `validateOHLCV` — gate prije agenata. |
| `exchanges/` | 8 exchange adaptera (Binance, Bybit, OKX, Kraken, KuCoin, Bitget, Gate.io, MEXC) + `ExchangeManager`. `getPrimaryExchange()` se koristi u war-room exec putanji. |
| `supabase.ts` + `supabase-server.ts` | Browser i server klijenti razdvojeni (build fix). Server NIKAD anon key. |
| `telegram.ts` | `sendSignalAlert`, `sendPositionAlert`, daily/morning/weekly reports. |
| `whatsapp.ts` | Green API. Šalje War Room scan/open/debate/decision/blocked. |
| `trade-analytics.ts` | MFE/MAE/exit-efficiency/R-value, Performance Coach context. |
| `profit-engine.ts` | Allokacija profita. |

### `app/api/`

- `auth/` — Supabase auth (login/logout/me/callback).
- `cron/` (10 cron job-ova, vidi `vercel.json`):
  - `market-data` (svaki 2min) — fetcha cijene, svjećnjake, update pozicija, SL/TP check
  - `signals` (svakih 15min) — pokreće war-room
  - `positions` (svaki 2min) — monitoring, reconcile sa exchange-om
  - `polymarket` (06:00) — prediction market scan/bet
  - `demo` (svakih 15min) — demo trading
  - `meta-agent` (02:00) — daily review
  - `meta-weekly` (Nedelja 04:00) — weekly deep review
  - `morning-briefing` (02:05) — Telegram brief
  - `daily-report` (18:00)
  - `weekly-report` (Nedelja 18:10)
- `debug/env-check` — provjera env-a na Vercel-u (zaštićeno CRON_SECRET).
- `signals`, `safety`, `kill-switch`, `wallet`, `budget`, `analytics/*`, `journal`, `agent-logs`, `polymarket/*`, `war-room`, `whatsapp/*`, `settings/*` — REST API.

### `app/(dashboard)/` rute (vidljive korisniku)

`/` (dashboard), `/war-room`, `/signals`, `/simulation`, `/journal`, `/analytics`, `/multi-chart`, `/screener`, `/heatmap`, `/calendar`, `/polymarket-page`, `/investor`, `/ai-log`, `/settings`.

### `supabase/schema.sql` — 10+ tabela

`market_data, signals, trades, positions, portfolio, news, agent_logs, price_history, demo_sessions, demo_trades, polymarket_bets, war_room_messages, agent_knowledge, trade_analytics, trade_journal, performance_snapshots, user_settings`.

RLS: enabled na svim tablama. Realtime: large allow-list.

---

## Tvrde, naučene istine (ZAPAMTI ovo)

> Ovo su lekcije koje su koštale stvarnog novca. Ne zaobilazi.

1. **LONG-ONLY mode aktivan.** Shorts: 0W / 37L = -$3,405. War-room blokira sve `triggerDir === 'short'`. Signali POST API isto odbija shorts.
2. **SOL/USD i BNB/USD su BLACKLISTED** (0/16 i 0/12 win rate, -$2,628 ukupno). Vidi `ALL_INSTRUMENTS` u `war-room.ts`.
3. **BB_SQUEEZE trigger je TVRDO ONEMOGUĆEN** (2W/31L = -$3,211 = -94% win rate). Ne dodavati nazad bez dokaza.
4. **MIN_SCORE 78** (bilo 70) za demo cron TECH_SCORE fallback. RSI > 72 ili BB%B > 85 → blokirano (overbought).
5. **2h cooldown po instrumentu nakon SL hit.** Sprečava "3 ETH SLs in 60min" pattern.
6. **War Room cooldown: 120 min** između debata na istom instrumentu (bilo 30min).
7. **Macro pause: SAMO ako high-impact event < 4h** (bilo 24h — to je gušilo trgovinu 48h+ jer SAD calendar uvijek ima Fed speech ili Jobless Claims).
8. **Drawdown hard-stop: 75%** (bilo 3% pa 25%). Ostalo se rješava recovery mode tier-ovima — ne hard-block-om.
9. **Daily loss limit: 5%** (bilo 3%). 3% = 2 SL-a u Dubai jutru = block cijeli dan.
10. **Day boundary: Dubai midnight (UTC+4)**, NE UTC. Vidi `dubaiDayStartUTC()`.
11. **Sve cijene/PnL u USD.** AED je uklonjen u commit `d730a9c`. Nema više `pnl_aed`, `notional_aed` osim u legacy types.
12. **Trend filter:** ne otvaraj LONG ako `forecast.smoothedTrend === 'down'` i MC P(up 4h) < 45%.
13. **Backtest gate:** war-room blokira ako `quickBacktest` daje < 35% win rate na recent data.
14. **Vote gate:** treba `votesFor > votesAgainst + 2` (najmanje 3 bull-a više) inače REJECT.
15. **Forecast veto:** ako `forecastContradict && conviction < 80` → REJECT.
16. **JSON-only orchestrator output.** Ako parse padne → automatski REJECT (safety default).
17. **`canWithdraw` gate je DISABLED** (per user request 2026-04-23, commit `4d5155e`). API ključ ima withdraw permisiju. Ako bude kompromitovan — rotirati key sa Withdrawals=disabled.
18. **`pg` u devDependencies** je za potrebe lokalnih SQL-skripti, NE za production.
19. **`oakscriptjs` je u dependencies** ali se ne koristi nigdje — nijesam siguran zašto je tu, ne diraj.

## Real-money execution gates (ALL must be true u `war-room.ts`)

```
1. user_settings.trading_mode === 'live'
2. user_settings.auto_trade_enabled === true
3. user_settings.user_id postoji
4. Primary exchange ima credentials (env ili DB)
5. testConnection().success && .canTrade
6. notional >= exchange.minOrderSize (default $10)
7. quoteBalance (USDT) >= notional
```

Bilo koji false → samo demo trade, nema real exec. Sve loguje u `agent_logs` agent='live-exec'.

## Aktivni instrumenti

```ts
['BTC/USD', 'ETH/USD', 'XAU/USD',
 'DOGE/USD', 'AVAX/USD', 'LINK/USD',
 'ADA/USD', 'DOT/USD', 'MATIC/USD', 'NEAR/USD', 'APT/USD']
// SOL/USD, BNB/USD su BLACKLISTED.
// BRENT, WTI, XAU, SPY itd. su u Instrument tipu ali se trenutno ne traguju aktivno.
```

XAU/USD i Yahoo-source instrumenti su revived u commit `bcbbad3` (oil/commodities preko Yahoo simbola).

---

## Tabela env varijabli (provjera preko `/api/debug/env-check`)

Bitno: `BINANCE_API_KEY`, `BINANCE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `CRON_SECRET`, `GREEN_API_TOKEN`, `GREEN_API_INSTANCE_ID`, `GREEN_API_GROUP_ID`, `TELEGRAM_BOT_TOKEN`. (Plus opciono: `COINGECKO_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `FINNHUB_API_KEY`, `NEWS_API_KEY`, `KALSHI_*`, `POLYMARKET_PRIVATE_KEY`.)

`.env.example` je u repo-u, ali `.env.local` MORA biti pull-an iz Vercel-a kad treba lokalni dev.

---

## Pre-flight checklist prije bilo kakve izmjene war-room/safety/risk koda

- [ ] Pročitao `APEX_PROJECT_LOG.md` (najnoviji changelog)
- [ ] Pročitao git log zadnjih 10 commit-ova
- [ ] Provjerio da promjena ne otvara nazad SHORTS, SOL, BNB, BB_SQUEEZE
- [ ] Ne smanjuje gate-ove (cooldown, MIN_SCORE, vote margin, forecast veto)
- [ ] Ako se mijenja safety.ts → testirati hand-trace `dubaiDayStartUTC` (TZ je trick)
- [ ] Po završetku: dopisati red u changelog tabelu `APEX_PROJECT_LOG.md` (datum + akcija)

## Najčešći build/runtime error-i (već fixani — ne ponavljaj)

- Supabase client mora biti razdvojen (`supabase.ts` browser, `supabase-server.ts` server) inače Next 15+ build pukne.
- Anthropic SDK je blokiran u Singapuru — Vercel region MORA biti `lhr1`.
- Binance je blokiran u US — region NE smije biti `iad1`.
- Zustand selektori za React 19: koristi individual selektore, ne destructure cijelog store-a.
- Supabase DECIMAL → string: dashboard MORA `Number(...)` prije računa.
- `unrealized_pnl` je GENERATED kolona u positions tabeli — ne pokušavaj insert/update.
