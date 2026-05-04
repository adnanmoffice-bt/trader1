# Gold and oil — venue decision

> **Status:** awaiting operator decision. Written 2026-05-04 after operator
> asked "why aren't we trading oil and gold?"

## TL;DR

- **Gold** — already in `agents/war-room.ts → ALL_INSTRUMENTS`, debated by
  the AI, paper-traded. **Live execution disabled** as of 2026-05-04
  because the Binance PAXGUSDT venue eats all the edge in fees.
- **Oil** — not in the rotation. Adding it without a real execution venue
  would burn AI cost ($1-3/cycle/instrument) for zero revenue path.

The blocker for both is **execution venue**, not code. Until a separate
broker / futures account is connected, both stay paper-only.

## Why gold is structurally unprofitable on PAXGUSDT

`scripts/audit-xau-quality.mjs` (run 2026-05-04 against the 365d backfill):

| Metric | XAU (PAXGUSDT) | BTC (BTCUSDT) | Ratio |
|---|---|---|---|
| Median bar quote volume | $755K | $52M | **70× thinner** |
| Doji-like bars (range<0.1%) | 12.4% | 0.5% | 25× more |
| Average ATR % of price | 0.331% | 0.607% | half as volatile |
| Timestamp gaps | 0 | 0 | clean |

`scripts/kfold-xau-only.mjs` (per-gate study, XAU vs BTC, with the 0.30R
fee adjustment for PAXGUSDT round-trip slippage):

| Config | XAU raw Exp/R | XAU after fees | BTC raw Exp/R |
|---|---|---|---|
| NO GATES | -0.038 | -0.338 | -0.001 |
| long-only-mode | +0.038 | -0.262 | +0.017 |
| long-only + mtf-veto | +0.066 | -0.234 | +0.055 |
| long-only + trend-filtered | +0.040 | -0.260 | +0.085 |
| Current war-room config (~all gates) | +0.053 | -0.247 | +0.142 |

Every single configuration tested is **negative after fees** for XAU on
PAXGUSDT. The trigger family DOES find raw edge in gold (+0.04 to +0.07
R/trade) — the venue eats it.

The 0.30R fee burden comes from:
- 0.10% PAXGUSDT bid/ask spread (typical, much wider in low-liquidity hours)
- 0.05% Binance taker fee × 2 sides = 0.10% round-trip
- Total ≈ 0.20% slippage on a 0.33% average ATR move = 0.60 / 2 = **0.30R per round trip**

For comparison BTC's BTCUSDT spread is ~0.005-0.01%, fees same 0.10%,
ATR 0.61% → fee burden ≈ 0.06R per round trip. **5× lower than PAXGUSDT.**

## Why oil isn't on Binance at all

- Binance Spot has no Brent or WTI pair.
- Binance Futures has no oil contracts (only crypto perps).
- "Oil tokens" that exist (e.g. some altcoins claiming oil exposure) are
  illiquid, untrustworthy, and historically a fraud vector.

`lib/price-fetcher.ts` already maps `BRENT → BZ=F` and `WTI → CL=F` via
Yahoo Finance — so price data is reachable for free. Execution is the
hole in the loop.

## Venue options (operator decision, ranked by feasibility)

### Option A — CFD broker (recommended for $5K account size)

- **Brokers**: IG, Saxo, OANDA, Plus500, eToro
- **Markets**: gold (XAU/USD), oil (Brent, WTI), forex, indices
- **Spreads**: typically 0.02-0.05% on liquid hours for spot-gold,
  0.03-0.08% on Brent/WTI
- **Fee math** with 0.04% spread + 0.04% fee:
  - XAU: 0.08% / 0.33% ATR × 0.5 = **0.12R per round trip** (vs current 0.30R)
  - WTI: 0.08% / ~1.5% ATR × 0.5 = **0.03R per round trip**
- **Min deposit**: usually $250-1000
- **Pros**: tight spreads, supports gold + oil + indices in one account, API
  access (IG Labs, Saxo OpenAPI)
- **Cons**: CFDs are leveraged-by-default — risk-management code needs to
  understand the difference vs spot. UAE residents need to confirm
  regulator (DFSA / SCA / VARA) compliance per broker.

### Option B — IBKR (Interactive Brokers)

- **Markets**: futures (CL, BZ, GC, SI), forex, equities, crypto via Paxos
- **Fees**: $5 per futures contract round trip (CL = $1000/tick, BZ = $1000/tick,
  GC = $100/tick — hard to size on $5K)
- **Min deposit**: $0 for individual accounts
- **Pros**: institutional-grade, lowest spreads, real CME data
- **Cons**: futures contract sizes are too large for $5K. CL one-tick =
  $10 P&L, our 1.5% risk = $75 = 7.5 ticks — workable but margin
  requirements ($5K-$10K initial margin per CL contract) will lock the
  whole account. **Not viable at current capital.**

### Option C — Stay on Binance, add USDT-margined alt-pairs

- Already have all alts. No new venue. No gold or oil access.
- Recommended if the operator decides venue expansion isn't worth the
  KYC + capital fragmentation cost.

### Option D — A non-Binance crypto exchange with PAXG variants

- Bybit, OKX, KuCoin all list gold tokens with similar (poor) liquidity.
- Bitfinex has TGTUSD with somewhat better spreads but small order book.
- Marginal at best, not a real fix.

## Recommendation

For an account this size with the current edge profile (still paper-only
after the 2026-05-04 regime-ranging patch):

1. **Keep XAU/USD live-blacklisted.** The patch landed in `lib/safety.ts`
   on 2026-05-04. Demo trading continues for signal-quality data.
2. **Don't add WTI/Brent to war-room rotation** until a venue is connected.
   The macro-context already references oil price ($macro.oilWTI) so
   AI agents have it as a cross-asset signal — that's enough.
3. **If operator wants real gold/oil exposure: open an IG account.**
   Lowest friction, supports both markets, API-accessible. ~1 hour KYC.
   Document the API integration in a follow-up as a separate adapter
   under `lib/exchanges/ig.ts` parallel to `lib/exchanges/binance.ts`.

If/when an IG (or equivalent) account exists:
- Re-run `scripts/kfold-xau-only.mjs` with the new fee burden (0.12R)
- Lift `XAU/USD` from `LIVE_INSTRUMENT_BLACKLIST` if 30d demo Exp/R ≥ +0.05
- Add WTI to ALL_INSTRUMENTS in `agents/war-room.ts`, gated behind a
  similar 30d-demo-then-live process

## Files referenced in this doc

- `lib/safety.ts` — `LIVE_INSTRUMENT_BLACKLIST` (XAU added 2026-05-04)
- `agents/war-room.ts` — `ALL_INSTRUMENTS` (XAU stays in rotation)
- `lib/price-fetcher.ts` — already maps BRENT/WTI via Yahoo
- `scripts/audit-xau-quality.mjs` — venue quality audit
- `scripts/kfold-xau-only.mjs` — per-gate study with fee adjustment
- `scripts/backtest-runs/xau-quality.txt` — quality output
- `scripts/backtest-runs/xau-only-pergate.txt` — gate study output
