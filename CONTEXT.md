# APEX — AI Agent Knowledge File

> Pročitaj OVO, plus `APEX_PROJECT_LOG.md` (master log korisnika) i `.cursor/rules/apex-trading.mdc`, prije bilo kakvog rada.
> Posljednje ažurirano: 2026-04-29 nakon otkrića Binance Auto-Subscribe to Simple Earn trap-a.

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
20. **MATIC/USD je mapiran na POLUSDT na Binance-u** (Polygon rebrand Sept 2024). Legacy `MATICUSDT` ticker i dalje vraća `ticker/24hr`, ali `klines` podaci su zaleđeni na 2024-09-10. Fixano u `lib/price-fetcher.ts` 2026-04-24.
21. **`lib/risk-controls.ts` i `lib/safety.ts` MORAJU imati ISTI `DAILY_LOSS_LIMIT_PCT`.** Oba su 0.05 (5%) od 2026-04-24 (audit je pronašao da je risk-controls ostao na 0.03 dok je safety.ts bio 0.05 — commit `be92ffce`). Provjeri oba ako mijenjaš jedan.
22. **`portfolio.is_demo=true` red je obrisan 2026-04-24** — app koristi samo `is_demo=false` red. Demo cron sada šalje `updated_at` da se timestamp ne zaledi.
24. **Hourly candle refresh lista MORA biti u `app/api/cron/market-data/route.ts` `candleSymbols` array — NE u `app/api/cron/seed/route.ts`.** Seed cron NIJE registrovan u `vercel.json` i ne pokreće se automatski. ALT 5 (ADA/DOT/MATIC/NEAR/APT) su prvo seedovani 2026-04-24, ali su zamrzli 72h kasnije jer market-data cron ih nije refreshovao. Fixano 2026-04-27 (commit nakon ovog audita).
25. **DB SCHEMA DRIFT — nedostaju tabele koje kod referencira** (otkriveno 2026-04-27): `agent_knowledge`, `performance_snapshots`, `trade_analytics`, `trade_journal`, `polymarket_bets`. Sve su definisane u `supabase/schema.sql` ali nikad nisu primjenjene na trenutnu Supabase instancu. Posljedica: meta-agent može da računa, ali ne može da PERSISTUJE auto-prepisane prompte (silent fail kroz try/catch). Performance cron (koji ionako nije u vercel.json) bi pisao u nepostojeću tabelu. Equity-curve i Calendar UI vraćaju prazne podatke. Polymarket je potpuno mrtav (404 na svaki insert). **Plan**: ili primijeniti `schema.sql`, ili obrisati cijeli paket feature-a koji se ne koristi i čisto zatvoriti rupe.
26. **Crons koji POSTOJE u kodu ali NISU u `vercel.json`** (otkriveno 2026-04-27): `/api/cron/seed`, `/api/cron/performance`, `/api/cron/analytics`, `/api/cron/run-all`. Ne pokreću se. Performance i analytics su namijenjene za daily snapshot/equity-curve — ali bez tabela ionako ne bi radile.
27. **Heartbeat logging postoji SAMO u `market-data` cron-u** (otkriveno 2026-04-27). Signals/positions/demo/polymarket/meta-agent/morning-briefing/daily-report/weekly-report NEMAJU `agent_logs.insert({ agent: 'X-cron', ...})` na ulasku/izlasku — pa ne znamo da li uopće rade. Treba dodati standardizovan heartbeat helper.
28. **`user_settings.currency = 'AED'`** ali kod (war-room, safety, portfolio sync) tretira sve kao USD. Polje je legacy iz pre-`d730a9c` tranzicije. Ne mijenjati u live mode-u dok se ne potvrdi da nema reference na njega u trade-write path-u.
23. **`TELEGRAM_BOT_TOKEN` TRENUTNO NIJE postavljen na Vercel prod-u** (utvrđeno 2026-04-24 preko `/api/debug/env-check`). Telegram alerti su mrtvi. WhatsApp (Green API) radi i zamjenjuje ih.
29. **Candle gap backfill protokol** (otkriveno 2026-04-28): Kad market-data cron NIJE pokrivao neki simbol N sati, on će kasnije refreshovati samo zadnjih 5 candles po pozivu — što ostavlja N-satnu rupu zauvijek. War-room data-quality gate odbija svaki instrument sa >4 missing candles u zadnjih 200. Posljedica: ADA/DOT/MATIC/NEAR/APT su imali 67-satnu rupu (Apr 24 seed → Apr 27 deploy) i bili su odbacivani 24h+ čak i nakon što je candle list fix pušten u prod. **Fix protokol**: nakon SVAKE izmjene `candleSymbols` liste u market-data cron, OBAVEZNO pokrenuti `node scripts/seed-missing-candles.mjs` da popuni rupu (1000 candles back-fill). Ne oslanjati se na cron forward-fill.
30. **RANGING gate je kalibriran 2026-04-28** (`agents/war-room.ts` ~linija 289). Prethodno je odbacivao SVAKI single-trigger signal u ranging regime-u — to je 100% blokiralo BTC/ETH/XAU/etc kroz 24-72h jer je tržište bilo flat. Sad: za **slabe range-eve** (`regime.strength < 0.5`, što znači emaSpread 0.5-1%, blizu trending granice) DOZVOLJEN je single STRONG trigger (EMA 12/26 Cross, MACD Crossover, EMA 50 Breakout). RSI Extreme i Volume Spike sami **nisu** strong. Strong range (`strength >= 0.5`) i dalje traži 2+ triggera. Downstream gate-ovi (trend filter, backtest >= 35%, vote margin > 2, forecast veto, daily-loss) i dalje rade — ovo je kalibracija, ne uklanjanje.
31. **Binance Auto-Subscribe to Simple Earn TRAP** (otkriveno 2026-04-29). Binance ima feature koji svake noći oko **22:00 Dubai** automatski sweep-uje SVE idle USDT/USDC/BNB/itd. sa Spot wallet-a u Simple Earn flexible. Vidi se u `/sapi/v1/simple-earn/flexible/history/subscriptionRecord` kao `type=AUTO`. Konkretan slučaj: 23/04 u 12:22 transferirano je 500 USDT Funding → Spot, ali u 22:04 istog dana Binance ih je vratio u Earn (`amount=500.00005, type=AUTO, src=SPOT`). War-room je poslije čitao Spot USDT = $0.01 i tiho odbijao real exec na svakom signalu (gate 7: `quoteBalance < notional`). **Posljedica**: u zadnjih 30 dana 0 spot fills, 0 `live-exec` log entries, iako je `trading_mode=live`. **Fix je MANUELNI** — Binance API NE može gasiti Auto-Subscribe. Korak po korak: Binance UI → Earn → Simple Earn → Manage (gear icon) → Auto-Subscribe → toggle OFF za USDT (i bilo koji drugi quote asset). Alternativno: Wallet → Auto-Invest → pauzirati USDT planove. Tek poslije toga `scripts/move-funding-to-spot.mjs --amount=N --confirm` ostaje na Spot-u. Skripta ima built-in guard koji detektira AUTO subscriptions u zadnjih 7d i odbija prebaciti dok god je sweep aktivan (override sa `--force`).
32. **Asia-chop session gate (2026-04-30)** — `lib/session-filter.ts`. 10-day audit pokazao 0/8 win rate u Dubai 02:00–09:00 prozoru (svi LONG-ovi). Filter blokira normal-conviction LONG-ove u tom prozoru osim ako `conviction >= 90 AND macroRisk <= MEDIUM`, ili `triggerCount >= 3`. Ostali prozori: 33% (London/NY overlap), 67% (NY pm + Asia open) — neograničeni. Implementiran kao decision-time gate u `agents/war-room.ts`.
33. **Correlation dedup (2026-04-30)** — `lib/correlation-dedup.ts`. Audit pokazao da su BTC i ETH co-traded 3/3 puta u 10-dnevnom prozoru: ista vjerovatnoća, 2x size, 2x variance. Hard-blok na drugu LONG-u na 0.9+ koreliranom peer-u (BTC↔ETH). Soft-flag na alt buckets (LINK/AVAX/DOT, MATIC/NEAR/APT). Lookback prozor: 4h za "recent decisions" + sve trenutno otvorene `is_demo=false` pozicije. Implementiran kao decision-time gate.
34. **Derivatives positioning gate (2026-04-30)** — `lib/derivatives.ts`. Free Binance USDT-M perp endpoints (premiumIndex, fundingRate, openInterestHist, globalLongShortAccountRatio, topLongShortPositionRatio). Hard-veto: funding > 0.05%/8h (longs paying premium → flush rizik) ili retail L/S > 2.5 (extreme retail-long → kontrarno). Soft conviction adjusts (+8 / -8 / +6 / -6 / -12 / +5) feeds u `effectiveConviction`. Pre-debate gate da uštedi tokene; soft adjusts u prompt orchestratora i finalnoj odluci. Fail-open ako endpoint vrati grešku.
35. **Order-book health (2026-04-30)** — `lib/orderbook.ts`. Pre-exec spot depth/spread check (`/api/v3/depth`). Blokira ako spread > 5bps (majors) / 20bps (alts) ili ako top-3 same-side depth < 20× notional. Direktan fix za "got filled, instant SL" pattern (3/13 stop-outa u audit-u u <30 min). Samo za live exec putanju, fail-open. Ne pogađa demo trade.
36. **TP kalibracija v3 (2026-04-30)** — `agents/war-room.ts` SL/TP block. Iz `tpMult=4.5, tp2Mult=6.0` (R:R 2.25 / 3.0) prešli na `tpMult=3.0, tp2Mult=5.0` (R:R 1.5 / 2.5). Razlog: svaki +2.25R move prošao kroz +1.5R — pa svi historic winneri ostaju winneri ali losers koji su tagnuli +1.5R prije reverse-a sad postaju winneri. R:R 1.5 = MIN_RR floor pa hardRiskCheck i dalje prolazi. Backtest gate auto-revalidira jer prima tpMult kao argument. **OPEN WORK**: partial-fill (50% TP1 + 50% TP2) + break-even-stop logic in positions cron — TP2 vec je u `signals.take_profit_2` da bi positions cron mogao to konzumirati u budućnosti.
37. **MTF confluence + macro-HIGH strictness (2026-04-30)** — `lib/indicators.ts` `multiTimeframeConfluence(candles1h)` agregira 1H candle stream u 4H i 1D buckets, vraća `longConfluenceCount` (0/1/2). War-room blokira single-trigger 1H LONG kad je MTF count = 0 (oba HTF bearish). Macro `riskLevel === 'HIGH'` sad zahtijeva 3+ triggera u confluence-u (EXTREME već zaustavlja cijeli war-room iznad).
38. **External-intelligence gates (2026-04-30, sve fail-open)** — `lib/news-impact.ts` (Claude scoring last-60min RSS feeds, veto na score <= -40, ~$0.005 po pozivu, decision-time), `lib/cme-gaps.ts` (BTC=F vs spot, +/-5 conviction nudge, BTC LONG only, pre-debate), `lib/onchain.ts` (stub interface — kad se priveže CryptoQuant/Glassnode free tier, hard veto na $50M+ net inflow u 24h). Sve veto putanje koriste isti `speak(decision/close) → waBlocked → runPostMeetingBrief → return 'blocked-X'` pattern.
40. **External Telegram signals path (2026-05-13, OPERATOR-AUTHORISED RULE OVERRIDE).** Ingestor cron `/api/cron/telegram-ingestor` (every 2min) reads messages from Telegram group `-3910126970` via Bot API; **Signal Feed channel auto-forwards land here as Telegram-forward messages and are the only thing the system trusts** (`TELEGRAM_SIGNALS_REQUIRE_FORWARD=true`, `TELEGRAM_SIGNALS_FORWARD_FROM=Signal Feed`). Parser v1 (`v1-signal-feed-2026-05-13`) handles the Signal Feed format: emoji direction (🔴/🟢), entry range (`4699 – 4698`), TP1–TP4 with pip annotations, SL with pip annotation, `0.10 lots per $1000` sizing hint. Phase 3 executor `/api/cron/telegram-executor` (every 1min) drains `execution_status='pending'` rows to real IG orders via `IGExchange.openMarketPosition()` (atomic SL+TP). Two-flag staging: `TELEGRAM_SIGNALS_EXECUTOR_ENABLED` gates the executor entirely; `TELEGRAM_SIGNALS_EXECUTOR_DRY_RUN` further gates real IG POSTs. Operator flips both to go live.

    **The operator explicitly authorised on 2026-05-13 (chat log preserved in HANDOFF.md SESSION LOG):**
    - Bypass of the probe-week kill switch ($200 weekly cap) for the external-signals path
    - Bypass of the daily 5% loss limit for the external-signals path
    - Bypass of the SOL/USD, BNB/USD, shorts, and BB_SQUEEZE workspace blacklist for external signals (per-rule basis — internal war-room signals STILL respect them all)
    - Skip-demo, straight-to-live once Phase 3 is enabled
    - Source trust based on operator's own >30-signal >30-day track record on that channel

    **What is still enforced** (these are physical/operational floors, not relaxable preferences):
    - Instruments outside `IG_INSTRUMENTS` map (BTC, ETH, XAU, XAG, WTI, BRENT, EUR/USD, GBP/USD, USD/JPY, SPY, QQQ) are SKIPPED with `skip_reason='unknown-instrument'` — no Binance routing.
    - War-room internal path (`agents/war-room.ts`) safety stack is UNAFFECTED. Probe-week kill, blacklist, edge gate all stay wired for internal signals. The override is path-local.
    - **Freshness floor** (2026-05-13b): signals older than `TELEGRAM_SIGNALS_MAX_AGE_MIN` (default 5 min) are skipped with `skip_reason='stale'`. Backwards orders against a market that already moved past SL are physically wrong, not "safety preferences".
    - **Direction consistency**: parser AND executor both reject signals where SL is on the profit side of entry (LONG with SL ≥ entry, SHORT with SL ≤ entry). Same for TP1.
    - **One-shot per row**: each `external_signals` row is locked to `executed`/`failed`/`skipped` before the cron loop continues. Re-runs after failure NEVER re-fire.
    - **Atomic SL+TP**: orders use `IGExchange.openMarketPosition()` which attaches `stopLevel` + `limitLevel` in the same POST. No naked-position window between order fill and SL placement.

    **How to revert path-level kill or graduate to live:**
    - Disable executor: set `TELEGRAM_SIGNALS_EXECUTOR_ENABLED=false` in Vercel env (immediate, no redeploy needed).
    - Disable cron entirely: remove `/api/cron/telegram-ingestor` line from `vercel.json`.
    - Manual review: `SELECT * FROM external_signals WHERE execution_status='pending' ORDER BY created_at DESC LIMIT 50` shows what would have/has executed.

    **Why this is documented as a Hard Truth even though no money has been spent yet:** it's the first time in APEX history the workspace blacklist + kill switch have been opened for ANY path. If this loses money, the audit trail must show the operator's accountable decision and the per-path scope. Future agents reading this: if you see real losses on external-signal path, DO NOT touch war-room safeties — they were never the cause.

42. **External-signal pipeline is XAU/USD only (2026-05-13c, OPERATOR SCOPE).** Operator on 2026-05-13 ~17:00 Dubai: _"we are just trading XAUUSD here ... signals are only that"_. Executor reads `TELEGRAM_SIGNALS_ALLOWED_INSTRUMENTS` (default `XAU/USD`) and rejects everything else with `skip_reason='not-in-allowlist'`. The ingestor still writes all parsed signals to `external_signals` (for audit), but the executor never touches them. To extend later (e.g. add EUR/USD when operator trusts that signal stream), edit the Vercel env var — no code change.

43. **Telegram webhook (push) replaces cron polling for ~1s execution latency (2026-05-13c).** New endpoint `/api/telegram/webhook` accepts Telegram POSTs (verified via `X-Telegram-Bot-Api-Secret-Token` header against `TELEGRAM_WEBHOOK_SECRET`). On inbound: parse, insert (idempotent on `(source, external_message_id)`), and synchronously call `tryExecuteSignalById()` if the executor is enabled. Total latency ~500ms warm / ~900ms cold. The cron-based path (`/api/cron/telegram-ingestor` + `/api/cron/telegram-executor`) is retained as a safety net but is mutually exclusive with the webhook — Telegram's Bot API enforces "Conflict: terminated by other getUpdates request" once a webhook is set. **Operator MUST remove the `telegram-ingestor` line from `vercel.json` after running `setup-telegram-webhook.mjs set ...`** or the cron will spam Conflict errors. Race-safety between the webhook and `telegram-executor` cron is guaranteed by `claimSignalRow()` — an atomic UPDATE that flips `pending` → `executing` and returns the row only to the winner. Loser observes `race-lost` outcome and exits.

41. **External-signal IG sizing is intentionally crude on Phase 3 ship (2026-05-13b).** Executor sizing is `lots_per_1000 / 1000 × IG_balance`, floored at IG's `0.5` contract minimum. On a $500 IG balance with Signal Feed's "0.10 lots per $1000" hint, target = 0.05 lots but floor pushes us to 0.5 contracts. For Spot Gold ($1/contract = $1/pip on 1 oz exposure), 0.5 contracts × 8-pip SL distance = **~$400 risk on a $500 balance (~80% of account on one trade).** This is consistent with the operator's "relax all safeties" call but it means a single losing signal can take 80% of the account. Two mitigations are scheduled:
    - **24h dry-run window** (`TELEGRAM_SIGNALS_EXECUTOR_DRY_RUN=true` on first deploy): logs the would-be order to `agent_logs` without POSTing to IG. Lets operator see size + entry + SL + TP for real signals before any money moves.
    - **Per-epic contract→USD mapping table** (planned follow-up): replace the 0.5 floor with a calibrated minimum derived from each IG epic's pip value, so position size matches the lots-per-1000 hint instead of overriding it.
    Do not relax the 0.5 floor without that mapping — IG rejects sub-minimum sizes and the order fails, which is louder than over-sizing.

39. **EDGE GATE — live-exec is BLOCKED until edge is proven (2026-04-30, MOST IMPORTANT).** `lib/safety.ts` `checkLiveTradingAllowed(instrument)`. Wired into `agents/war-room.ts` BEFORE `getPrimaryExchange` in the live-exec branch. Two layers: (a) per-instrument blacklist `LIVE_INSTRUMENT_BLACKLIST = {ADA/USD, DOT/USD, APT/USD}` (these lost > 8R each in 6mo backtest), (b) 30-day rolling expectancy gate on `demo_trades` — blocks ALL live exec if mean R-multiple < EDGE_THRESHOLD_R (-0.05) over a sample of >= 20 trades. **Fails CLOSED** on insufficient data or DB error. Demo trades NEVER affected — they're how we measure edge.

    **Why it exists**: 6-month walk-forward backtest (`scripts/backtest-gate-stack.mjs` run 2026-04-30) found NEGATIVE per-trade expectancy across all 24 SL/TP combos tested on the 11-instrument set:
    
        BASELINE  (TP4.5, no new gates):  657 trades, 27.2% WR, -0.115 R/trade  (-$5,644 / 180d)
        FILTERED  (TP4.5, new gates):     309 trades, 24.6% WR, -0.201 R/trade  (-$4,650 / 180d)
        NEW       (TP3.0, new gates):     348 trades, 34.5% WR, -0.138 R/trade  (-$3,600 / 180d)
        BEST sweep (SL=1.5, TP=2.0):                  38.8% WR, -0.094 R/trade  (still -ve)

    The deterministic trigger set (EMA cross, MACD cross, RSI extreme, EMA50 breakout, vol spike) does NOT have edge on the current instrument set in the last 6 months. Real-money execution while expectancy is negative is unsafe. Edge gate enforces "no live until 30d demo expectancy >= -0.05 R/trade" — when expectancy turns positive, gate auto-unblocks (no manual override needed).

    Per-instrument NEW results — informative for future research:
    - DOGE: +5.5R (46.9% WR) | LINK: +5.0R (45.0% WR) — only consistently profitable
    - BTC, ETH, AVAX, MATIC, NEAR, XAU: small negative (within noise)
    - ADA, DOT, APT: -8 to -15R each → blacklisted

    **Implication**: any future war-room change that doesn't move 30d demo expectancy is busywork. Use `scripts/backtest-gate-stack.mjs --sweep` to validate trigger changes BEFORE shipping.

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

**Binance pair mapping** (`lib/price-fetcher.ts`, polje `BINANCE_SYMBOLS`) — svih 13 instrumenata (11 aktivnih + 2 blacklist) pokriveno nakon 2026-04-24 seed-a. Prije toga su ADA/DOT/MATIC/NEAR/APT imali 0 candles jer mapping nije postojao, a MATIC je bio zaleđen na 2024-09-10 (delisting).

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
