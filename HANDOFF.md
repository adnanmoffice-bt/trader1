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

- [ ] Operator action: on Binance, transfer 1,100 USDT from **Funding → Spot** so war-room can execute real trades. Wallet UI will show `USDT TRADABLE > 0` after.
- [ ] Operator action (optional): redeem a chunk of USDT from **Simple Earn flexible → Spot** if you want more headroom than $1,100.
- [ ] Confirm `/api/wallet` reads the expected values on live URL after Vercel picks up `4b1c4ca`.

---

## LOCK (set if mid-edit, clear on exit)

<!-- If you are actively editing a risky file across multiple steps, put a line like:
LOCK: agents/war-room.ts — Computer A — started 2026-04-24 09:50 UTC
and clear it before you end the session. -->

_(none)_

---

## SESSION LOG (newest on top)

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
