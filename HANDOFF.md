# APEX Session Handoff

> **READ FIRST. UPDATE LAST.** This is the single source of truth for what the
> most recent Cursor session did and what's still open. Day-shift (Computer A)
> and night-shift (Computer B) both write here so no work is lost or duplicated.

## Protocol (every session, no exceptions)

### On session start (first 30 seconds)
1. `git pull origin main` — always.
2. Read this file end-to-end.
3. Read `CONTEXT.md` for architecture / hard-won lessons.
4. Skim last 10 commits: `git log --oneline -10`.
5. If **OPEN WORK** section below has items assigned to the *other* machine, ask the user before touching them.
6. If the previous session left a `LOCK:` flag active (see bottom), **stop and check in** before editing — they may still be mid-flight.

### On session end (last 30 seconds)
1. Append a new entry to **SESSION LOG** (newest on top).
2. Update **OPEN WORK** — add anything new, tick anything finished.
3. Commit everything, push to `main`.
4. Clear any `LOCK:` you set.

Anything not in this file effectively doesn't exist for the next agent.
Do not trust chat history — only commits and this file.

---

## Machine identification

| Shift | Machine | User account | Notes |
|---|---|---|---|
| Day | Computer A (`AM00112` — OneDrive Apex1) | adnanmoffice-bt | primary dev box |
| Night | Computer B | adnanmoffice-bt | cloned repo, same GitHub account |

Same git identity on both → commits look identical; differentiate via the
`Machine:` trailer you write in SESSION LOG below.

---

## OPEN WORK (edit me)

Items still to finish. Tick `[x]` when done; delete after a week.

- [x] ~~Disable Binance Auto-Subscribe to Simple Earn~~ — operator reports done (30/04 ~12:14 Dubai). **Confirmation pending**: rerun `node scripts/test-binance-key.mjs` after 22:05 Dubai tonight; if Spot USDT ≈ $500, toggle truly took effect. If sweep fires again, revisit Earn settings.
- [x] ~~Move 1,100 USDT Funding → Spot~~ — operator chose to start with 500 USDT manually via Binance UI (API key lacks Universal Transfer permission, so `scripts/move-funding-to-spot.mjs` returns -1002). Verified Spot USDT = $500.0164 at 30/04 12:14 Dubai. Funding USDT remaining: $600.
- [ ] (after tonight's sweep test confirms Auto-Subscribe is off) decide whether to move the remaining $600 of Funding USDT into Spot for larger position sizing, OR leave as buffer.
- [ ] (optional, future) Add `Permits Universal Transfer` to the Binance API key if you want `scripts/move-funding-to-spot.mjs` to work end-to-end. Trade-off: widens API key blast radius (a leaked key could move funds between wallets without your password). Current setup forces transfers to be manual UI-only — safer.
- [ ] Confirm `/api/wallet` reads the expected values on live URL after Vercel picks up `4b1c4ca`.
- [ ] Operator decision: add `TELEGRAM_BOT_TOKEN` to Vercel prod env, OR formally drop Telegram in favor of WhatsApp (Green API).
- [ ] Operator decision (architecture): apply `supabase/schema.sql` to prod DB to create the 5 missing tables (`agent_knowledge`, `performance_snapshots`, `trade_analytics`, `trade_journal`, `polymarket_bets`), OR delete the dead code paths that reference them. Currently silently failing.
- [ ] Watch tomorrow's first 24h after RANGING gate calibration (commit on 2026-04-28). If single-trigger weak-range entries cause >2 SLs in a row on the same instrument, tighten the `STRONG_TRIGGERS` set or raise `regime.strength` threshold from 0.5 → 0.4.

---

## LOCK (set if mid-edit, clear on exit)

<!-- If you are actively editing a risky file across multiple steps, put a line like:
LOCK: agents/war-room.ts — Computer A — started 2026-04-24 09:50 UTC
and clear it before you end the session. -->

LOCK: agents/war-room.ts + lib/risk-controls.ts — Computer A — started 2026-04-30 12:50 Dubai
       (multi-batch upgrade: session gate, correlation dedup, partial-TP/+BE, derivatives, MTF, news/CME/polymarket vetoes)

---

## SESSION LOG (newest on top)

### 2026-04-30 · 12:30 Dubai · Computer A (day)
**Commit:** _(this push)_ — `feat(whatsapp): rich 2h status report cron + cleaner event message format`

Context:
- Operator transferred 500 USDT Funding → Spot manually via Binance UI (API key lacks Universal Transfer permission, so `scripts/move-funding-to-spot.mjs` aborted with `-1002 not authorized`). Verified Spot USDT = $500.0164 via `scripts/test-binance-key.mjs`.
- Operator reports Auto-Subscribe to Simple Earn now disabled in Binance UI. Real test is the 22:00 Dubai sweep tonight — if Spot stays at ~$500, toggle truly stuck. If it drops, retry the toggle.
- Operator asked for WhatsApp messages to be cleaner/denser and the periodic scan summaries to fire every 2h instead of every 15min.

Changes:
- `lib/whatsapp.ts`:
  - New `notifyPeriodicReport(payload)` — comprehensive 2h status format covering portfolio (paper), real-money breakdown (Spot/Funding/Earn), 2h activity counters (meetings, triggers, executes/rejects, blocks, macro pauses, real trade P&L), open positions with live P&L, market snapshot per active instrument (price, 24h Δ, RSI, regime + strength), notable triggers, macro pause state, daily-loss budget consumption, AI spend.
  - Reformatted `notifySignal`, `notifyWarRoomOpen`, `notifyWarRoomDecision`, `notifyWarRoomDebate`, `notifyWarRoomBlocked`, `notifyTradeOpened`, `notifyTradeClosed`, `notifyPositionAlert` with consistent header/body/footer pattern. Added `[REAL]`/`[PAPER]` tag, signed P&L, SL/TP percent distances, hold duration on close, Binance order ID on real opens.
  - `notifyWarRoomScan` is now a no-op stub (kept for ABI compat, will delete in a later commit).
  - Removed random `greet()` from event-driven alerts (kept friendly tone in daily/weekly/morning/kill-switch/demo/profit-alloc reports).
- New `app/api/cron/status-report/route.ts`:
  - Standalone cron, auths via `CRON_SECRET`. Reads portfolio + user_settings + war_room_messages (last 2h) + trades + positions + price_history (last 120 candles per active instrument for indicator computation) + Binance Spot via `getPrimaryExchange().testConnection()` + Funding/Earn via direct signed Binance SAPI. Calls `notifyPeriodicReport` and writes a heartbeat log to `agent_logs (agent='status-report-cron')`.
- `vercel.json`: added `{ "path": "/api/cron/status-report", "schedule": "0 */2 * * *" }` — fires at 00:00, 02:00, ..., 22:00 UTC (~04:00, 06:00, ..., 02:00 Dubai). 12 reports/day, replacing the ~96 daily 15-min scan blasts.
- `agents/war-room.ts`: removed inline `waScan` call (kills the per-tick 15-min spam). Per-meeting `waOpen` / `waDebate` / `waDecision` / `waBlocked` still fire on real events.

Safety notes:
- No code change to `lib/safety.ts`, `lib/risk-controls.ts`, `lib/exchanges/*`, or war-room execution / sizing logic.
- No SHORTS / SOL / BNB / BB_SQUEEZE re-enabled.
- TypeScript build passes (`tsc --noEmit` exit 0). No linter errors on touched files.
- Status-report cron is read-only — no trade writes, no settings mutations.

Open follow-ups (operator to verify):
- Tonight after 22:05 Dubai: run `node scripts/test-binance-key.mjs`. If Spot USDT ≈ $500, Auto-Subscribe is genuinely off → ready to move the rest of Funding ($600 left) into Spot.
- After Vercel deploys this commit: confirm the first 2h report fires and looks readable in the WhatsApp group. Tweak formatting if anything feels too dense.

### 2026-04-29 · 17:00 Dubai · Computer A (day)
**Commit:** _(this push)_ — `chore(ops): document Binance Auto-Subscribe trap + safe Funding→Spot helper`

Context:
- User asked for full audit + 5-day chat review. Then questioned why "real money" execution shows 0 trades despite `trading_mode=live`.
- Direct Binance API trace (`scripts/binance-trade-history.mjs`, `scripts/binance-money-flow.mjs`) revealed: 0 spot fills in 30 days, 0 open orders, Spot USDT = $0.01.
- Root cause: **Binance Auto-Subscribe to Simple Earn** is sweeping all idle Spot USDT into Earn flexible at ~22:00 Dubai every night. The 500 USDT manually transferred Funding→Spot on 23/04 12:22 was reversed at 23/04 22:04 with `type=AUTO, amount=500.00005`. War-room phase 1b gate then quietly failed `quoteBalance >= notional` for every signal afterwards.
- 5-day counterfactual: even with full Spot bankroll, war-room would have executed **0 trades** in this window (only 1 `role=open` meeting in 487 — NEAR/USD on 28/04 19:00 timed out and auto-rejected). So Auto-Subscribe didn't actually cost anything yet, but it makes any future signal silently demo-only.

Changes:
- `scripts/binance-trade-history.mjs` (new) — read-only myTrades dump per symbol over N days.
- `scripts/binance-money-flow.mjs` (new) — read-only forensic trace: transfers, Earn subs/redemptions, converts, deposits, withdrawals, spot fills.
- `scripts/move-funding-to-spot.mjs` (new) — dry-run by default, requires `--confirm`. Has built-in Auto-Subscribe guard: scans last 7d for `type=AUTO` USDT subs and refuses to transfer until user disables the feature in the Binance UI (override `--force`). Optional `--redeem=N` to also pull from Earn flexible.
- `scripts/trace-real-trades.mjs` (new) — Supabase-side trade/position/log reconciliation (companion to the Binance-side scripts).
- `CONTEXT.md` — added Hard Truth #31 (Auto-Subscribe trap) with full reproduction steps.
- `HANDOFF.md` — replaced the now-misleading "transfer 1,100 USDT" item with two new operator items: (1) disable Auto-Subscribe in Binance UI, (2) re-run the transfer via the new script. Marked Anthropic top-up done.

Safety notes:
- All four scripts are read-only by default (`--confirm` required for any state change). No funds were moved in this session.
- No code changes to `agents/`, `lib/safety.ts`, `lib/risk-controls.ts`, or `lib/exchanges/*`. War-room behaviour identical.
- No SHORTS / SOL / BNB / BB_SQUEEZE re-enabled.

### 2026-04-28 · 14:00 Dubai · Computer A (day)
**Commit:** _(this push)_ — fixes from morning chat "rjesi sve"

Context:
- User asked for everything to be fixed after observing wallet drop from $4940.05 → $4718.86 (-$221.19, -4.48%) "overnight". Tracing revealed the 4 SLs actually happened during the day on Apr 27 (between 02:15 and 17:15 Dubai) — 3 TECH_SCORE LONGs on BTC/ETH/XAU all entered near upper Bollinger Band (BB%B 68-100%), 1 stale EMA_CROSS XAU LONG from 24/04. No trades after 17:15 Apr 27 = quiet, not new losses overnight.

Three fixes shipped together:

1. **Candle gap backfill** — ADA/DOT/MATIC/NEAR/APT had 534 candles vs BTC's 803 because of a 67-hour hole between the Apr 24 manual seed and the Apr 27 cron deploy. Bumped `scripts/seed-missing-candles.mjs` to 1000 candles (Binance max), confirmed MATIC→POLUSDT mapping, re-seeded all 8 alts. All 11 active instruments now have 1000 continuous candles. War-room data-quality gate (max 4 missing) now passes everywhere.

2. **RANGING gate calibration** in `agents/war-room.ts` — previously rejected every single-trigger signal in any ranging regime (this is what blocked 100% of BTC/ETH/XAU for 72h+). New behavior: weak ranges (`regime.strength < 0.5`, i.e. emaSpread 0.5-1%, almost trending) allow a single STRONG trigger (EMA 12/26 Cross / MACD Crossover / EMA 50 Breakout). RSI Extreme + Volume Spike alone still gated. Strong ranges (`strength >= 0.5`) keep the 2+ trigger requirement. Downstream gates (trend filter, backtest>=35%, vote margin>2, forecast veto, daily-loss limit) are all untouched.

3. **Trace tooling** — added `scripts/trace-overnight-losses.mjs` for fast post-mortems.

Docs:
- CONTEXT.md: added Hard Truths #29 (candle backfill protocol after candleSymbols changes) and #30 (RANGING gate calibration spec).
- APEX_PROJECT_LOG.md: 4 new changelog rows under 2026-04-28.
- HANDOFF.md: 4 new OPEN WORK items (Anthropic top-up, Telegram decision, schema.sql decision, watch RANGING calibration for SL clusters).

Safety notes:
- No SHORT/SOL/BNB/BB_SQUEEZE re-enabled.
- No safety/risk gate weakened — RANGING gate change is a calibrated relaxation that keeps all downstream gates intact. Build clean (`tsc --noEmit` exit 0). No linter errors.

### 2026-04-24 · 09:49 Dubai · Computer A (day)
**Commit:** `4b1c4ca feat(wallet): aggregate Spot + Funding + Simple Earn on /api/wallet`

Context:
- Wallet on Settings page was showing `$0` this morning because `/api/wallet` only queried Spot and all the free USDT was sitting in Funding (1,100) and Simple Earn (500).
- Ran `scripts/test-binance-all-wallets.mjs` end-to-end — confirmed funds are intact, just in the wrong bucket for real-money execution.

Changes:
- `app/api/wallet/route.ts` — now fetches Spot + Funding + Simple Earn flexible in parallel, aggregates, filters `LD*` dupes, exposes per-wallet breakdown.
- `app/(dashboard)/settings/page.tsx` — 4-card top (Tradable / Total / BTC / ETH), amber warning banner when tradable is much lower than total, per-wallet USDT breakdown strip.
- Pure display fix. War-room / execution code is untouched; it still reads Spot directly via `lib/exchanges/binance.ts`.

Safety notes:
- `usdt_free` in the API response is still **Spot-only** on purpose — any caller that uses it for sizing will behave exactly as before.
- Did NOT enable shorts, SOL, BNB, or BB_SQUEEZE. Did NOT loosen any safety gate.

### 2026-04-23 · 20:55 Dubai · Computer B (night)
**Commit:** `33c4ccf fix(safety): prevent naked positions + exchange-verified close`

- War-room SL placement now retries 3× with emergency market-sell fallback; NAKED flag + WhatsApp alert if both fail.
- Positions cron reconciles real trades with exchange balances before marking closed.

### 2026-04-23 · 20:40 Dubai · Computer B (night)
**Commit:** `4166d98 ui: nav redesign + add CONTEXT.md knowledge file`

- NavBar collapsed to 5 primary tabs + CHARTS/LAB dropdowns.
- Added `CONTEXT.md` and `.cursor/rules/context-load.mdc` (auto-load).

### 2026-04-23 · earlier · Computer A (day)
- Commit `4d5155e fix: disable canWithdraw hard gate per user request`.
- Added debug scripts under `scripts/` (still untracked, not pushed).
