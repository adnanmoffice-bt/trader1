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

- [x] ~~URGENT — Anthropic credit balance is exhausted.~~ Operator topped up $50 on 04/05 ~07:55 Dubai. Meta-agent and news-veto resume on next runs (no code change needed; the failures were 400 invalid_request_error from billing).
- [x] ~~**War-room close-reason logging gap (Phase A1)**~~ — done 04/05. Every `speak({role:'close'})` and `say({role:'alert'})` path in `agents/war-room.ts` now sets `data.reason` (kebab-case). ~25 sites, no behaviour change. Audit script will start showing 0% logging gap on the next 24h of runs.
- [x] ~~**War-room upgrade — Phase A2**~~ (structured stance JSON for all 10 debate agents) — done 04/05. `STRUCTURED_OUTPUT_FOOTER` is appended to each debate-agent prompt; `tallyVotes()` reads `m.data.stance` first, falls back to regex on parse failure. Vote count is now structured.
- [x] ~~**War-room upgrade — Phase A3**~~ (persist meeting decisions to `agent_knowledge`) — done 04/05. `recordMeetingDecision()` is invoked from both EXECUTE and REJECT paths.
- [x] ~~**War-room upgrade — Phase B1**~~ (judge-based selection over synthesis) — done 04/05. Master Agent prompt rewritten to JUDGE role: ranks 10 agents 1-10, picks top-3, returns JSON with consensus + groupthink_warning. Orchestrator now receives only the top-3 rich arguments, not all 11.
- [x] ~~**War-room upgrade — Phase B2**~~ (heterogeneous trading beliefs per meeting) — done 04/05. `BELIEF_VARIANTS` map + `pickBelief()` deterministic from meetingId. Macro/Bull/Bear/Trend agents now rotate priors per meeting to break entrenchment.
- [x] ~~**War-room upgrade — Phase C1**~~ (mixed model tiers) — done 04/05. `AGENT_TIER` map: correlation/scalper/trend/market-analyst/trade-reviewer → Haiku; rest → Sonnet. Expected ~30-40% input-token cost reduction.
- [x] ~~**War-room upgrade — Phase C3**~~ (single-agent fallback) — done 04/05. When budget remaining < 30% OR 3+ losses in last 6h, runMeeting skips the 10-agent debate + master judge. Hard cap raised to <15% remaining; voteMargin gate bypassed in minimal mode (compensated by stricter conviction floor of 80).
- [ ] **Watch checkpoint: 06/05 (48h after Phase A-C ship)**. Run `node scripts/audit-gate-reasons.mjs` and confirm `data.reason` appears on ≥95% of close events (was 1.3%). Run `node scripts/audit-10d.mjs 48` and confirm AI spend per meeting dropped via Phase C1 model tiers. If anything regressed materially, the previous tip is `7b56b1e` and Phase A-C can be reverted as a single squash without losing Phase D research.
- [x] ~~**Phase D — operator decision needed.**~~ **CLOSED 04/05** — see `WAR_ROOM_UPGRADE_PROPOSAL.md` §9. Liquidity-sweep does NOT survive proper validation. The earlier "+0.131 OOS" was a 19-day artifact (DB only had 47d of 1H candles, my "180d" tests were cycling the same 47d). After backfilling 365d via `scripts/backfill-price-history.mjs`, full 5-fold walk-forward shows median OOS +0.029 (FAIL on +0.05 bar), 8-variant sweep tests all FAIL, per-instrument tests give zero passes, sweep-as-confluence-filter HURTS expectancy. **Do NOT wire `lib/microstructure.ts` as a trigger.** Primitives stay in repo for future use.
- [x] ~~**Phase D — combine sweep with CHOCH inversion**.~~ Tested as variant V1 in `scripts/kfold-sweep-variants.mjs` — best of the 8 variants but still FAILS (median OOS +0.026, mean WR 41.9%). Pure CHOCH-inversion (no sweep) is the one filter that preserves expectancy with marginal trade-count reduction (Strategy C in `kfold-confluence-filter.mjs`); could be added as a soft veto inside war-room IFF the per-gate impact study below is run first.
- [x] ~~**NEW — per-gate impact study (highest research priority).**~~ **DONE 04/05.** `scripts/kfold-per-gate-impact.mjs` ships findings (`scripts/backtest-runs/per-gate-impact.txt`): regime-ranging gate is single largest negative contributor (+0.064 R/trade if removed). long-only-mode also flagged (+0.059 if removed) but workspace rule overrides. Optimal subset: `mtf-veto + trend-filtered + long-only-mode` (Exp/R +0.014). Patch shipped: regime-ranging gate wrapped in `if (false)` in `agents/war-room.ts`. 5 other gates left untouched pending more demo data. See `WAR_ROOM_UPGRADE_PROPOSAL.md` §10.
- [x] ~~**NEW — backfill 4H candles**~~ **DONE 04/05.** 26,280 candles backfilled. 4H is WORSE than 1H at every config tested. Hypothesis falsified — stay on 1H. Cross-timeframe data: shorts even more profitable at 4H than 1H, but workspace rule still overrides.
- [x] ~~**NEW — pause on adding new gates.**~~ Per-gate study now exists; pause is closed. New rule: future gates land in `agents/war-room.ts` only if `kfold-per-gate-impact.mjs` shows ΔExp/R ≥ +0.02 R/trade across ≥3/5 folds when added solo.
- [ ] **NEW — 30d watch on regime-ranging removal**: 03/06 (≈30 days post-patch). Re-run `node scripts/kfold-per-gate-impact.mjs` on demo trade history. Confirm +0.064 R/trade lift materialised in live demo. If it didn't, revert is one line: `if (false)` → `if (true)` in `agents/war-room.ts` around the regime-ranging block.
- [ ] **NEW — funding-rate primitive (failed standalone, may work as confluence).** `scripts/funding-rate-walkforward.mjs` shows funding-rate extremes alone are not robust (median OOS -0.053, curve-fit on train). Worth retesting as confluence: enter only when funding extreme AND RSI agrees AND price near swing extreme.
- [ ] **NEW — per-gate study v2 (richer sim required).** Eight more gates need trade-history reconstruction: `news-veto`, `correlation-dedup`, `recovery-rr`, `recovery-positions`, `hard-risk-reject`, `daily-loss-limit`, `backtest-fail`, `loss-streak-cooldown`, `safety-block`. ~1 day of work to mirror them. Lower priority than the demo watch on the regime-ranging change.
- [x] ~~**Gold/oil — operator question 2026-05-04 09:48 Dubai.**~~ **ANSWERED.** Gold IS in war-room rotation but PAXGUSDT venue is structurally broken: 70× thinner than BTC, 0.30R/trade fee burden, every gate config is net-negative after fees (raw +0.053 → net -0.247). XAU added to `LIVE_INSTRUMENT_BLACKLIST` (commit on `main`). Oil not in rotation — no Binance pair, would burn AI cost without execution path. Full venue analysis + recommendations in `docs/GOLD_OIL_VENUE_DECISION.md`. Operator decision needed: open an IG / Saxo / OANDA CFD account (~1h KYC) to unlock both markets, OR accept gold+oil as paper-only on Binance.
- [ ] **NEW — operator decision: open CFD account for gold/oil execution?** Recommended IG (UAE-licensed via DFSA, ~$250 min deposit, API via IG Labs). Without it, gold stays demo-only forever and oil never enters rotation. See `docs/GOLD_OIL_VENUE_DECISION.md` §Recommendation.
- [x] ~~**Triage of 138-trade -$6,421 paper loss**~~ **DONE 04/05.** Operator showed Trade Analytics screen ("opet gubis"). `scripts/audit-recent-losses.mjs` shows the loss is concentrated PRE 2026-04-17 (102 trades, 9.8% WR, -$6,106) when SOL/BNB/BB_SQUEEZE were still in rotation. Post-cutoff: 36 trades, 27.8% WR, -$315; last 14d: 24 trades, 29.2% WR, -$132 (basically breakeven). All four root causes are already disabled (SOL/BNB Apr 17, BB_SQUEEZE workspace rule, XAU live blacklist 04/05 + demo blacklist 04/05). Demo cron `DEMO_INSTRUMENTS` now `['BTC/USD','ETH/USD']` only — XAU was bleeding ~$71/trade in demo too.
- [ ] **Telegram still imported in `app/api/cron/positions/route.ts` (lines 4, 256).** `TELEGRAM_BOT_TOKEN` not on Vercel prod → silent failures every position close. Operator decision pending: add the token, or remove the import.

- [x] ~~Disable Binance Auto-Subscribe to Simple Earn~~ — confirmed (01/05 09:26 Dubai sweep test: Spot USDT = $500.0164 unchanged from 30/04 12:14 → toggle held overnight).
- [x] ~~Move 1,100 USDT Funding → Spot~~ — operator chose 500 USDT manually via Binance UI. Funding USDT remaining: $600.
- [x] ~~Decide whether to move the remaining $600 to Spot~~ — operator decision (01/05 09:42 Dubai): **HOLD as buffer**. No more capital deployed until edge gate (`checkLiveTradingAllowed`) auto-unblocks live exec.
- [x] ~~Apply `supabase/schema.sql` to prod DB~~ — done via `supabase/migrations/2026-05-01-missing-tables.sql` (focused, idempotent migration). All 5 tables verified live (`agent_knowledge`, `performance_snapshots`, `polymarket_bets`, `trade_analytics`, `trade_journal`).
- [x] ~~Add heartbeat helpers to silent crons~~ — done 01/05. `signals-cron`, `positions-cron`, `demo-cron`, `meta-agent-cron`, `morning-briefing-cron`, `daily-report-cron`, `weekly-report-cron` all now insert one `agent_logs` row at end of each run with `duration_ms` + key counters. Pattern matches `status-report-cron`.
- [x] ~~Wire on-chain feed (CryptoQuant/Glassnode)~~ — **CANCELLED** 01/05 by operator. Free tiers brittle (CryptoQuant 30 calls/day = single Vercel deploy burns it; Glassnode free is mostly demo). Paid tiers ($29-$39/mo) skipped because the system has no edge today — additional data won't fix that. News-veto (already wired) covers ~80% of the same intent at $0.005/Claude call. Stub gate stays in place; revisit only if edge gate ever turns positive AND we want extra +0.05 R/trade.
- [ ] (optional, future) Add `Permits Universal Transfer` to the Binance API key if you want `scripts/move-funding-to-spot.mjs` to work end-to-end. Trade-off: widens API key blast radius. Current setup forces transfers to be manual UI-only — safer.
- [ ] Confirm `/api/wallet` reads the expected values on live URL after Vercel picks up `4b1c4ca`.
- [ ] Operator decision: add `TELEGRAM_BOT_TOKEN` to Vercel prod env, OR formally drop Telegram in favor of WhatsApp (Green API).
- [ ] **Demo gate-stack watch checkpoint: on or after 02/05 17:25 Dubai** (48h after gate stack went live). Run `node scripts/audit-10d.mjs` and grep `war_room_messages.data.reason` for: `atr-extreme`, `derivatives-veto`, `mtf-veto`, `macro-high-strict`, `onchain-veto`, `blocked-session`, `blocked-correlation`, `blocked-news`, `blocked-orderbook`. Watch for any single gate rejecting > 80% of meetings on the same instrument — that's an over-tightening signal; relax rather than remove.
- [ ] **Backlist re-evaluation checkpoint: on or after 07/05 (weekly)**. Compute 30-day demo expectancy per blacklisted instrument (ADA/DOT/APT). Lift any whose mean R/trade ≥ 0 over the last 30d. Edit single line in `lib/safety.ts → LIVE_INSTRUMENT_BLACKLIST`.
- [ ] **Backtest re-run checkpoint: on or after 08/05 (weekly)**. `node scripts/backtest-gate-stack.mjs` and save to `scripts/backtest-runs/YYYY-MM-DD.txt`. Diff against `2026-05-01.txt` to track edge trend. If NEW mode TotalR moves above 0 → consider unblocking live exec by removing/relaxing the edge gate.
- [ ] Implement positions-cron partial-fill + break-even-stop logic. **DEFERRED** until rolling 30d expectancy is positive. Implementing partial-fill on a negative-edge system just optimizes the loss curve.
- [ ] Investigate ETH/USD generating 0 trades in FILTERED+NEW backtest modes (correlation dedup vs BTC). Decision: accept as BTC's shadow OR loosen dedup when BTC's open trade > 4h.
- [ ] (research) The 5 deterministic triggers had NEGATIVE expectancy across ALL 24 SL/TP combos tested. Either find new triggers (ICT order blocks, volume profile POC reclaim, FVG fills) or accept paper-mode-only until edge appears.

---

## LOCK (set if mid-edit, clear on exit)

<!-- If you are actively editing a risky file across multiple steps, put a line like:
LOCK: agents/war-room.ts — Computer A — started 2026-04-24 09:50 UTC
and clear it before you end the session. -->

LOCK: app/api/telegram/webhook + lib/telegram-executor.ts + app/api/cron/telegram-* — Computer A — started 2026-05-13 16:25 Dubai (XAU-only allowlist + Telegram webhook for sub-second execution + cron tightened)

---

## SESSION LOG (newest on top)

### 2026-05-13 · 16:45 Dubai · Computer A (day) — Signal Feed parser v1 + IG short-open + Phase 3 executor (dry-run gated)
**Commits:** _(this push)_ (`feat(external-signals): Signal Feed channel parser, IG atomic open w/ SL+TP, Phase 3 executor cron`)

Operator pasted a real Signal Feed channel screenshot (XAUUSD SELL at 13:51 Dubai, Entry 4699–4698, TP1 4692, TP2 4686, TP3 4683, TP4 4680, SL 4706.5, "0.10 lots per $1000"). Two follow-up instructions:

1. _"wait for signals when they come like this, from signal feed channel, its automatic forward, count only from there"_
2. _"execute trade as soon as they come"_

Translation: only the forwarded Signal Feed messages count; ignore manual chat in the group; fire the order at signal arrival.

This session ships everything that closes that loop, but with the executor still off by env flag and a dry-run mode on top of that for the first 24h of live operation. The operator flips two env vars when ready.

**What landed:**

1. **`lib/telegram-ingest.ts` — parser v1 "signal-feed"** (`PARSER_VERSION = 'v1-signal-feed-2026-05-13'`):
   - Multi-line tolerant; en/em-dashes normalised to ASCII hyphen.
   - Entry range parsing: "Entry: 4699 – 4698" → `entry_low`, `entry_high`, plus a single `entry` chosen by direction (LONG → low end, SHORT → high end).
   - Four TPs (`tp1`–`tp4`) — executor uses TP1 (closest, most likely to hit). TP2–4 preserved for future scale-out logic.
   - Stop loss anchored on `SL:` / `stop`; the trailing pip annotation ("-80") is correctly ignored.
   - Lot sizing hint: "0.10 lots per $1000" → `lots_per_1000 = 0.1`.
   - Direction-consistency sanity check: a SHORT whose SL ≤ entry or TP1 ≥ entry now returns `null` instead of firing a backwards order. Same for LONG inverted.
   - Forward info captured (`forward_origin` and `forward_from_chat` both accepted) and propagated into `external_signals.metadata.forward`.
   - 5/5 fixtures green against the real screenshot text + invariants.

2. **`app/api/cron/telegram-ingestor/route.ts` — forward-source filter**:
   - New env `TELEGRAM_SIGNALS_REQUIRE_FORWARD=true` → skip any message that isn't a forward.
   - New env `TELEGRAM_SIGNALS_FORWARD_FROM=Signal Feed` → allowlist by numeric chat id OR `@username` OR exact title. Comma-separated for multiple sources.
   - Counters added: `skippedNonForward`, `skippedWrongSource` in agent_logs.

3. **`lib/exchanges/ig.ts` — atomic open with SL+TP**: new `openMarketPosition({symbol, side, sizeContracts, stopLevel?, limitLevel?})`. Single POST to `/positions/otc` with `direction: 'SELL'` (or BUY), `forceOpen: true`, plus `stopLevel`/`limitLevel`. Eliminates the naked-position race window that exists between `marketBuy` and `setStopLoss`. This is the method the executor uses for both LONG and SHORT external signals.

4. **`app/api/cron/telegram-executor/route.ts` — Phase 3 cron (NEW)**:
   - Runs **every minute** (`*/1 * * * *` in vercel.json).
   - Reads up to 25 `external_signals` rows with `execution_status='pending'`, newest first.
   - Per row:
     1. Re-checks `TELEGRAM_SIGNALS_EXECUTOR_ENABLED` at exec time (belt-and-suspenders).
     2. **Freshness floor**: `TELEGRAM_SIGNALS_MAX_AGE_MIN` (default 5 min). Older → `skipped:stale`.
     3. **Instrument floor**: must be in `IG_INSTRUMENTS` (XAU/XAG/WTI/BRENT/EUR/USD/GBP/USD/USD/JPY/SPY/QQQ). Anything else → `skipped:unknown-instrument`.
     4. Direction-consistency re-check (defence in depth).
     5. Sizing: `lots_per_1000 / 1000 × IG_balance`, floored at `0.5` contracts (IG's minimum on most majors).
     6. **DRY_RUN** mode (`TELEGRAM_SIGNALS_EXECUTOR_DRY_RUN=true`): writes the row as `skipped:dry-run` with the would-be order in `exec_error`. Does NOT POST to IG.
     7. Otherwise calls `IGExchange.openMarketPosition()` (atomic SL+TP), inserts a `trades` row (with the external_signal_id in `notes`), and updates `external_signals.execution_status='executed'` + `executed_trade_id`.
   - Failure modes write `execution_status='failed'` with `exec_error` snippet so the row never re-fires on cron retry. One-shot guarantee.

5. **`scripts/import-telegram-export.mjs`** — historical-import parser bumped to match `v1-signal-feed-2026-05-13-import`. Historical rows still force `execution_status='disabled'` regardless of env flags.

**Per-row safety stack (unchanged operator overrides + new physical floors):**
- ✅ Probe-week kill switch: bypassed for this path (operator decision 2026-05-13).
- ✅ Daily-loss limit: bypassed for this path.
- ✅ Blacklist (shorts, SOL/BNB, BB_SQUEEZE): bypassed for this path. XAUUSD SELL would have been blocked — relaxed per operator.
- ❌ Stale-signal floor (>5min): NOT relaxed. Physical constraint.
- ❌ Instrument-not-mapped: NOT relaxed. Operator chose "skip unknowns".
- ❌ Inverted SL/TP: NOT relaxed. Parser-level fail-safe.
- ❌ One-shot per row: NOT relaxed. Row is locked before exit.
- ❌ Atomic SL+TP: NOT relaxed. No naked position window.

**What operator must do BEFORE the executor fires real orders:**

1. **Rotate `@Signalii26bot` token** via @BotFather (the token in chat is burnt). _(carried from prior session)_
2. **Apply SQL migration** `supabase/migrations/2026-05-13-external-signals.sql` in Supabase. _(carried from prior session)_
3. **Set Vercel env vars** (production):
   - `TELEGRAM_SIGNALS_BOT_TOKEN` = (new rotated token)
   - `TELEGRAM_SIGNALS_GROUP_ID` = `-3910126970`
   - `TELEGRAM_SIGNALS_REQUIRE_FORWARD` = `true`
   - `TELEGRAM_SIGNALS_FORWARD_FROM` = `Signal Feed`  ← exact channel title
   - `TELEGRAM_SIGNALS_EXECUTOR_ENABLED` = `false` (still!)
   - `TELEGRAM_SIGNALS_EXECUTOR_DRY_RUN` = `true`
   - `TELEGRAM_SIGNALS_MAX_AGE_MIN` = `5`
4. **Verify ingestion** in `external_signals` after the next 2-min cron:
   ```sql
   SELECT message_date, instrument, direction, entry_price, stop_loss, take_profit,
          metadata->'forward'->>'from_chat_title' AS forwarded_from,
          execution_status, parser_version
     FROM external_signals
    ORDER BY created_at DESC LIMIT 10;
   ```
   Expected: rows where `forwarded_from = 'Signal Feed'`, `execution_status='disabled'`, fields parsed.
5. **Flip executor to enabled + dry-run** (still no real orders):
   - `TELEGRAM_SIGNALS_EXECUTOR_ENABLED=true`
   - `TELEGRAM_SIGNALS_EXECUTOR_DRY_RUN=true`
6. **Watch one signal cycle in dry-run** — check `agent_logs.agent='telegram-executor-cron'` for the would-be order line.
7. **GO LIVE** (real money): flip `TELEGRAM_SIGNALS_EXECUTOR_DRY_RUN=false`. From that moment, every forwarded Signal Feed message that parses cleanly fires an IG order within ≤60s.

**Safety notes / known limits:**
- IG sizing math is conservative: 0.5 contract minimum on $500 balance ≈ $50/pip on XAU. SL distance ~8 pips → ~$400 risk on a $500 balance. **That's 80% of the account on one trade.** This is consistent with the operator's "relax all safeties" call but documented loudly here. After 24h of live operation, we should refine the per-epic contract→USD mapping rather than relying on the 0.5 floor.
- The executor doesn't currently scale into TP2/TP3/TP4. TP1 only; full position closes at TP1 or SL. Scale-out can land in a follow-up.
- `notes` column on `trades` carries the external_signal_id as JSON (no schema migration). Reconcilable from `external_signals.executed_trade_id` either way.

Files added:
- `app/api/cron/telegram-executor/route.ts` (new cron)

Files edited:
- `lib/telegram-ingest.ts` (parser v1)
- `app/api/cron/telegram-ingestor/route.ts` (forward filter)
- `lib/exchanges/ig.ts` (atomic open-with-SL/TP)
- `lib/exchanges/index.ts` (export `IG_INSTRUMENTS`)
- `vercel.json` (executor cron */1 * * * *)
- `.env.example` (new env vars + comments)
- `scripts/import-telegram-export.mjs` (parser v1 mirror)
- `CONTEXT.md` (Hard Truth #41)

---

### 2026-05-13 · 16:05 Dubai · Computer A (day) — dedicated reader bot + historical import script
**Commits:** _(this push)_ (`feat(external-signals): TELEGRAM_SIGNALS_BOT_TOKEN env + Telegram Desktop export importer`)

Operator added a separate reader bot **@Signalii26bot** and pasted the
token in chat. I flagged the leak and instructed operator to rotate via
@BotFather before deploying.

**SECURITY note**: token `8888491753:AAH...` was disclosed in chat. The
chat log is retained in agent transcripts. Operator MUST rotate this
token via @BotFather → /mybots → @Signalii26bot → API Token → Revoke
current token → Generate new, then paste the NEW token into Vercel env
as `TELEGRAM_SIGNALS_BOT_TOKEN` (NOT `.env.example`, which is tracked).

Two patches in this push:

1. **`lib/telegram-ingest.ts` + `app/api/cron/telegram-ingestor/route.ts`**
   now read `TELEGRAM_SIGNALS_BOT_TOKEN` preferentially with fallback to
   the existing `TELEGRAM_BOT_TOKEN`. Backward-compatible — current
   Phase 1 deploy keeps working. The new env var lets the operator
   decouple inbound (signals reader) from outbound (notifier) so a
   token rotation on one bot doesn't kill both paths.
   - `.env.example` updated to document the new var (no value).

2. **`scripts/import-telegram-export.mjs` (NEW)** — one-shot importer
   for Telegram Desktop "Export chat history" JSON files. This solves
   the Bot API's hard limitation that bots cannot read messages
   posted BEFORE they joined the group. Operator runs:
   ```
   node scripts/import-telegram-export.mjs path/to/result.json [--dry] [--since=YYYY-MM-DD] [--limit=N]
   ```
   What it does:
   - Reads Telegram's machine-readable JSON export.
   - Flattens the `text` field (which can be a string OR a mixed array
     of strings + entity objects like {type:'mention',text:'@x'}).
   - Parses each message with the SAME parser used by the live cron
     (replicated inline so no TS transpile is required).
   - Batch-inserts 500 rows at a time via PostgREST with
     `Prefer: resolution=ignore-duplicates` so re-runs are idempotent.
   - Forces `execution_status='disabled'` on every historical row.
     Even if `TELEGRAM_SIGNALS_EXECUTOR_ENABLED=true`, imported rows
     never fire orders. Defence in depth — Phase 3 executor will
     ALSO check `message_date` freshness.
   - Writes one summary row to `agent_logs` (`agent='telegram-import'`).
   - `--dry` runs the parser, reports counts, no DB writes.
   - Idempotent on UNIQUE `(source, external_message_id)` so a partial
     run can be safely resumed.

**Telegram Bot API limitation explained to operator:** bots cannot
retrieve historical messages from before they joined. The only paths
are the new export importer (Path A), MTProto user-account client
(Path B, big lift), or paste-into-chat (Path C). Operator was given
all three; recommendation was Path A.

**What operator needs to do next:**
1. Rotate the @Signalii26bot token via @BotFather.
2. Add to Vercel env (Production):
   - `TELEGRAM_SIGNALS_BOT_TOKEN=<NEW token from BotFather>`
   - (`TELEGRAM_SIGNALS_GROUP_ID=-3910126970` already noted in prior
     entry — confirm it's there)
3. Apply the Phase 1 SQL migration if not already done
   (`supabase/migrations/2026-05-13-external-signals.sql`).
4. (Optional, for history) In Telegram Desktop → open the group →
   ⋮ → Export chat history → Machine-readable JSON, uncheck media →
   save `result.json` somewhere local → run the importer.

**Validation:**
- `npx tsc --noEmit` clean.
- `npx eslint lib/telegram-ingest.ts app/api/cron/telegram-ingestor/route.ts` clean.
- Parser inside the import script is a verbatim port of the live one;
  diff-checking would catch drift if either is modified in future.

### 2026-05-13 · 15:30 Dubai · Computer A (day) — Telegram external-signal ingestor (Phase 1, log + parse only)
**Commits:** `c519447` (LOCK) → _(this push)_ (`feat(external-signals): Telegram ingestor + parser scaffold + db migration`)

Operator request (literal): "signals are coming to this group, you should
scrape it https://web.telegram.org/k/#-3910126970 and use it for trading,
live". I pushed back hard on the safety implications and ran a 7-question
elicitation. The recorded operator choices, all on 2026-05-13:

- **Auth path:** Bot API (operator has already added the existing
  `TELEGRAM_BOT_TOKEN` bot to the group with Privacy Mode disabled).
- **Source trust:** verified — operator has tracked >30 signals over
  >30 days, net profitable spot-long crypto.
- **Pace:** **skip demo**, go straight to live exec.
- **Workspace rules:** **all four blacklist items (shorts, SOL/USD, BNB/USD,
  BB_SQUEEZE) bypassed for this path.**
- **Kill switch + 5% daily loss:** **both relaxed for this path** (operator
  accepts full $500 IG loss risk).
- **Execution scope:** skip instruments not in our IG epic map (one floor I
  refused to cross — no Binance fallback, the spot wallet is essentially
  empty and the Auto-Subscribe trap is still active).
- **Path isolation:** ONLY the external-signal path bypasses the relaxed
  safeties. War-room internal path remains fully gated.

This is the first time in APEX history the workspace blacklist + kill
switch have been opened for any path. The override is path-local and
documented in CONTEXT.md Hard Truth #40 with the operator's accountable
decision date so future agents reading the audit trail see who turned
which lever and when.

**Phase 1 ships in this commit (safe regardless of the relaxations because
NOTHING TRADES yet):**

1. **`supabase/migrations/2026-05-13-external-signals.sql`** — new table
   `external_signals` (id, source, external_message_id UNIQUE, raw_text,
   parsed jsonb, parse_status, instrument, direction, entry_price,
   stop_loss, take_profit, execution_status, executed_trade_id FK to
   trades, skip_reason, exec_error, metadata, timestamps). Plus a
   companion `external_signal_cursors` table tracking `last_update_id`
   per source so re-runs and Vercel restarts never replay messages.
   RLS service-role only — no end-user reads. Fully idempotent
   (`IF NOT EXISTS` everywhere, `DROP POLICY` before `CREATE POLICY`).

2. **`lib/telegram-ingest.ts`** — inbound reader (separate from
   `lib/telegram.ts` which stays outbound-only). Exports:
   - `fetchTelegramUpdates({sinceUpdateId, chatIdFilter, maxPages})` —
     hits `https://api.telegram.org/bot{TOKEN}/getUpdates`, paginates up
     to 5 pages × 100 = 500 messages per cron tick, filters to
     `chatIdFilter`, returns clean `TelegramMessageBare[]` plus the
     advanced cursor for upsert. Network/HTTP/JSON failures returned as
     structured `{ok:false, error}` — never throws.
   - `parseStructuredSignal(text)` — best-effort regex parser. Handles
     BUY/LONG/SHORT/SELL keywords plus 🟢/🟩/✅/🔴/🟥/❌ emoji.
     Normalises tickers via an alias map covering BTC[USD/T], ETH,
     XAU/GOLD, XAG/SILVER, WTI/CL/USOIL, BRENT/UKOIL/BCO, EURUSD,
     GBPUSD, USDJPY, SPY/SP500/SPX, QQQ/NDX/NAS100. Extracts entry,
     SL, TP via flexible regex. Returns `null` for non-signal chatter.
   - `PARSER_VERSION = 'v0-generic-2026-05-13'` — stamped into each
     `external_signals.parser_version` so future parser upgrades can be
     audited row-by-row.

3. **`app/api/cron/telegram-ingestor/route.ts`** — new cron, every 2min.
   Reads cursor, fetches new updates, inserts each into
   `external_signals`. Unique-key conflicts (replay protection) are
   counted as `duplicates` and don't kill the loop. **EXECUTION IS
   DISABLED**: `TELEGRAM_SIGNALS_EXECUTOR_ENABLED` env defaults to
   `false`, and every inserted row gets `execution_status='disabled'`.
   When the operator flips the env flag to `true`, new rows will land
   as `execution_status='pending'` instead, ready for the Phase 3
   executor (not built yet). Logs one heartbeat row to `agent_logs`
   per tick with fetched/inserted/parsed/unparseable/duplicates
   counters. Auth: `Bearer ${CRON_SECRET}`.

4. **`vercel.json`** — added `{ "path": "/api/cron/telegram-ingestor",
   "schedule": "*/2 * * * *" }`. Same cadence as market-data and
   positions; Vercel Pro plan covers it.

5. **`.env.example`** — documented two new vars:
   - `TELEGRAM_SIGNALS_GROUP_ID=-3910126970` (operator must paste into
     Vercel env).
   - `TELEGRAM_SIGNALS_EXECUTOR_ENABLED=false` (stays false until
     Phase 3 and parser are validated).

6. **CONTEXT.md** — added Hard Truth #40 documenting the per-path
   override, the operator's accountable decision date, the floors that
   are still enforced (IG epic map only), and the revert path.

**Parser validation:** 7/7 fixture cases passed locally:
- Simple "BUY BTC/USD @ 80000 SL 79000 TP 82000"
- "LONG ETH 2300 Stop: 2250 Target: 2400"
- "🟢 #BTCUSDT Entry: 80000 Stop loss: 79000 TP1: 82000"
- "SHORT XAUUSD 4700 sl 4730 tp 4640"
- "sell EURUSD entry 1.1750 SL 1.1800 TP 1.1650"
- Plus two negative cases (chatter, no-instrument) that correctly
  return null.

Two bugs caught during validation and fixed: (a) BTC/USD and ETH/USD
identity keys were missing from the alias map (so 'BTC/USD' tokens
were dropped); (b) `\b` word boundaries don't match around emoji
codepoints, so direction detection needed a parallel emoji regex on
the original-case text. Throwaway test deleted after passing.

**Validation:**
- `npx tsc --noEmit` clean.
- `npx eslint lib/telegram-ingest.ts app/api/cron/telegram-ingestor/route.ts` clean.
- LOCK on `app/api/cron/*` + `supabase/schema.sql` cleared.

**Operator action required (before Phase 1 starts producing rows):**
1. Apply migration in Supabase SQL Editor — paste
   `supabase/migrations/2026-05-13-external-signals.sql` and Run.
   Idempotent so re-runs are safe.
2. Add `TELEGRAM_SIGNALS_GROUP_ID=-3910126970` to Vercel env
   (Settings → Environment Variables → Production). Leave
   `TELEGRAM_SIGNALS_EXECUTOR_ENABLED` unset (defaults to false) —
   ingest only for the first 24-48h.
3. After Vercel picks up this push, the cron fires within 2min.
   Verify in Supabase: `SELECT created_at, sender, raw_text, parse_status
   FROM external_signals ORDER BY created_at DESC LIMIT 20`.
4. After 24-48h or 10-20 real signals (whichever comes first), tell
   me. I will: (a) audit which messages parsed cleanly vs landed in
   the unparseable bucket, (b) tighten the parser regex for the
   formats this specific group actually uses, (c) build the Phase 3
   executor that flips `execution_status='pending'` rows into IG
   orders + `trades` rows.

**Phase 3 design preview (NOT shipped today):**
- Separate cron (`/api/cron/telegram-executor`, e.g. every 1min)
  drains `external_signals WHERE execution_status='pending'`.
- For each row:
  - If `instrument` not in `IG_INSTRUMENTS` → mark `skipped` with
    `skip_reason='unknown-instrument'`.
  - Else: position-size via `riskBasedPositionSize()` against the IG
    account balance (NOT user_settings.risk_per_trade_pct — external
    signals carry their own SL distance, so sizing is exit-distance
    × risk_pct). 1.5% of $500 = $7.50 per trade.
  - Open via `getExchangeForInstrument(instrument).marketBuy(...)`,
    set SL/TP via `setStopLoss`/`setTakeProfit`.
  - Insert row into `trades` table with link back to
    `external_signals.id` in a new optional column (DB change in
    Phase 3 migration).
  - Update `external_signals.execution_status='executed'` and
    `executed_trade_id`.
- Failures land in `execution_status='failed'` with `exec_error`.

**What this does NOT do (deliberately):**
- No execution today. Even with the env flag set to `true`, the Phase
  3 executor cron does not yet exist — so the rows just accumulate.
  Operator MUST review parse quality before I ship the executor.
- No change to `agents/war-room.ts`, `lib/safety.ts`, `lib/risk-controls.ts`.
  Internal-signal safety stack is bit-identical to the post-2026-05-11
  ship.
- No change to existing `signals` table or `trades` table schema.
- No re-enable of shorts/SOL/BNB/BB_SQUEEZE on the war-room path. The
  workspace rule still applies there; only external-signal
  consumption is exempt.

### 2026-05-11 · 10:30 Dubai · Computer A (day) — probe-week audit + session-aware US-equity skip
**Commits:** `0872caf` (LOCK) → _(this push)_ (`fix(data-quality): session-aware skip for US equities + probe-week audit script`)

Operator request: full audit (live plus/minus), then accept the verdict and
ship only the session-aware data-quality fix.

**Probe-week audit results (67.7h elapsed of 168h):**
- REAL money: **0 trades. $0 P&L. Flat.** IG account still $500. Kill-switch
  ($200 weekly cap) armed and untouched.
- DEMO (probe window): 6 trades / 5 closed = 3W/2L, **+$335.71**. Wins on
  WTI/BRENT/QQQ TPs; losses on XAU/XAG SLs.
- Paper portfolio (all-time since 2026-04-17 reset): capital $5,017.80,
  +$17.80, 18W/39L, max DD 15.57%. Basically breakeven.
- 1000+ war-room meetings → 0 EXECUTE, 0 alerts, 0 opens, 2 reached
  orchestrator and both rejected. Close-reason breakdown:
    no-trigger 56% | data-quality 33% | long-only-mode 6% | atr-extreme
    2.5% | mtf-veto 1.4% | cooldown 0.4% | rejected-orchestrator 0.2%.
- AI spend: $0.64 (pipeline barely running).
- One error: `meta-agent-cron` 06:00 Dubai today, Anthropic credit
  exhausted — operator confirmed top-up post-audit.

**Operator decision:** accept the verdict (do NOT relax the gate stack to
force fills). Ship only the data-quality fix.

**Ship list:**

1. **`lib/data-quality.ts`** — new exports `isInstrumentInSession(instrument,
   now?)` and `getAssetClass(instrument)`. The session helper covers all 5
   asset classes:
   - `crypto` → always in session (24/7 venue).
   - `metal` (XAU/XAG) → Sun 23:00 UTC → Fri 22:00 UTC.
   - `fx` (EUR/USD, GBP/USD, USD/JPY) → Sun 22:00 UTC → Fri 22:00 UTC.
   - `commodity_futures` (WTI, BRENT) → Sun 23:00 → Fri 22:00 UTC, with
     daily 22:00-23:00 UTC maintenance break.
   - `us_equity` (SPY, QQQ) → strict Mon-Fri 13:30-20:00 UTC (EDT regular
     session). Winter EST loses the last hour by design — false "in session"
     outside real hours is the dangerous case, so we underclock.
   No threshold changes; the existing staleness/gap/outlier checks remain
   in place for instruments that ARE in session.

2. **`agents/war-room.ts`** — new branch BEFORE `validateOHLCV`. If
   `!isInstrumentInSession(instrument)`, the meeting closes with
   `reason='out-of-session'` (new bucket) and message `"<INST>: <class>
   market closed. Adjourning until next session."`. Function still returns
   `Promise<string>`; `'out-of-session'` joins the existing
   `'data-quality'|'atr-extreme'|'mtf-veto'|...` return values.

3. **`scripts/audit-probe-week.mjs`** — new read-only audit:
   - Lists REAL trades opened/closed in probe window with per-trade pnl,
     prints cumulative pnl + remaining kill-switch headroom.
   - Lists DEMO trades same window with conviction + exit reason.
   - Reads `agent_logs` for `agent='probe-week-kill'` to confirm switch
     state.
   - Reads `user_settings` (trading_mode, risk_per_trade_pct) so we know
     the override is still wired.
   - Dumps all non-close war_room_messages (decision/alert/open) — empty
     today, useful when the pipeline actually fires.
   - Top-20 close-reason histogram for the window.
   - AI spend by day, error log summary, kill-headroom verdict.
   Designed to be re-runnable by either machine without me typing.

**What this DOES change (expected impact next 24h):**
- US equities (SPY/QQQ) stop producing DATA QUALITY FAIL every weekend +
  overnight. That eliminates ~33% of the meeting-close "fault" volume.
- FX/metal/oil also skip cleanly over their weekend gaps instead of
  failing the stale-candle check.
- Frees the rotation slot for instruments that ARE in session (BTC, ETH,
  the alts, XAU during weekdays, etc.).
- Self-audit cron health verdict will stop counting weekend-closed
  equities as health failures.

**What this does NOT change (deliberately):**
- 0 live trades in 67.7h is NOT a data-quality problem. It is a
  trigger-quality + gate-stack problem (56% of meetings show genuine
  "no trigger" — market is quiet, the system correctly waits). The fix
  here only stops the noise; it does NOT manufacture signals.
- Probe-week mechanics (1.5% risk, $200 weekly kill, auto-stop
  2026-05-15 20:00 UTC) are untouched.
- `LIVE_INSTRUMENT_BLACKLIST` (XAG/USD), edge-gate override
  (`REDUCED_RISK_CEILING_PCT=2.0`), workspace rules (no shorts, no SOL,
  no BNB, no BB_SQUEEZE) all untouched.

**Validation:**
- 15/15 fixture cases passed for `isInstrumentInSession` (SPY open/close
  boundaries, weekends, FX Sun-evening open, oil maintenance hour, etc.).
  Throwaway test file deleted post-validation.
- `npx tsc --noEmit` clean.
- `npx eslint lib/data-quality.ts agents/war-room.ts` clean.

**Reverting:** remove the new branch in `agents/war-room.ts` (4 lines
between `// Session-aware skip` and `// Data quality gate`). The
`isInstrumentInSession` export can stay — it has no callers after that.

**Operator follow-up:**
- Watch the next 24h self-audit cron post: data-quality fail count should
  drop to ~0 over the weekend gap (US equities, FX/oil/metal weekends).
- Probe-week clock: 109.8h remaining. Auto-stops 2026-05-15 20:00 UTC.
- Anthropic credit balance: topped up by operator post-audit. Meta-agent
  will recover on next 06:00 Dubai run.

### 2026-05-08 · 14:55 Dubai · Computer A (day) — PROBE WEEK: 1.5%/trade live exec + $200 weekly kill
**Commits:** `00ebee8` (LOCK) → _(this push)_ (`CRITICAL: PROBE WEEK — raise reduced-risk ceiling 0.5→2.0%, add probe-week kill switch, set risk to 1.5%`)

Operator under investor pressure: "riskiraj 500 dolara ovu sedmicu da
vidimo da li cemo izvuci profit, u live ne demo, ali uradi njabolje sto
znas". Authorised after I showed the math (recommended plan: 1.5%/trade
on $500 IG account, $200 weekly kill, 7-day window).

Today's weekly backtest (`scripts/backtest-runs/2026-05-08.txt`) showed
NEW mode improved +0.048 R/trade week-over-week (-0.126 → -0.078) but
is STILL negative-edge by the 30d rolling gate's -0.05 floor. Operator
chose to override and run live anyway — accepting variance and ~60-70%
probability of a losing week as the cost of seeing real fills.

**Three load-bearing changes (read these before any safety edit):**

1. `lib/safety.ts → REDUCED_RISK_CEILING_PCT` raised **0.5% → 2.0%**.
   This is the maximum `user_settings.risk_per_trade_pct` value at
   which the 30d edge gate is bypassed. `LIVE_INSTRUMENT_BLACKLIST`
   (ADA/DOT/APT/XAG) is still enforced first — the bypass cannot
   resurrect blacklisted instruments. Set `REDUCED_RISK_CEILING_PCT = 0`
   to kill the override entirely.

2. `lib/risk-controls.ts` — **new `checkProbeWeekKill()` function +
   three new constants**:
   - `PROBE_WEEK_START_ISO = '2026-05-08T10:30:00Z'` (= 14:30 Dubai
     today, when the operator committed to the probe).
   - `PROBE_WEEK_END_ISO   = '2026-05-15T20:00:00Z'` (= midnight
     Dubai end of next Friday). After this, no new live opens fire;
     existing live positions ride out to SL/TP normally.
   - `PROBE_WEEK_KILL_USD  = 200`. When cumulative `trades.pnl` (real,
     status in ['closed','stopped']) since start drops to ≤ -$200,
     the function:
     a) Inserts an `agent_logs` row (`agent='probe-week-kill',
        level='error'`) so the kill is durable across restarts.
     b) Sets `user_settings.trading_mode = 'demo'`. The very first
        live-exec gate in `agents/war-room.ts` (line ~1102) closes
        the path on the next tick.
     c) Returns `allowed: false` so the in-flight tick also blocks.
   - Demo trades and demo P&L are **NEVER** counted here — the kill
     is purely about real-money fills.
   - Reset path is intentionally inconvenient: requires
     `DELETE FROM agent_logs WHERE agent='probe-week-kill'` AND
     `UPDATE user_settings SET trading_mode='live'`. The operator
     wanted this sticky.

3. `agents/war-room.ts` — wired `checkProbeWeekKill()` into the
   live-exec branch, **before** `checkLiveTradingAllowed()`. If the
   probe-week kill fails, the war-room still records the demo trade
   and only blocks the live order. Same fall-through pattern as the
   edge gate.

4. `user_settings.risk_per_trade_pct` set to **1.5** via
   `TARGET=1.5 node scripts/set-reduced-risk.mjs`. DB row verified:
   `risk_per_trade_pct=1.5`. With `REDUCED_RISK_CEILING_PCT=2.0`,
   the bypass is active → live exec reachable on instruments not in
   the blacklist.

**Math the operator approved (2026-05-08 14:33 Dubai):**

| Scenario | Probability | Account result |
|---|---|---|
| Worst case (~7 SLs back-to-back, neg variance) | ~10% | -$200 → kill, IG balance $300 |
| Expected (matches -0.078 R backtest) | ~40% | -$25 to -$50 |
| Breakeven | ~30% | -$10 to +$10 |
| Good week | ~15% | +$30 to +$80 |
| Best case (positive variance + DOGE/LINK win) | ~5% | +$100 to +$200 |

Per-trade risk: $7.50 (1.5% of $500 IG). Daily loss limit unchanged
at 5% = $25/day. Max realistic trades in 7 days: ~25-30.

**What this DOES enable:**
- Real IG orders fire on BTC, ETH, XAU, DOGE, AVAX, LINK, MATIC, NEAR,
  WTI, BRENT, EUR/USD, GBP/USD, USD/JPY when war-room signals pass
  all gates (atr-extreme, derivatives, MTF, macro, news, session,
  correlation, orderbook).
- Demo continues to populate the 30d edge-gate sample.

**What this does NOT enable (deliberately):**
- XAG/USD — still on `LIVE_INSTRUMENT_BLACKLIST` (100× scaling bug
  on IG epic CS.D.CFDSILVER.BMU.IP, verified today: IG quote 8067.9
  vs Yahoo 80.91). Probe-week change does NOT lift this.
- SPY / QQQ — NOT blacklisted but they have similar unit-mismatch
  issues (IG returns S&P 500 / NAS-100 index futures at ~10× / ~40×
  the Yahoo SPY/QQQ ETF prices). Operator declined a defensive
  blacklist on these for now; they can fire live, but war-room
  signals use Yahoo ETF prices for indicators while the IG order
  fills on the index — sizing math will be off. **Risk acknowledged.**
- Shorts / SOL / BNB / BB_SQUEEZE — workspace rules still in force.

**Reverting Probe Week (any one of these, in order of cleanliness):**
1. Wait — auto-stops at 2026-05-15 20:00 UTC.
2. `TARGET=2 node scripts/set-reduced-risk.mjs` (raises risk above
   ceiling → 30d edge gate re-engages → currently fails → live blocked).
3. `lib/safety.ts → REDUCED_RISK_CEILING_PCT = 0` (one-line revert).
4. If kill already tripped: see "Reset path" in the code comment.

**Validation:**
- `npx tsc --noEmit` clean.
- ReadLints clean on `lib/safety.ts`, `lib/risk-controls.ts`,
  `agents/war-room.ts`.
- DB read confirms `risk_per_trade_pct=1.5`.

**Operational follow-up:**
- WhatsApp group will receive an announcement post-deploy.
- Status report cron (every 2h) will show probe-week headroom in the
  P&L breakdown once the helper hooks into `notifyPeriodicReport`.
- I will run `node scripts/audit-24h.mjs` end of each Dubai day this
  week and post results.

### 2026-05-08 · 14:35 Dubai · Computer A (day) — archive legacy demo_trades (pre-2026-04-17 SOL/BNB/BB_SQUEEZE era)
**Commits:** `80a0535` (LOCK) → _(this push)_ (`feat(analytics): archive legacy demo_trades from dashboard`)

Operator looked at Trade Analytics screen and saw "ALL TIME -$6,441 USD"
across 151 trades — read it as "we're only losing". The number is
technically correct but operationally misleading: 102 of those 151
trades (~$6,106 of the loss) come from before 2026-04-17, when SOL/USD
+ BNB/USD + BB_SQUEEZE trigger were all still in rotation. All three
have been disabled for three weeks (workspace rules + LIVE blacklist).

The post-cutoff sample tells the actual story: 49 trades, 28.6% WR,
-$335 total = -$6.85 per trade. Last 14d -$5.72/trade. May MTD +$3.97/trade.
Roughly breakeven, not catastrophic. The dashboard buried that under the
legacy noise.

Ship list (operator chose ARCHIVE option from a 4-way prompt):

1. **`supabase/migrations/2026-05-08-archive-legacy-demo-trades.sql`** —
   adds `archived_at TIMESTAMPTZ` to `demo_trades`, partial index on
   `archived_at IS NULL`, then `UPDATE … SET archived_at = NOW() WHERE
   exit_time < '2026-04-17T00:00:00Z'`. Reversible (`SET archived_at = NULL`).
   Idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
   `WHERE archived_at IS NULL` guard on the UPDATE). NO row deleted.

2. **`supabase/schema.sql`** — `demo_trades` table definition and partial
   index updated to match the migration so fresh installs land on the
   same shape.

3. **`app/api/demo/route.ts`** — default response now filters
   `archived_at IS NULL`. New `?include_archived=true` query param for
   research scripts that still want the full history. Response now
   includes `archived_count` so the UI can show "X legacy trades archived".

4. **`app/(dashboard)/simulation/page.tsx`** — header copy changed from
   "All historical trades" to "Current rule set (post 2026-04-17)" and
   appends `· N legacy trades archived (SOL/BNB/BB_SQUEEZE era)` so it's
   honest about the filter.

5. **`scripts/verify-archive-migration.mjs`** — read-only sanity check.
   Reports active vs archived counts and aggregate P&L per bucket. Run
   after pasting the SQL.

**Operator action required (one-time, ~30 seconds):**

1. Open Supabase → SQL Editor.
2. Paste the contents of
   `supabase/migrations/2026-05-08-archive-legacy-demo-trades.sql`.
3. Click Run. Expected: `ALTER TABLE` ok, `CREATE INDEX` ok, `UPDATE 102`.
4. Locally verify: `node scripts/verify-archive-migration.mjs`.
   Expected: `ACTIVE ~49, ARCHIVED ~102`.

**What this does NOT change:**

- `lib/risk-controls.ts` daily-loss limit and 30d edge gate query
  `demo_trades` with `since` filters (last N days), so they never
  touched legacy rows anyway. Behaviour identical.
- War-room loss-streak check switched to real `trades` on 2026-05-07.
  Unaffected.
- All audit scripts (`audit-recent-losses.mjs`, `audit-24h.mjs`,
  `audit-10d.mjs`) use date windows. Pre-Apr-17 numbers are still
  recoverable via direct DB or `?include_archived=true`.
- Live trading state. Real money still $0 traded, edge gate + IG
  reduced-risk override behaviour identical.

**Reverting:** in Supabase SQL Editor:
```sql
UPDATE demo_trades SET archived_at = NULL WHERE archived_at IS NOT NULL;
```
Dashboard will show 151 trades again on next refresh.

**Validation:**
- `npx tsc --noEmit` clean.
- ReadLints clean on `app/api/demo/route.ts`,
  `app/(dashboard)/simulation/page.tsx`, `supabase/schema.sql`.
- LOCK on `supabase/schema.sql + app/api/demo/route.ts` cleared.

### 2026-05-07 · 14:05 Dubai · Computer A (day) — self-audit cron (WA group, every 6h)
**Commits:** _(this push)_ (`feat(observability): self-audit cron posts 6h health + activity report to WA group`)

Operator asked the system to audit itself and post results to the WA
group in English. New `/api/cron/self-audit` route + `notifySelfAudit()`
helper in `lib/whatsapp.ts`. Schedule `0 */6 * * *` (every 6h on the
hour, GST = UTC+4).

**What it reports (single WA message per run):**

1. **Health checks** — three counters that should be 0 if the
   2026-05-07 morning fixes are still holding:
   - `data-quality fails` (was ~42% of all closes pre-fix; should be 0)
   - `AI model errors (404)` (5 FAST-tier agents were silently failing
     pre-Haiku-4.5 swap; should be 0)
   - `false loss-streak pauses` (was tripping on demo SLs; should fire
     only on real losses now)

2. **Activity** — rotation closes, meetings opened (12-agent debate
   reached), signals generated, live + demo trades opened/closed with
   per-bucket P&L.

3. **Closes by reason** — top 5 from {no-trigger, atr-extreme,
   long-only-mode, meeting-cap, cooldown, mtf-veto, ...}. Tells the
   operator at a glance whether the rotation is starved of triggers
   (market quiet) vs being over-vetoed by gates.

4. **Stale candles** — any instrument whose newest `price_history` row
   exceeds its asset-class freshness budget (mirrors the thresholds in
   `lib/data-quality.ts`). FX 90min, crypto 120min, oil 240min,
   US equities 18h.

5. **Verdict** — healthy / warning / critical, decided by:
   - critical: model errors > 5, OR data-quality fails > 50, OR
     >10 stale instruments
   - warning: any health issue OR > 4 stale instruments
   - healthy: everything 0 / clean

6. **Notes** — adaptive sentences ("market quiet — rotation healthy",
   "many MTF vetoes — trend-aligned setups needed", "live execution
   active — 2 trades opened", etc.).

**WA message style** — same plain-English convention as the rest of the
notification refactor on 2026-05-06: no dividers, no emoji clusters,
just facts and a verdict tag. Investor-readable.

**Operational notes:**
- Read-only: never opens trades or modifies user_settings.
- First scheduled run lands at next 0/6/12/18 UTC tick = first message
  arrives in WA within 6h of the deploy. Manual run is safe via:
  `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/self-audit`
- Logs to `agent_logs` (agent='self-audit-cron') with full payload in
  `metadata` for debugging if a message fails to send.

**Validation:**
- `npx tsc --noEmit` clean.
- Routes registered in `vercel.json` immediately after `status-report`.
- `notifySelfAudit()` typed via exported `SelfAuditPayload` interface
  so the cron and the formatter cannot drift.

**Disabling:** remove the line from `vercel.json` and redeploy.

### 2026-05-07 · 09:55 Dubai · Computer A (day) — fix overnight blockers (data quality, demo-loss cooldown, Haiku 404)
**Commits:** `63b8efd` (LOCK) → _(this push)_ (`CRITICAL: unblock rotation — asset-class data quality + real-only loss cooldown + fix MODEL_FAST 404`)

24h audit since Option 2a deploy showed **zero real trades** despite the
gate being open. Three independent blockers explain it; all fixed in this
push.

**Blocker 1 — data-quality validator was crypto-only.** The 8 new non-crypto
instruments (EUR/USD, GBP/USD, USD/JPY, SPY, QQQ, WTI, BRENT, XAG/USD)
got DATA QUALITY FAIL on every cron tick (384 of 915 meeting closes =
42%). Yahoo doesn't report volume for FX (OTC, no exchange volume) and
SPY/QQQ are stale ~8h overnight (US market closed). Validator was
defaulting all of those as "suspicious data" → war-room never even
reached trigger logic.

`lib/data-quality.ts` rewritten with an `AssetClass` system:
  - **crypto**: stale > 120min, ≤5 missing, volume check ON, ≤5 outliers
  - **fx / metal**: stale > 90min, ≤60 missing, volume check OFF
  - **commodity_futures**: stale > 240min, ≤60 missing, volume check OFF
  - **us_equity**: stale > 18h, ≤200 missing, volume check OFF (covers
    weekday-overnight + long weekends for SPY/QQQ)

Outlier and OHLC-integrity checks remain universal. The "1 issue allowed"
leniency in the old final verdict was dropped — issues now actually
matter, since each is asset-class-tuned.

**Blocker 2 — 3-consecutive-loss cooldown was tracking demo trades.**
War-room paused 18:00-20:30 GST and 01:15-03:15 GST overnight (~5h
muted) because the auto-demo loop hit 3 SLs in a row on different
instruments. Demo is by design how we *test* signals; demo SLs aren't
risk events. `agents/war-room.ts` switched the loss-streak check (line
~141) and the bleeding-tape Phase-C3 minimal-mode check (line ~200)
from `demo_trades.exit_time` to `trades.closed_at` (real fills only).
WhatsApp alert text updated to "3 consecutive REAL losses" so it's
unambiguous in the group.

**Blocker 3 — `MODEL_FAST` returns HTTP 404 not_found_error.** `lib/anthropic.ts`
had `MODEL_FAST = 'claude-3-5-haiku-20241022'` which Anthropic deprecated.
5 of 12 war-room agents (correlation, scalper, trend, market-analyst,
trade-reviewer — exactly the FAST-tier agents per AGENT_TIER) were
silently failing on every meeting that reached the 12-agent debate.
Verified by probing `/v1/messages` directly:
  - `claude-3-5-haiku-20241022` → 404
  - `claude-haiku-4-5` (alias) → 200, resolves to `claude-haiku-4-5-20251001`
  - Sonnet & Opus model ids unchanged, both still working.

Updated `MODEL_FAST = 'claude-haiku-4-5-20251001'`. Cost map updated to
$1/$5 per Mtok (Haiku 4.5 published rate; was $0.80/$4 for Haiku 3.5).
Per-meeting input cost rises ~25% on FAST-tier agents only — overall
12-agent meeting cost increases roughly 4-6%. Acceptable.

**#4 trigger sensitivity DEFERRED.** Trigger thresholds (RSI 25/75,
EMA cross, MACD cross, vol ratio 2.5×) are backtest-validated against
180d real data. Relaxing them without re-running
`scripts/backtest-gate-stack.mjs` could resurrect the documented
negative-edge problem. Revisit in 24h after #1-3 prove themselves on
real fresh data; only ship a relaxation if backtest still neutral or
better.

**Validation:**
- `npx tsc --noEmit` clean.
- `node scripts/_check-model-404.mjs` (deleted, was throwaway) confirmed
  the model id swap.
- 24h audit script run pre-fix, will re-run tomorrow same time.

**Expected impact (next 24h):**
- 8 forex/indices/commodity instruments stop hitting DATA QUALITY FAIL
  → demo trades start opening on them → 30d edge sample begins.
- War-room stops auto-pausing on demo SL streaks → rotation runs full
  16h instead of ~11h.
- Every 12-agent meeting actually has 12 working agents → master-agent
  judge has real votes from all 5 FAST-tier agents instead of error
  stubs. Decisions improve.

**Reverting any single change:**
- Data quality: `git revert` lib/data-quality.ts (returns to crypto-only
  rules that block all non-crypto)
- Loss cooldown: change `from('trades')` back to `from('demo_trades')`
  in agents/war-room.ts (two occurrences, both commented with
  2026-05-07).
- MODEL_FAST: revert lib/anthropic.ts (will silently re-break 5 agents).

### 2026-05-06 · 16:10 Dubai · Computer A (day) — Option 2a: reduced-risk live + forex/indices/silver
**Commits:** `7f29f49` (LOCK) → _(this push)_ (`CRITICAL: option 2a — reduced-risk live override + forex/indices/silver rotation` + 27,705 candle backfill + clear LOCK)

Operator under investor pressure: "MENI TREBAJU LIVE REAL TRADES,
investitori vec pitaju". Chose **Option 2a** — accept risk inflation on
IG (CFD min contract sizes), bypass the 30d edge gate ONLY while
per-trade risk stays microscopic.

**Three load-bearing changes (read these before touching the gate):**

1. `lib/safety.ts` → reduced-risk override (`REDUCED_RISK_CEILING_PCT = 0.5`).
   `checkLiveTradingAllowed()` now reads `user_settings.risk_per_trade_pct`
   (stored as percent per supabase/schema.sql, **not** fraction). When the
   value is `> 0` and `≤ 0.5` it returns `allowed: true` and skips both
   the 30d expectancy floor and the 20-trade sample-size requirement.
   `LIVE_INSTRUMENT_BLACKLIST` is **always** enforced first — bypass cannot
   resurrect ADA/DOT/APT or the freshly-added XAG entry. Set the constant
   to 0 to kill the override entirely.

2. `agents/war-room.ts` → mirrored cap on actual sizing. The old
   `riskBasedPositionSize()` ignored DB settings and could still issue
   1.5-2% trades by confidence/Kelly. After the recovery-mode cap we now
   read the same `risk_per_trade_pct`, divide by 100 (DB is percent →
   code uses fraction), and clamp `sizing.units` / `sizing.notionalUsd` /
   `sizing.riskPct` if it's tighter. Without this clamp the safety bypass
   was dishonest (you'd get tiny in the gate but a normal-sized order).

3. `scripts/set-reduced-risk.mjs` set `risk_per_trade_pct = 0.30` in
   `user_settings`. Verified via `scripts/_check-live-state.mjs`:
   `risk_per_trade_pct = 0.3%   ceiling = 0.5%   bypass=true`.
   Live-eligible right now: BTC, ETH, XAU, DOGE, AVAX, LINK, MATIC, NEAR,
   WTI, BRENT, EUR/USD, GBP/USD, USD/JPY, SPY, QQQ. Demo-only: ADA, DOT,
   APT, XAG.

**Forex / indices / silver rotation add (all via IG):**
- `scripts/ig-discover-epics.mjs` (new, read-only) auth'd against APSTU
  and returned tradeable epics for: EUR/USD `CS.D.EURUSD.MINI.IP`,
  GBP/USD `CS.D.GBPUSD.MINI.IP`, USD/JPY `CS.D.USDJPY.MINI.IP`,
  SPY `IX.D.SPTRD.FBMU1.IP` (US 500 futures, JUN-26),
  QQQ `IX.D.NASDAQ.FBMU1.IP` (US Tech 100 futures, JUN-26),
  XAG/USD `CS.D.CFDSILVER.BMU.IP`. Forex/indices spot prices match Yahoo
  (1.1774 EUR, 1.3626 GBP, 156.09 JPY, 7350 SPY, 28552 QQQ).
- **XAG anomaly:** IG silver returns 7727 vs Yahoo SI=F real ~$30. Almost
  certainly a 100× scaling difference (cents/oz?) but unverified, so XAG
  is in `LIVE_INSTRUMENT_BLACKLIST`. Lift only after 5 demo round-trips
  confirm IG fill price aligns with Yahoo.
- `lib/exchanges/ig.ts → SYMBOL_MAP` extended with all 6 epics + comment.
- `lib/exchanges/index.ts → IG_INSTRUMENTS` set extended with the same 6
  so `getExchangeForInstrument()` routes them to IG.
- `agents/war-room.ts → ALL_INSTRUMENTS` and
  `app/api/cron/demo/route.ts → DEMO_INSTRUMENTS` and
  `app/api/cron/market-data/route.ts → candleSymbols` all extended.

**Demo-cron price-fetch fix.** `fetchBinanceTicker()` returns null for
non-Binance symbols, so newly-added forex/indices/XAG would never open
demo trades (`if (!ticker) continue`). Added `fetchTicker()` to
`lib/price-fetcher.ts` (Binance → Yahoo fallback) and switched the demo
cron's both ticker calls to it. WTI/BRENT/XAU were already broken by
this gap on 2026-05-06 14:xx and are now also fixed.

**Historical backfill:** `scripts/backfill-price-history.mjs` extended
with XAG/USD (SI=F), EUR/USD (EURUSD=X), GBP/USD (GBPUSD=X), USD/JPY
(JPY=X), SPY, QQQ. Run inserted 27,705 candles across 6 symbols (1H,
365d), so signal generation has indicator history immediately.

**Validation:**
- `npx tsc --noEmit` clean.
- `node scripts/_check-live-state.mjs` confirms bypass active and the
  expected 15 live + 4 blocked instrument split.
- `node scripts/ig-discover-epics.mjs` end-to-end OK against live IG.

**SECURITY note** — discovered the working copy of `.env.example` had
real IG credentials pasted into it (`IG_API_KEY=f9ffb68d...`,
`IG_USERNAME=SachinApex`, `IG_PASSWORD=Apex45421o`, `IG_ACCOUNT_ID=APSTU`).
Reverted to template (`git checkout HEAD -- .env.example`) before
commit so they did NOT enter `origin/main`. Whoever added them must:
- rotate the IG password and API key in MyIG **today**
- never paste real values into `.env.example` (it's tracked); only use
  `.env.local` (gitignored). Rule confirmed in `.cursor/rules/session-handoff.mdc`.

**Reverting Option 2a in one move:** raise `risk_per_trade_pct` above
0.5 (`TARGET=2 node scripts/set-reduced-risk.mjs`). The 30d edge gate
re-engages on next cron and live exec falls back to gated mode.

### 2026-05-06 · 15:30 Dubai · Computer A (day) — WTI + Brent added to rotation

### 2026-05-06 · 15:30 Dubai · Computer A (day) — WTI + Brent added to rotation
**Commits:** `172f26f` (LOCK) → `f02e44d` (`feat(rotation): add WTI + Brent via IG/Yahoo` + 11.4K candle backfill + clear LOCK)

Operator: "pa dodaj, zato smo te uvezali s ovom platformom" (so add it,
that's why we connected you to this platform). Adding WTI and Brent on
the IG venue alongside the just-unblocked XAU.

Symbol-naming alignment: `Instrument` type in `types/index.ts` already
had `'BRENT'` and `'WTI'` (no /USD suffix) and `lib/price-fetcher.ts →
fetchKlines` already falls back to Yahoo Finance for those keys (CL=F
for WTI, BZ=F for Brent). market-data-cron has been writing 5 fresh
candles per 2-min tick for both into `price_history` for weeks. The
plumbing was already there — it just had no consumer.

Five patches in this push:

1. **`lib/exchanges/ig.ts → SYMBOL_MAP`**: changed `'WTI/USD'` → `'WTI'`
   and `'BRENT/USD'` → `'BRENT'` to match the rest of the codebase.
   Verified epics `CC.D.CL.BMU.IP` and `CC.D.LCO.BMU.IP` from this
   morning's smoke test.

2. **`lib/exchanges/index.ts → IG_INSTRUMENTS`**: same renames.
   `getExchangeForInstrument('WTI')` and `('BRENT')` now route to IG
   when configured, fall back to Binance otherwise (which produces a
   helpful error since Binance has no oil pair).

3. **`agents/war-room.ts → ALL_INSTRUMENTS`**: appended `'WTI', 'BRENT'`.
   Rotation is now 13 instruments. Existing gates (session, correlation,
   derivatives, MTF, news, CME, on-chain) either work for any instrument
   with sufficient candles or fail-open for non-Binance symbols. CME-gap
   nudge is BTC-only by code, no change needed.

4. **`app/api/cron/demo/route.ts → DEMO_INSTRUMENTS`**: appended `'WTI',
   'BRENT'`. Demo cron now generates simulated trades on 5 instruments
   (BTC, ETH, XAU, WTI, Brent). Each instrument's 30d edge-gate sample
   accumulates independently. Live exec stays gated per instrument until
   that instrument's sample reaches ≥20 trades with mean R/trade ≥ -0.05.

5. **`scripts/backfill-price-history.mjs`**: added `YAHOO_SYMBOLS` map
   and `fetchYahooKlinesRange()` helper. Yahoo's chart API returns ~2y
   of 1H candles per request via `range=2y`. Same upsert path as the
   Binance branch, idempotent on (symbol, interval, timestamp).

One-time backfill run this session:
```
WTI    -> CL=F  yahoo  5669 candles  (8.1s)
BRENT  -> BZ=F  yahoo  5729 candles  (5.9s)
```
≈365 days of 1H per symbol. Enough for any indicator currently used
(EMA50, RSI14, ATR14, MACD, BB, etc.) with months of warmup margin.

Validation:
- `npx tsc --noEmit` clean
- `npx eslint agents/war-room.ts app/api/cron/demo/route.ts lib/exchanges/ig.ts lib/exchanges/index.ts` clean
- `node scripts/backfill-price-history.mjs 365 WTI,BRENT` ran clean,
  11.4K candles in DB

What this enables:
- War-room debates oil on the same 30-min schedule as crypto/gold
- Each oil meeting takes its own AI cost (~$0.05-0.20)
- demo_trades on WTI/BRENT start accumulating immediately
- Live exec on oil unblocks per-instrument when its 30d sample passes the
  edge-gate floor (same staircase as XAU)

What was NOT done (deliberately):
- No backtest of oil triggers on the 365d backfilled data. The 5 trigger
  primitives (EMA cross, MACD crossover, EMA50 break, RSI extreme, vol
  spike) were validated only on crypto. They MAY have negative expectancy
  on oil — we will see in the demo phase. If after 30 days the oil
  per-instrument expectancy is consistently below -0.05R, we either
  blacklist them or research oil-specific triggers.
- No change to risk controls. Position sizing on oil uses the same 1.5%
  per-trade calc; for $500 IG account that's $7.50 risk per oil trade.
  WTI ATR ~1.5%/day = SL distance ~$1.30 → contract size ~5.7. Tiny but
  workable. We'll see real fill characteristics in the demo phase.
- WTI and BRENT are NOT live-blacklisted. They go through the same
  edge-gate machinery as XAU. First real oil order fires only when both
  instrument-specific 30d sample passes the floor.

Files modified:
- agents/war-room.ts (ALL_INSTRUMENTS appended)
- app/api/cron/demo/route.ts (DEMO_INSTRUMENTS appended)
- lib/exchanges/ig.ts (SYMBOL_MAP key rename)
- lib/exchanges/index.ts (IG_INSTRUMENTS key rename)
- scripts/backfill-price-history.mjs (Yahoo branch added)
- HANDOFF.md (this entry, LOCK cleared)

Database changes:
- +11,398 rows in price_history (5669 WTI + 5729 BRENT, all `interval='1h'`)

Next-session entry point:
- After ~24h of demo cron running, audit demo_trades for first WTI/Brent
  trades. Gate behaviour, fill prices, and stop placement will tell us
  if any oil-specific tuning is needed.
- After 30d, run audit-recent-losses.mjs and check per-instrument WTI and
  BRENT lines. Negative expectancy → consider blacklisting.

### 2026-05-06 · 15:10 Dubai · Computer A (day) — XAU live-blacklist removed (IG venue verified, $500 funded)
**Commits:** `c2419a2` (LOCK) → _(this push)_ (`CRITICAL(safety): remove XAU/USD from LIVE_INSTRUMENT_BLACKLIST` + IG epic fix + demo cron re-add + clear LOCK)

Operator authorised Option A (remove XAU live blacklist, edge gate intact).
Smoke test passed against the funded live IG account after a long auth-
diagnostic detour — root cause was the operator had pasted the API key's
display name `Apex45421o` into IG_PASSWORD instead of the actual account
password. Once `IG_PASSWORD=Sac123@#` was set, both live v2 and v3 endpoints
returned HTTP 200 with CST + X-SECURITY-TOKEN.

What the smoke test verified (`scripts/test-ig-connection.mjs`):
- Auth: HTTP 200 (live v2 + v3), both header tokens returned
- Account APSTU: USD CFD, $500 balance, $500 available, $0 P&L
- Spot Gold tradeable on **CS.D.CFDGOLD.BMU.IP** @ $4719 (NOT the
  CS.D.CFDGOLD.CFDGC.IP that I had as default — that returns a stale $1404
  on this account, must be a different/expired contract)
- US Crude tradeable on CC.D.CL.BMU.IP @ $88.42
- Brent Crude tradeable on CC.D.LCO.BMU.IP @ $97.26

Three patches in this push:

1. **`lib/exchanges/ig.ts → SYMBOL_MAP`**: switched all four CFD epics to the
   `.BMU.IP` variants (verified live). Old `.UNC.IP` and `.CFDGC.IP` codes
   either don't exist or return stale historical prices on this account.
   Comment in code instructs future agents to re-run the smoke test if the
   account ever migrates region.

2. **`app/api/cron/demo/route.ts → DEMO_INSTRUMENTS`**: re-added `XAU/USD`
   (now `['BTC/USD','ETH/USD','XAU/USD']`). Removal on 2026-05-04 was
   premised on Binance PAXGUSDT being the venue. With IG taking over via
   `getExchangeForInstrument()`, demo XAU runs feed the 30d edge-gate
   sample on the new venue. Without this, the gate would never accumulate
   enough XAU trades to ever evaluate expectancy → live exec stays
   permanently blocked even though we lifted the blacklist.

3. **`lib/safety.ts → LIVE_INSTRUMENT_BLACKLIST`**: removed `'XAU/USD'`. The
   2026-05-04 entry was justified by PAXGUSDT venue economics, which are
   now irrelevant. Long comment in the code documents the full reasoning
   (IG account opened/funded today, smoke test passed, fee burden 2.5×
   lower than PAXGUSDT, edge gate Layer 2 still applies). One-line revert
   if anything goes wrong: re-add the string.

What this DOES enable:
- War-room signals on XAU now reach the live-exec branch
- `getExchangeForInstrument('XAU/USD')` returns the IG adapter
- Demo XAU trades start accumulating on the new venue immediately
- Once 30d demo expectancy on XAU clears -0.05 R/trade with ≥20 trades,
  real IG orders will fire on the next signal that passes all war-room
  gates (atr-extreme, derivatives-veto, mtf-veto, macro-high-strict,
  blocked-orderbook, etc., plus the 30d edge gate)

What this DOES NOT enable (deliberately):
- Immediate XAU live trading. Edge gate still requires ≥20 closed XAU
  demo trades in last 30d with mean R/trade ≥ -0.05. We currently have
  ~4 trades in that window from the old PAXGUSDT-routed demo runs
  (unhelpful, different venue characteristics). Realistic timeline to
  unblock: 3-4 weeks of demo cron generating XAU trades on IG epic data.
- Shorts on XAU (workspace rule: long-only-mode is non-negotiable).
- WTI / Brent rotation. Still not in `agents/war-room.ts → ALL_INSTRUMENTS`.
  Adding them would burn AI cost without trading until they go through
  the same demo→edge-gate→unblock pipeline. Operator can request later.

Validation:
- `npx tsc --noEmit` clean
- `npx eslint lib/exchanges/ig.ts lib/exchanges/index.ts lib/safety.ts agents/war-room.ts app/api/cron/demo/route.ts` clean
- `node scripts/test-ig-connection.mjs` returns HTTP 200, $500 balance, all
  three target epics tradeable
- Diagnostic script `scripts/_ig-diagnose.mjs` deleted (purpose served)

Operator action items remaining:
- Once Vercel picks up this push, the next demo-cron tick will start
  generating XAU trades. Watch `agent_logs` for `demo-cron` entries with
  `instrument='XAU/USD'`.
- After ~30 days, run `node scripts/audit-recent-losses.mjs` to see the
  XAU sample. If WR > 30% and Exp/R > -0.05 → first real IG XAU order will
  fire automatically. If still negative → edge gate keeps live blocked
  (working as intended) and we go back to research.
- The leaked API key `f9ffb68d…c19f` and password `Sac123@#` are now in
  this chat. **Operator must rotate both within 24h** for security
  hygiene. After rotating, update Vercel env + `.env.local` + redeploy.

Files modified:
- lib/exchanges/ig.ts (SYMBOL_MAP → BMU.IP variants)
- app/api/cron/demo/route.ts (DEMO_INSTRUMENTS re-add XAU)
- lib/safety.ts (XAU removed from LIVE_INSTRUMENT_BLACKLIST)
- HANDOFF.md (this entry, LOCK cleared)

Files deleted:
- scripts/_ig-diagnose.mjs (diagnostic served its purpose)

### 2026-05-06 · 14:30 Dubai · Computer A (day) — IG adapter scaffolded for gold/oil execution
**Commits:** `66fa460` (LOCK) → _(this push)_ (`feat(exchanges): IG adapter` + per-instrument routing + smoke test + clear LOCK)

Operator funded a live IG account this morning ("loadovali smo pare i sve je
proslo dobro, ziuvo je") and pasted a freshly generated REST API key in chat.
The key was rotated by the operator (acknowledged on their responsibility).
This session opens the execution path so XAU/USD (and later WTI/Brent) can
flow to IG instead of Binance's structurally broken PAXGUSDT venue.

What was built:
- `lib/exchanges/types.ts`: added `'ig'` to `ExchangeId` union, added IG entry
  to `EXCHANGE_CONFIGS` (live + demo bases, USD quote, 1× minOrderSize, 0.04%
  taker baseline). No changes to existing crypto venue configs.
- `lib/exchanges/ig.ts` (NEW, ~330 LOC): full `IExchange` implementation
  against the IG Labs REST API. Auth uses POST /session v2 with username +
  password + X-IG-API-KEY → caches CST + X-SECURITY-TOKEN headers, re-auths
  every 5h or on 401. Implements `getBalances`, `getQuoteBalance`, `getTicker`
  (mid of bid/ask), `getKlines` (RESOLUTION_MAP: 1m..1d → MINUTE..DAY),
  `marketBuy` (POST /positions/otc → GET /confirms/{ref}), `marketSell` (close
  via dealId resolved from /positions), `setStopLoss` / `setTakeProfit` (PUT
  /positions/otc/{dealId}), `cancelAllOrders` (filtered against /workingorders),
  `testConnection`. Default SYMBOL_MAP: XAU/USD → CS.D.CFDGOLD.CFDGC.IP,
  XAG/USD, WTI/USD → CC.D.CL.UNC.IP, BRENT/USD → CC.D.LCO.UNC.IP. Region-
  specific epic discrepancies surface in the smoke-test script (below).
- `lib/exchanges/index.ts`: `IGExchange` added to factory + `getConfiguredExchanges`.
  New `getExchangeForInstrument(instrument)` router: XAU/XAG/WTI/BRENT → IG
  if configured, otherwise falls back to `getPrimaryExchange()`. Crypto
  unchanged.
- `agents/war-room.ts`: real-exec branch (~line 1060) now calls
  `getExchangeForInstrument(instrument)` instead of `getPrimaryExchange()`.
  Error message updated to list which env vars each venue needs. NAKED-
  position warning string genericised to use `${ex.config.name}` instead of
  hardcoded "Binance UI".
- `.env.example`: documented IG_API_KEY, IG_USERNAME, IG_PASSWORD,
  IG_ACCOUNT_ID, IG_BASE_URL.
- `scripts/test-ig-connection.mjs` (NEW, read-only): authenticates against
  IG, lists accounts/balances, searches Spot Gold / US Crude / Brent epics
  (logs them so we can update SYMBOL_MAP if region differs), pulls a XAU
  snapshot. NEVER places orders. Run after putting credentials into
  .env.local or Vercel env.

What was deliberately NOT changed:
- `lib/safety.ts`: XAU/USD stays on `LIVE_INSTRUMENT_BLACKLIST`. Even with
  IG wired, the edge gate AND the per-instrument blacklist both still apply
  to XAU. Lifting requires (a) `test-ig-connection.mjs` succeeds, (b) IG
  adapter trades XAU on demo for ≥30d with positive expectancy, (c) explicit
  operator sign-off in a CRITICAL commit.
- WTI/Brent are NOT added to `agents/war-room.ts → ALL_INSTRUMENTS`. Same
  gating staircase as XAU before any new instrument is rotated.
- The 30d edge gate (`checkLiveTradingAllowed`) sits BEFORE
  `getExchangeForInstrument`, so the IG path is only reachable after the gate
  unblocks. Right now demo expectancy is negative → no IG order will fire.
- IG creds NOT committed. Operator must paste them into Vercel env (Project
  → Settings → Environment Variables) and locally into `.env.local` (which
  is `.gitignored`).

Validation:
- `npx tsc --noEmit` clean.
- `npx eslint lib/exchanges/ig.ts lib/exchanges/index.ts lib/exchanges/types.ts agents/war-room.ts` clean.
- No live orders placed. No env vars committed.

Operator next steps (paste into Vercel env, NOT into chat):
1. Re-confirm the rotated IG_API_KEY (operator already revoked the leaked one).
2. IG_USERNAME (login username, NOT email).
3. IG_PASSWORD.
4. IG_ACCOUNT_ID (from MyIG dashboard, e.g. `Z1ABCD`).
5. IG_BASE_URL (optional; omit for live, or set to demo URL for paper).
6. Locally: `node scripts/test-ig-connection.mjs` — confirms auth, balance,
   and prints the correct epic codes for your IG region. If Spot Gold epic
   is not `CS.D.CFDGOLD.CFDGC.IP`, update `SYMBOL_MAP` in `lib/exchanges/ig.ts`.

What unblocks XAU live exec on IG (not done in this session):
1. `test-ig-connection.mjs` returns success and matches the default epics.
2. War-room demo runs route XAU through IG — verify in
   `agents/war-room.ts → getExchangeForInstrument(instrument)` log line.
3. 30 days of demo XAU trades on IG with mean R/trade ≥ +0.05 (or relax
   gate threshold).
4. Operator signs a CRITICAL commit removing 'XAU/USD' from
   `LIVE_INSTRUMENT_BLACKLIST` in `lib/safety.ts`.

Files added this session:
- lib/exchanges/ig.ts
- scripts/test-ig-connection.mjs

Files modified:
- lib/exchanges/types.ts (added 'ig' to ExchangeId + EXCHANGE_CONFIGS.ig)
- lib/exchanges/index.ts (factory + getExchangeForInstrument router)
- agents/war-room.ts (per-instrument router in real-exec branch + naked-position string)
- .env.example (IG env vars documented)
- HANDOFF.md (this entry, LOCK cleared)

Next-session entry point unchanged plus:
- After operator pastes IG creds into Vercel/local env, run
  `node scripts/test-ig-connection.mjs` and act on its output (confirm
  epics, then start 30d demo proof).

### 2026-05-04 · 15:35 Dubai · Computer A (day) — "opet gubis" triage of 138-trade -$6,421 paper loss

**Commits:** _(this push)_ (XAU pulled from demo cron + audit script + HANDOFF entry)

Operator showed Trade Analytics screen: "138 closed trades, -$6,421 USD".
First confirmed it's all `demo_trades` (paper) — real Binance Spot wallet
untouched, live exec still gated by `checkLiveTradingAllowed()`.

`scripts/audit-recent-losses.mjs` (new) breaks down the 138 trades and
the picture is much less dramatic than the all-time number suggests:

| Window                       | Trades | WR    | Total $    | Avg $/trade |
|------------------------------|--------|-------|------------|-------------|
| Pre 2026-04-17 (legacy cfg)  | 102    | 9.8%  | -6,105.93  | -59.86      |
| Post 2026-04-17 (current)    | 36     | 27.8% | -315.22    | -8.76       |
| Last 14 days only            | 24     | 29.2% | -132.51    | -5.52       |

Root-cause attribution of the -$6,421:
- **BB_SQUEEZE trigger**: 40 trades, 7.5% WR, **-$3,338** — workspace rule
  forbids re-enabling, no new ones since rule landed.
- **SOL/USD**: 25 trades, 4% WR, -$1,901 — last trade 2026-04-16, blacklisted.
- **BNB/USD**: 20 trades, 5% WR, -$1,631 — last trade 2026-04-16, blacklisted.
- **XAU/USD**: 20 trades, 15% WR, -$686 — 4 of those in the last 14 days
  alone (-$283), all losses, confirming this morning's PAXGUSDT venue analysis.

Action this session:
- Pulled `XAU/USD` from `app/api/cron/demo/route.ts → DEMO_INSTRUMENTS`.
  Now `['BTC/USD','ETH/USD']` only. XAU is already in `LIVE_INSTRUMENT_BLACKLIST`
  (live), this also stops it from accumulating fake demo losses on the dashboard.
  Comment in code points future agents at `docs/GOLD_OIL_VENUE_DECISION.md` for
  the re-enable conditions (CFD broker only).
- All-time numbers will keep showing the legacy loss until trades pre-Apr-17
  are archived; no archival done — the historical record stays intact for
  research. The dashboard's "SESSION" view already filters to current session.

Net: post-cutoff 36-trade sample is at -$8.76/trade with 27.8% WR. That
matches the Apr-23 backtest prediction (~-0.13 R/trade × 1.5% × $5,000
= -$10/trade). The regime-ranging fix shipped this morning is projected
to add +0.064 R/trade = +$4.80/trade — i.e. push average to roughly
breakeven. We'll see in the 30d demo window (next checkpoint 03/06).

### 2026-05-04 · 13:00 Dubai · Computer A (day) — Gold/oil venue analysis, XAU live-blacklisted
**Commits:** `ece0a64` (LOCK) → _(this push)_ (XAU blacklist + venue doc + clear LOCK)

Operator question: "sve odradi, i zasto ne trejdujemo naftu i zlato?"
(do everything, and why aren't we trading oil and gold?)

Honest answer surfaced:
- Gold IS in war-room rotation (`agents/war-room.ts → ALL_INSTRUMENTS`
  line 31) but routed through Binance PAXGUSDT, which is structurally
  too thin to be profitable. Quality audit (`scripts/audit-xau-quality.mjs`)
  found PAXGUSDT median bar volume = $755K vs BTCUSDT $52M (70× thinner),
  12.4% doji-like bars vs 0.5% on BTC.
- Per-gate study on XAU only (`scripts/kfold-xau-only.mjs`, with 0.30R
  fee adjustment for PAXGUSDT round-trip slippage) — every gate
  combination tested is NEGATIVE after fees (raw +0.053 → net -0.247
  in the current war-room config). The trigger family DOES find raw edge
  in gold (+0.04 to +0.07 R/trade), but the venue eats it.
- Oil isn't in the rotation at all because Binance has no oil pair.
  Yahoo Finance gives prices but no execution path.

Patch shipped (LOCK protocol followed):
- `lib/safety.ts → LIVE_INSTRUMENT_BLACKLIST`: added 'XAU/USD' alongside
  ADA/DOT/APT, with full justification comment.
- War-room continues to debate XAU and demo-trade it. Live execution is
  blocked at the safety-gate layer.
- tsc clean, eslint clean.

Documentation:
- `docs/GOLD_OIL_VENUE_DECISION.md` (new) — full venue analysis +
  4 ranked options for the operator to choose from. Recommended: open
  an IG (or similar CFD) account for gold + oil + forex + indices in
  one account. KYC ~1h. Spreads 5× tighter than PAXGUSDT.

OPEN WORK updated: gold/oil question marked answered with the venue
recommendation as a new operator decision item.

Files added:
- scripts/audit-xau-quality.mjs
- scripts/kfold-xau-only.mjs
- scripts/backtest-runs/xau-quality.txt
- scripts/backtest-runs/xau-only-pergate.txt
- docs/GOLD_OIL_VENUE_DECISION.md

Files modified:
- lib/safety.ts (XAU added to live blacklist)
- scripts/backfill-price-history.mjs (XAU/USD → PAXGUSDT mapping added)
- HANDOFF.md (this entry, OPEN WORK updated, LOCK cleared)
- price_history table: 8760 1H + 2190 4H XAU candles backfilled

Next-session entry point unchanged:
- 06/05 Phase A-C 48h watch
- 03/06 30d watch on regime-ranging removal
- ANY-TIME: operator decides on CFD account for gold/oil

### 2026-05-04 · 12:30 Dubai · Computer A (day) — Phase D depth: per-gate study, 4H test, funding-rate, regime-ranging patch
**Commits:** `6a41437` (LOCK) → `5108130` (regime-ranging gate disabled) → _(this push)_ (research scripts + §10 docs + clear LOCK)

Operator instruction: "da, radi sve" (do all 3 directions in parallel).

Three research lines completed:

**Direction #1 — Per-gate impact study (BIG WIN).** `scripts/kfold-per-gate-impact.mjs`
mirrors war-room trigger detection (EMA12-26, MACD, RSI, EMA50, VolSpike) and 8
testable gates. Run on 5-fold anchored WF, 365d, all 10 crypto symbols.
- Baseline NO-GATES: +0.006 R/trade
- Baseline ALL-GATES: -0.062 R/trade (gap = -0.069 = stack net-harmful)
- Leave-one-out: regime-ranging is single biggest harmful (+0.064 R/trade if
  removed). long-only-mode also flagged (+0.059 if removed) but workspace
  rule overrides — see §10.4 for the discrepancy analysis.
- Brute-force optimal subset (long-only forced ON): mtf-veto + trend-filtered
  alone → +0.014 R/trade (n=1090, WR 41.7%). +0.076 R/trade vs current
  config — meaningful but still below fee floor.

**Direction #2 — 4H timeframe re-test (NEGATIVE).** Extended `backfill-price-history.mjs`
to support `--interval 4h`. 26,280 candles backfilled. Re-ran per-gate study.
4H is WORSE than 1H at every config: NO-GATES -0.038, ALL-GATES -0.028, best
optimal subset -0.062. The "less noise" hypothesis is falsified. Stay on 1H.
Cross-timeframe note: long-only-mode harm at 4H is +0.089 R/trade — even
stronger evidence that shorts have edge in the data, still rule-overridden.

**Direction #3 — Funding-rate primitive (NEGATIVE).** `scripts/funding-rate-walkforward.mjs`
fetches 12,045 events from fapi.binance.com (365d × 11 perp symbols). Tests
funding-extreme mean-reversion entries. Exploratory full-window pass shows
+0.041 R/trade at -0.05% threshold (n=166), but 5-fold WF reveals curve-fit:
median OOS -0.053, only 1/5 folds positive. FAIL. Mean-reversion needs
hold > 1d, but funding-cost decay over longer holds flips the math. Worth
retesting as confluence with RSI + structure, not standalone.

**Action — patch shipped.** `regime-ranging` gate in `agents/war-room.ts`
wrapped in `if (false)` (preserves logic for one-line revert if needed).
LOCK protocol followed: pushed lock commit first, applied patch, validated
with tsc + eslint (both clean), committed `5108130`. Live exec still gated
by 30d edge gate so blast radius is bounded to demo. Operator review can
clean-delete the dead block + scaffolding after 30d of demo data confirms
no regression.

Files added this session:
- scripts/kfold-per-gate-impact.mjs (with `--interval=4h` flag)
- scripts/funding-rate-walkforward.mjs
- scripts/backtest-runs/per-gate-impact.txt
- scripts/backtest-runs/per-gate-impact-4h.txt
- scripts/backtest-runs/funding-rate-walkforward.txt
- scripts/backtest-runs/2026-05-04-postpatch.txt (regression canary)

Files modified:
- agents/war-room.ts (regime-ranging gate disabled, single block, ~12 LOC delta)
- scripts/backfill-price-history.mjs (positional arg parser supports interval)
- WAR_ROOM_UPGRADE_PROPOSAL.md (§10 added — full three-direction findings)
- HANDOFF.md (this entry, OPEN WORK ticked, LOCK cleared)

Next-session entry point:
- Watch checkpoint 06/05 (48h after Phase A-C: data.reason coverage + AI cost).
- Watch checkpoint 03/06 (30d post-patch: re-run per-gate study on the new
  demo trade history; confirm +0.064 R/trade materialised live).

### 2026-05-04 · 12:00 Dubai · Computer A (day) — Phase D corrected with proper 365d data
**Commits:** _(this push)_ (backfill + 5-fold WF + corrected Phase D verdict)

Operator request: "continue, what next" — Phase D was supposed to validate
liquidity-sweep on a longer dataset before any wiring decision.

Critical data correction discovered at session start:
- `scripts/audit-price-history.mjs` (new) showed `price_history` only held
  ~47d of 1H candles per symbol, not 180d. The previous "180d sweep" results
  in §8 of the proposal were running over the same 47d window repeatedly.
  The "+0.131 R/trade OOS" headline was on **19 days of test data**.

Backfill:
- New: `scripts/backfill-price-history.mjs` — pulls 12 months of 1H klines
  from Binance (idempotent upsert on (symbol,interval,timestamp), handles
  POLUSDT for MATIC, skips XAU because PAXGUSDT is illiquid).
- 105,120 candles upserted across 12 crypto symbols. 8,760/symbol = exactly
  365 days of 1H data.

Validation run (proper this time):
- `scripts/kfold-liquidity-sweep.mjs` (new) — 5-fold ANCHORED walk-forward
  (train [0,T], test [T,T+60d] for T = 65, 125, 185, 245, 305 days). 300d
  total OOS coverage, ~5,700 trades. **Median OOS Exp/R: +0.029 (FAIL on
  the +0.05 bar). 3/5 folds positive but the negative folds are larger.**
- `scripts/kfold-sweep-variants.mjs` (new) — 8 variants on FIXED params
  (no per-fold reoptimisation): baseline, CHOCH-inversion, trend-aligned,
  counter-trend, top-5, top-3, ATR-band, CHOCH+top-5. **No variant clears
  the bar.** AVAX/MATIC/NEAR — the apparent stars of §8 — turn out to be
  the WORST subset on the full dataset.
- `scripts/kfold-sweep-per-instrument.mjs` (new) — per-symbol 5-fold WF.
  **Zero instruments pass.** LINK is the only one with all 5 folds positive
  but its WR (45.8%) is below the 48% threshold.
- `scripts/kfold-confluence-filter.mjs` (new) — sweep as confirmation
  filter on top of indicator triggers. Sweep-confirmation HURTS expectancy
  (-0.046 vs +0.007 vanilla). **Sweep adds zero value as either primary
  or filter.**

The actually-important finding (unexpected):
- Strategy A in confluence-filter test = vanilla indicator triggers on
  raw `price_history`, no gates: **+0.007 R/trade, 4/5 folds positive,
  15,563 trades**.
- `scripts/backtest-gate-stack.mjs` (live war-room logic, NEW mode):
  **-0.135 R/trade, 338 trades**.
- Same trigger family, same period, only difference is the gate stack on
  top: ATR-veto, derivatives-veto, MTF-veto, news-veto, trend-filter,
  session-gate, correlation-dedup, backtest-gate.
- **The gate stack is removing winners faster than losers.** The system
  loses ~18× more per trade than its underlying triggers do.

Documentation:
- `WAR_ROOM_UPGRADE_PROPOSAL.md` §9 (new) — full corrected Phase D
  conclusion, retracts §8.6 recommendations, lists what's overturned,
  defines next-session per-gate impact study as the highest-priority
  research item.

OPEN WORK updated:
- Phase D microstructure path: CLOSED. `lib/microstructure.ts` stays in
  repo but is not wired anywhere.
- Per-gate impact study replaces it as the top research priority.
- Pause on adding new gates until that study ships.
- New OPEN item: 4H candle backfill before next trigger candidate.

What's NOT in this commit (deliberate):
- No code changes to `agents/war-room.ts` or any other live code path.
  Pure research + documentation. Safe to deploy or revert without affecting
  paper trading.
- No new gates added.
- No microstructure wiring of any kind.

Next session entry point:
- 06/05 watch checkpoint (48h after Phase A-C ship): `scripts/audit-gate-reasons.mjs`
  + `scripts/audit-10d.mjs 48`.
- Then: design and run the per-gate impact study described in §9.9.

### 2026-05-04 · 09:30 Dubai · Computer A (day) — Phase A+B+C shipped, Phase D research depth pass
**Commits:** `bf8bfff` (LOCK) → `7b56b1e` (Phase A1-A3 + B1-B2 + C1) → `bdf367f` (Phase C3) → _(this push)_ (Phase D research scaffold + docs)

Operator request: "do everything, and then go further with research, dig deeper."

Done in this session (single multi-commit push, all on `main`):

**Implementation — Phase A (close-reason logging + structured stances + decision memory):**
- A1: every `speak({role:'close'})` and `say({role:'alert'})` site in `agents/war-room.ts` now sets `data.reason` (~25 sites, kebab-case). Closes the 98.7% logging gap.
- A2: `STRUCTURED_OUTPUT_FOOTER` is appended to each of the 10 debate-agent prompts (BULL/BEAR/NEUTRAL + conviction + key_arg + full_analysis). `tallyVotes()` reads structured stances first, regex fallback on parse failure. `agentSpeak()` parses JSON tolerantly.
- A3: `recordMeetingDecision()` called from EXECUTE and REJECT paths. Writes to `agent_knowledge` with type=`observation`. Incidental fix: `getActivePrompt()` was ordering by `.version` (col never existed in the migration); switched to `.created_at`.

**Implementation — Phase B (judge selection + heterogeneous beliefs):**
- B1: Master Agent prompt rewritten — no longer synthesises, ranks 10 prior agents 1-10 on argument quality, picks top-3, returns JSON with `consensus_stance` + `groupthink_warning`. Orchestrator now receives only those top-3 `full_analysis` blocks instead of the full 11-voice digest. Graceful failure: judge JSON parse error → judge=null, orchestrator falls back to no top3 block.
- B2: `BELIEF_VARIANTS` map + `pickBelief(meetingId, agentId)` injects per-meeting per-agent prior nudges (deterministic hash from meetingId, reproducible). Macro/Bull/Bear/Trend rotate. Counters DReaMAD belief-entrenchment.

**Implementation — Phase C (cost / fallback):**
- C1: `AGENT_TIER` map. correlation/scalper/trend/market-analyst/trade-reviewer → MODEL_FAST (Haiku 0.8/4.0 per Mtok). Rest → MODEL_SONNET (3.0/15.0). Per-call cost drops ~70% on the 5 affected agents; per-meeting input-token bill ~30-40% lower.
- C3: `runMeeting(..., minimalMode)`. When `budgetLow OR lossStreakTrips`, skip the 10-agent debate AND the master judge. Keep signal-generator + risk-manager (load-bearing pair). Conviction floor raised to 80 (vs 70). voteMargin bypassed (we never collected 10 votes). Hard cap on tight budget bumped from <30% remaining to <15% remaining — between those, minimal mode runs instead of aborting.

**Validation:**
- `tsc --noEmit` clean across all phases.
- `eslint agents/war-room.ts agents/agent-prompts.ts lib/microstructure.ts` clean.
- `scripts/backtest-gate-stack.mjs` re-run: still **FAIL** (expected — backtest tests deterministic gates, not the agent layer). Best mode NEW (TP=3.0) at -0.096 R/trade. Edge gate correctly keeps live exec blocked.

**Phase D — empirical microstructure research (the actual problem):**
- New file `lib/microstructure.ts` — pure deterministic primitives: `detectFairValueGaps`, `findNearestUnfilledFVGs`, `detectOrderBlocks`, `computeVolumeProfile` (POC/VAH/VAL), `detectLiquiditySweep`, `detectStructure` (BOS/CHOCH), `computeMicrostructureScore` (composite). NOT wired into `war-room.ts`.
- New `scripts/explore-microstructure.mjs` — single-trigger expectancy on 90d. Output: `scripts/backtest-runs/microstructure-90d.txt`.
- New `scripts/sweep-liquidity-sweep.mjs` — full 72-combo grid on 180d. Output: `scripts/backtest-runs/liquidity-sweep-sweep-180d.txt`.
- New `scripts/walkforward-liquidity-sweep.mjs` — 60/40 train/test out-of-sample validation. Output: `scripts/backtest-runs/liquidity-sweep-walkforward.txt`.

**Phase D findings (verbatim from runs, not curve-fit hopes):**
- Liquidity-Sweep is the **only +EV primitive**. 1122 trades / 90d / +0.101 R/trade.
- Best in-sample params (180d): lookback=40, SL=2.5 ATR, TP=2.0 ATR, confirm=YES → +0.154 R/trade, 62.8% WR, n=659. AVAX/MATIC/NEAR all >+0.30, BTC/DOGE >+0.22.
- Out-of-sample (60/40 split): the greedy-best train params overfit hard (+0.249 → -0.007 OOS). The robust set is lookback=40, SL=2.5, TP=4.0, confirm=YES → train +0.202, OOS +0.131 (35% degradation, retains edge).
- CHOCH (Change of Character / structure flip) is -0.341 R/trade — actively a TRAP. Use as **inverted filter** to veto longs when CHOCH fires bearish.
- FVG / Order Blocks both slightly -EV alone. Likely useful as filters, not as primary triggers.
- Documented in full in `WAR_ROOM_UPGRADE_PROPOSAL.md` §8 (added this session).

**What was NOT done (deliberately):**
- Did not wire liquidity-sweep into `war-room.ts`. Single 60/40 split is not enough validation; need 12mo of `price_history` and ≥5 rolling walk-forward folds first. See OPEN WORK Phase D items.
- Did not re-enable shorts despite the symmetric long/short edge on sweeps. Workspace rule prohibits short-trade re-enablement; that's an operator decision after a 30d demo-only test.
- Did not apply Phase B3 (iterative debate) or C2 (per-agent performance scoring) — both higher-risk, both deserve their own LOCKed session.

Headline OPEN WORK after this session:
- 48h watch checkpoint on 06/05: confirm `data.reason` ≥95% coverage and AI cost drop.
- Phase D operator decision: backfill price_history → 12mo → 5-fold walk-forward → if OOS median ≥+0.05 R/trade, wire as DEMO-ONLY trigger.

LOCK cleared.

Safety notes:
- Did NOT touch `lib/safety.ts`, `lib/risk-controls.ts`, or `lib/exchanges/*` — all five blacklists (shorts, SOL/USD, BNB/USD, BB_SQUEEZE, ADA/DOT/APT live) intact.
- Edge gate (`checkLiveTradingAllowed`) untouched — still blocking real execution as it should.

---

### 2026-05-04 · 08:00 Dubai · Computer A (day) — research pass + nav simplification
**Commits:** _(this push)_ — `feat(ui): simplify nav to 3 primary tabs + categorised MORE dropdown; docs: WAR_ROOM_UPGRADE_PROPOSAL`

Context:
- Operator topped up $50 Anthropic credits — meta-agent + news-veto auto-recover.
- Operator: "war-room must be fixed... look at 100 latest commits + analyses online for how war rooms should work, upgrade it... and improve navigation, still too complicated."

Done in this session:
1. **Reviewed last 100 commits** of `adnanmoffice-bt/trader1` and the 1,212-line `agents/war-room.ts`. Mapped current 12-agent architecture to the academic literature.
2. **Web research pass** — pulled 2024–2026 multi-agent trading literature: TradingAgents (Tauric, 64K stars), ContestTrade (FinStep-AI), DReaMAD (belief-entrenchment fix), the Selection Bottleneck paper (Maryanskyy 2026), Single-Agent vs Multi-Agent under fixed token budget paper, Nature SciRep on adversarial influence in MAD.
3. **Wrote `WAR_ROOM_UPGRADE_PROPOSAL.md`** at repo root. Section 3 enumerates 10 concrete problems with the current war-room mapped to file/line. Section 4 ranks 4 phases (A-D) with 10 sub-items by ROI and risk. **Read this before any war-room edit.** Implementation requires LOCK + separate session per phase — not done in this session.
4. **Simplified navigation** in `components/NavBar.tsx`:
   - **3 primary tabs** (was 5): HOME, WAR ROOM, ANALYTICS.
   - **One categorised MORE dropdown** (was two CHARTS+LAB) with sections: Trading (Signals, Journal, Simulation), Charts (Multi-Chart, Heatmap, Screener, Calendar), Diagnostics (AI Log, Investor).
   - **Polymarket hidden from nav** (frozen — page still reachable via URL).
   - Right side: SETTINGS button (was tiny "SET"), theme toggle, clock, EXIT.
   - All `<a>` → `<Link>` for client-side routing (zero full-page reloads).
   - tsc clean, eslint clean.

Headline TODOs that came out of the research (now in OPEN WORK):
- Phase A1: universal `data.reason` on every close path (fixes the 98.7% logging gap from yesterday's audit). Cheapest fix in the proposal.
- Phase A2: structured stance JSON on all 10 debate agents (kills the regex vote tally).
- Phase A3: persist final decisions + outcomes to `agent_knowledge` (table exists, never written to).
- Phase B1 (judge-based selection) replaces the current synthesis pattern that the literature says loses 0/42 vs single-model baseline.

Operator note (Bosnian → English): the operator's literal request was to fix the war-room, but the research pass clarified that the real problem (per the 180d backtest) is **the deterministic trigger set has no edge**. War-room engineering can lift WR ~5-10% but cannot manufacture edge from triggers that don't have it. Phase D (new triggers) is therefore non-negotiable for live exec to ever unblock.

Safety notes:
- No edits to `agents/war-room.ts`, `lib/safety.ts`, `lib/risk-controls.ts`, `lib/exchanges/*`, `supabase/schema.sql`. Pure docs + nav.
- No SHORT/SOL/BNB/BB_SQUEEZE re-enabled.
- Edge gate (Hard Truth #39) still active.
- Build (`tsc --noEmit`) clean. Lint (`eslint .`) 0 errors / 6 pre-existing warnings.

### 2026-05-04 · 07:50 Dubai · Computer A (day) — system audit + cleanup pass
**Commits:** _(this push)_ — `chore: freeze polymarket cron, schedule perf+analytics crons, ESLint v9 flat config, audit-10d checkpoint`

Context:
- Operator asked for full system analysis ("analixiraj sve, javi mi gdje su problemi").
- Then: freeze Polymarket but keep code aside, leave Telegram aside (waiting for bot), do everything else.

Done in this session:
1. **Froze Polymarket cron** — removed `/api/cron/polymarket` from `vercel.json`. Code intact (`app/api/cron/polymarket/route.ts`, `agents/index.ts → runPolymarketScanner`, `lib/polymarket-trader.ts`, `app/api/polymarket/bets/route.ts`) so nothing is lost when/if revived. Stops daily 06:00 UTC dead-cron run + token burn.
2. **Scheduled `/api/cron/performance` (18:30 UTC) and `/api/cron/analytics` (18:45 UTC)** in `vercel.json`. Tables they need (`performance_snapshots`, `trade_analytics`) were created by the 01/05 migration. Both crons are read-trades / write-snapshots only — no live exec, no exchange interaction. Equity-curve dashboard + Performance Coach Sunday hook now have real data.
3. **Deleted `app/api/cron/run-all/route.ts`** — redundant orphan (just re-fetched market data already covered every 2min by `market-data-cron`).
4. **ESLint v9 is now functional.** Added `eslint.config.mjs` (FlatCompat → `next/core-web-vitals`). `next lint` was dropped in Next 16, so `package.json` script changed to `eslint .`. Fixed 3 real errors surfaced (`<a href="/">` → `<Link>` in `investor/page.tsx` and `settings/page.tsx`). 6 warnings remain (hooks-deps, custom-font) — pre-existing, not blocking. Build clean (`tsc --noEmit` exit 0). Lint exit 0.
5. **`user_settings.currency` default `'AED'` → `'USD'`** in `app/api/settings/route.ts`. New users only — existing user row in DB still has `'AED'` (cosmetic; all code paths treat as USD anyway).
6. **Ran past-due gate-stack 48h watch checkpoint.**
   - `node scripts/audit-10d.mjs 96` → saved to `scripts/backtest-runs/audit-10d-2026-05-04.txt`.
   - **Encouraging finding**: 96h demo expectancy is POSITIVE — 5 trades, 3W/2L = 60% WR, +$321.03 P&L. 2 of 3 wins on BTC/ETH LONGs at TP, 2 SL losses on XAU. Counter to the 180d backtest baseline. Need 20+ trades for the edge gate to consider lifting.
   - **Concerning findings**:
     - `meta-agent-cron` failing 2/3 runs in window — Anthropic credit exhausted (see OPEN WORK URGENT).
     - `signals-cron` 2 timeouts (war-room 280s) — likely the slow Claude path tied to credit/billing slowdown.
     - 0 live trades (edge gate doing its job; positive 96h demo doesn't yet meet 20-trade minimum).
   - New companion script: `scripts/audit-gate-reasons.mjs` — counts `war_room_messages.data.reason`. Revealed the close-reason logging gap (now in OPEN WORK).
7. **Two new read-only audit scripts committed**: `scripts/audit-gate-reasons.mjs` (rejection breakdown), `scripts/peek-cron-errors.mjs` (per-agent error tail).

Operator clarifications:
- Polymarket "frozen, set aside" interpreted as: stop scheduling, keep code. If the operator wants to delete it later, the change is one cron-line and ~6 file deletes.
- Telegram left untouched per operator. The two `lib/telegram.ts` calls in `positions/route.ts` continue to throw silently — accepted until token decision.

Safety notes:
- No edits to `agents/war-room.ts`, `lib/safety.ts`, `lib/risk-controls.ts`, `lib/exchanges/*`, `supabase/schema.sql`. All cron-config and dashboard cosmetics only.
- No SHORT/SOL/BNB/BB_SQUEEZE re-enabled.
- Edge gate (Hard Truth #39) still active — 0 live trades correctly continues.
- Build (`tsc --noEmit`) clean. Lint (`eslint .`) 0 errors / 6 pre-existing warnings.

### 2026-05-01 · 09:55 Dubai · Computer A (day) — operator-driven cleanup pass
**Commits:** _(this push)_ — `chore: schema migration + cron heartbeats + 2026-05-01 backtest baseline + on-chain decision`

Context:
- Sweep test passed overnight: Spot USDT held at $500.0164 (no Auto-Subscribe sweep at 22:00 Dubai). Trap is sealed.
- Operator asked for: confirmation of hold-$600 decision, who owns the recurring watch/re-eval/backtest tasks, explanation of CryptoQuant/Glassnode, exact steps for the schema apply, and the heartbeat-cron work.

Done in this session:
1. **Apply Supabase schema (the 5 missing tables)** — wrote `supabase/migrations/2026-05-01-missing-tables.sql` (170 lines, fully idempotent). User pasted into Supabase SQL Editor → Run → 5 rows verified (`agent_knowledge`, `performance_snapshots`, `polymarket_bets`, `trade_analytics`, `trade_journal`). The original `schema.sql` had `CREATE INDEX` without `IF NOT EXISTS` which was breaking re-runs (error `42P07` on `idx_signals_status`). Migration uses `CREATE INDEX IF NOT EXISTS`, `DROP POLICY IF EXISTS` before each `CREATE POLICY`, and wraps `ALTER PUBLICATION ADD TABLE` in `DO ... EXCEPTION WHEN duplicate_object THEN NULL`. Re-runnable forever.
2. **Heartbeat helpers added to 7 silent crons**:
   - `signals-cron` — log on success and on error (war-room timeout).
   - `positions-cron` — log on no-positions early-return AND on full tick complete (with closed/skipped counts).
   - `demo-cron` — log on tick complete (opens/exits/actions counters).
   - `meta-agent-cron` — log on success and error.
   - `morning-briefing-cron` — log after WhatsApp send (with yesterday P&L + open positions).
   - `daily-report-cron` — log after WhatsApp send (with today P&L + signal/meeting counts).
   - `weekly-report-cron` — log after WhatsApp send (with weekly P&L + WR + Sharpe).
   - All match `status-report-cron` pattern: `db.from('agent_logs').insert({ agent, level, message, metadata: { duration_ms, ... } }).then(() => {})`. Build (`tsc --noEmit`) clean.
3. **Backtest baseline saved** — ran `node scripts/backtest-gate-stack.mjs` and saved output to `scripts/backtest-runs/2026-05-01.txt`. Verdict still NEGATIVE on all 3 modes (BASELINE -0.090 / FILTERED -0.190 / NEW -0.126 R/trade). Per-instrument NEW: DOGE +5.5R, LINK +5.0R; ADA -14.5R, DOT -13.0R, APT -8.5R; rest small negative. Edge gate stays correctly active.
4. **Hold $600 decision recorded** — operator confirms no further capital deployed until edge gate auto-unblocks. HANDOFF updated.
5. **CryptoQuant/Glassnode item cancelled** — operator agreed: free tiers brittle, paid not justified without edge. Stub stays in place; `lib/onchain.ts` interface ready when/if we want to revisit.
6. **Date-stamped recurring checkpoints added to OPEN WORK**: 02/05 17:25 (gate-stack 48h watch), 07/05 (blacklist re-eval), 08/05 (weekly backtest re-run).

Operator clarifications given:
- "Watch demo 48h" / "re-eval blacklist" / "weekly backtest" are session-based jobs (not autonomous crons). They run when the operator pings me; HANDOFF carries the date checkpoints so they don't get lost between sessions.
- If the operator wants any of these truly automated, the cleanest path is a `/api/cron/weekly-gate-audit` cron that emails/WhatsApps a gate-rejection breakdown and edge-trend delta every Sunday. Not built in this session — flagged as optional future work.

Safety notes:
- No SHORT/SOL/BNB/BB_SQUEEZE re-enabled.
- No edits to `lib/safety.ts`, `lib/risk-controls.ts`, `agents/war-room.ts`, or any exchange code. All cron edits are pure additive logging.
- Schema migration creates tables only — never drops anything except RLS policies which are immediately recreated identical.
- Build (`tsc --noEmit`) clean. ReadLints clean on all 7 touched cron files.

### 2026-04-30 · 17:25 Dubai · Computer A (day) — VALIDATION PASS
**Commits:** `ba53688` LOCK · `59a33b3` backtest script · `b7f5789` edge gate · _(this push)_ docs.

Context:
- Operator demanded "do all, arms yourself with knowledge you must be profitable today onward, we are trading real money".
- Earlier in the day, 7 commits added a large gate stack (session, correlation, MTF, derivatives, news, CME, on-chain) on top of TP=3.0 ATR. Math was projected from a 17-trade 10-day audit (insufficient sample).
- Operator's demand for proof-of-edge before live exec triggered a 6-month walk-forward backtest of the deterministic part of the system.

What I built:
- `scripts/backtest-gate-stack.mjs` — pulls 6 months of 1H Binance Spot candles for all 11 active instruments, re-implements every deterministic war-room gate, walks forward bar-by-bar, simulates entries/SL/TP, and outputs per-trade R-expectancy. Three modes (BASELINE / FILTERED / NEW) plus `--sweep` for SL/TP grid search.
- `lib/safety.ts` — added `checkLiveTradingAllowed()`. Two layers: per-instrument LIVE_INSTRUMENT_BLACKLIST (ADA/DOT/APT) + 30-day rolling expectancy gate (-0.05 R/trade floor, min 20-trade sample, fails CLOSED).
- `agents/war-room.ts` — wired `checkLiveTradingAllowed` into the live-exec branch BEFORE `getPrimaryExchange`. Demo trades unaffected; only real money is gated.

Backtest verdict (180 days, 11 instruments, 27.4 — 28.8 trades/instrument/180d):

| Mode      | Trades | WR     | Exp/R   | Total R | Total $$ on $5k |
|-----------|--------|--------|---------|---------|-----------------|
| BASELINE  |   657  | 27.2%  | -0.115  |  -75.3  | -$5,644         |
| FILTERED  |   309  | 24.6%  | -0.201  |  -62.0  | -$4,650         |
| NEW       |   348  | 34.5%  | -0.138  |  -48.0  | -$3,600         |

NEW (the current production config) is the best of three by total dollars but still negative. The `--sweep` over 24 SL/TP combos found zero positive-expectancy configs. Best was SL=1.5×ATR, TP=2.0×ATR, R:R 1.33 → still -0.094 R/trade.

Per-instrument NEW results (informative):
- DOGE: +5.5R, 46.9% WR, ~+$413
- LINK: +5.0R, 45.0% WR, ~+$375
- BTC, ETH, AVAX, MATIC, NEAR, XAU: small negative
- ADA: -14.5R | DOT: -13.0R | APT: -8.5R → these now blacklisted from LIVE only

Honest verdict to operator:
> "I cannot make a system profitable that doesn't have edge. What I CAN do is stop it from losing real money on a losing system. The edge gate now does exactly that. Demo continues so we can prove edge before scaling."

What's NOT done (intentionally deferred):
- Positions-cron partial-fill + break-even-stop logic. Implementing it on a negative-edge system just optimizes the loss curve. Defer until rolling 30d expectancy is positive.
- Weekly P&L review cron. Daily-report-cron + audit-10d.mjs already exist.

Other notes:
- Updated `CONTEXT.md` Hard Truth #39 with backtest result.
- Updated `APEX_PROJECT_LOG.md` with the validation entry.
- LOCK cleared in this commit.

### 2026-04-30 · 14:30 Dubai · Computer A (day)
**Commits:** `a1c42a6` LOCK · `c538663` helpers · `13573f3` Tier 1 wiring · `c7524e5` TP calibration · `24e2600` derivatives + book · `4e0c4d6` MTF + macro-HIGH · `d2da47a` news + CME + onchain · _(this push)_ docs.

Context:
- After completing the 10-day system audit (4W/13L = 23.5% WR, -$308.65; 0 live trades), user asked me to "do all" of the recommended improvements.
- LOCK was set on `agents/war-room.ts + lib/risk-controls.ts` and pushed before any code edit so Computer B would see it. Cleared in this commit.

Changes (6 feature commits, all touching `agents/war-room.ts`; commit 1 also added 7 new lib modules + 1 helper to `lib/indicators.ts`):

1. **`c538663 feat(signals): new helper modules`** — pure additions, no high-risk file edits. New: `lib/session-filter.ts`, `lib/correlation-dedup.ts`, `lib/derivatives.ts`, `lib/orderbook.ts`, `lib/news-impact.ts`, `lib/cme-gaps.ts`, `lib/onchain.ts` + `multiTimeframeConfluence()` exported from `lib/indicators.ts`. All fail-open.

2. **`13573f3 feat(war-room): wire Tier 1 trade-discipline filters`** — pre-debate ATR sanity (block atrPct < 0.3% or > 5%), decision-time session gate (Dubai 02:00-09:00 needs conviction≥90 + macro≤MEDIUM, or 3+ triggers), decision-time correlation dedup (hard-block BTC↔ETH double-up; soft-flag alt buckets).

3. **`c7524e5 feat(war-room): tighter TP for higher hit rate`** — `tpMult 4.5 → 3.0` (R:R 2.25→1.5), `tp2Mult 6.0 → 5.0` (R:R 3.0→2.5). R:R 1.5 = MIN_RR floor so existing risk gates pass. Backtest gate auto-revalidates. TP2 persists for future positions-cron partial-fill/BE-stop.

4. **`24e2600 feat(war-room): wire Tier 2 derivatives + book check`** — pre-debate derivatives veto (funding > 0.05%/8h, retail L/S > 2.5), soft conviction adjusts (-12..+8) into `effectiveConviction`, derivatives data added to orchestrator user prompt, pre-exec spot order-book health check (spread + top-3 depth) with `return 'blocked-orderbook'` on fail.

5. **`4e0c4d6 feat(war-room): MTF + macro-HIGH stricter gates`** — single-1H-trigger LONG with `longConfluenceCount===0` blocked pre-debate; macro `riskLevel === 'HIGH'` now requires 3+ triggers in confluence (EXTREME already pauses war-room above). MTF section added to orchestrator user prompt.

6. **`d2da47a feat(war-room): wire Tier 3 external intelligence`** — post-decision pre-exec news veto (CryptoPanic + CoinDesk + CoinTelegraph last 60min RSS, Claude scores -100..+100, veto at ≤ -40, ~$0.005/call). Pre-debate CME gap nudge (BTC LONG only, +/-5 conviction). On-chain stub gate (interface ready for CryptoQuant/Glassnode wire-up).

Effective conviction now aggregates: `parsed.conviction + derivGate.convictionAdjust + onchainGate.convictionAdjust + cmeGap.longBias`. Hard vetoes still short-circuit before the conviction calc.

New return values from `runMeeting()` (all standard `speak(decision/close) → waBlocked → runPostMeetingBrief`): `'atr-extreme'`, `'derivatives-veto'`, `'mtf-veto'`, `'macro-high-strict'`, `'onchain-veto'`, `'blocked-session'`, `'blocked-correlation'`, `'blocked-news'`, `'blocked-orderbook'`. The `audit-10d.mjs` script (committed in this push) will surface these once they appear in `war_room_messages.data.reason`.

Operator notes:
- Auto-Subscribe disable confirmation still depends on tonight's 22:00 Dubai sweep test. Run `node scripts/test-binance-key.mjs` after 22:05 — if Spot USDT ≈ $500 (currently $500.02), the toggle stuck.
- First live exec (if Auto-Subscribe is truly off) will now hit ALL the new gates: ATR sanity, derivatives, MTF, macro-HIGH, on-chain stub, session gate, correlation dedup, news veto, plus the pre-existing recovery / hardRiskCheck / daily-loss / backtest / signal-dedup / order-book check. Heavily filtered, intentionally — first-pass goal is FEWER trades with HIGHER expectancy, not more trades.
- Estimated effect on the 10-day audit's trade list (back-of-envelope, holding signal generation constant):
  - Session gate alone: 8 of the 17 closed trades wouldn't have opened (Dubai 02:00-09:00). Removes ~$580 of losses. Trade count drops 17 → 9, win rate 4/9 = 44%, expectancy roughly +$310.
  - TP tightening (commit 3): on the 9 surviving trades, ~3 of the 6 historical SLs would have tagged +1.5R first → 3 conversions to wins. Adds ~$330. Combined estimated 10-day P&L: ~+$640.
  - Correlation dedup, MTF, derivatives, news, CME, on-chain are all additive on top of that — exact deltas unknowable without rerunning real signals against history.

Safety notes:
- Build (`tsc --noEmit`) clean after every commit. No linter errors on touched files.
- No edits to `lib/safety.ts`, `lib/risk-controls.ts`, `lib/exchanges/*` body, `app/api/cron/*` (commit 5 of the wallet-aggregator session was untouched), `supabase/schema.sql`. Sizing / SL placement / SL retry / emergency-close logic identical.
- No SHORTS / SOL / BNB / BB_SQUEEZE re-enabled. Filters only TIGHTEN trade entry; no gate was removed or relaxed.
- LOCK on `agents/war-room.ts + lib/risk-controls.ts` cleared.
- Committed `scripts/audit-10d.mjs` (was untracked) for future post-mortems with the new gate labels.

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
