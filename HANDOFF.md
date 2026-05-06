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

_(none — cleared 2026-05-06 ~15:10 Dubai after XAU live-blacklist removal landed)_

---

## SESSION LOG (newest on top)

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
