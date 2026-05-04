# War Room Upgrade Proposal — 2026-05-04

> Research-backed upgrade plan for `agents/war-room.ts`. **Read first** before any
> war-room edit. Sources cited. Ordered by ROI per token of work.
>
> **Status:** proposal only. Implementation requires LOCK on `agents/war-room.ts`
> and a separate session per phase.

---

## 1. Why we need an upgrade

The 2026-05-01 backtest baseline (`scripts/backtest-runs/2026-05-01.txt`) is unambiguous:

| Mode      | Trades | WR    | Exp/R   | Total R | $ on $5k |
|-----------|--------|-------|---------|---------|----------|
| BASELINE  | 643    | 28.0% | -0.090  | -58.0   | -$4,350  |
| FILTERED  | 309    | 24.9% | -0.190  | -58.8   | -$4,406  |
| NEW       | 346    | 35.0% | -0.126  | -43.5   | -$3,263  |

All three modes lose money on 180d, 11 instruments, with NEW (the live config) the
best of three but still negative. The deterministic triggers don't have edge,
and the 12-agent debate does not extract any. **The 96h demo audit (2026-05-04)
showed +60% WR / +$321 over 5 trades — encouraging but well below the 20-trade
minimum the edge gate requires before unblocking live exec.**

The 96h `agent-tools/audit-gate-reasons` snapshot also revealed that **war-room
has a debate-conversion of 0.15%** (6 decisions out of 3,926 meetings). Most
meetings short-circuit on the cheap pre-debate gates — the expensive 12-agent
debate is firing on a tiny minority of setups and is the part most exposed to
known multi-agent failure modes.

## 2. Research findings (2024–2026 literature)

### 2.1 Synthesis-based aggregation is the worst possible aggregator

Maryanskyy 2026 (arXiv 2603.20324) ran a controlled 5-cell experiment crossing
team composition × aggregation across 42 tasks (N = 210):

- Judge-based selection: WR **0.810** vs single-model baseline
- Majority vote: WR **0.496** (≈ chance)
- MoA-style synthesis: WR **0.179** — synthesis loses to a single model in 0/42 tasks

**Our current setup uses synthesis.** Master Agent (1000 tokens) summarizes 11
prior agents, then Orchestrator (1000 tokens) writes the final JSON. This is the
empirically worst aggregation pattern.

### 2.2 Belief entrenchment / groupthink in multi-agent debate

Liu et al. 2025 (arXiv 2503.16814, DReaMAD): multi-agent debate suffers from
belief entrenchment via two mechanisms:

1. **Biased static initial beliefs** — all agents see the same prompt, same
   data, same trigger context, so they start at the same point.
2. **Homogenized debate dynamics** — later agents read earlier ones' outputs and
   converge toward the loudest / earliest / most-confident voice.

Empirically: debate can *degrade* over rounds. DReaMAD's fix (perspective
diversity + prior elicitation) gives +9.5% accuracy over ReAct, +19% win rate
over standard MAD.

### 2.3 Single-agent ≥ multi-agent under fixed token budget

arXiv 2604.02460: under fixed thinking-token budget, single-agent systems
outperform multi-agent on multi-hop reasoning. Multi-agent decompositions create
*communication bottlenecks* that lose information. We pay 12× the tokens for
output that may be marginally worse.

### 2.4 Adversarial vulnerability

Nature SciRep 2026 (s41598-026-42705-7): a single strategically misaligned
agent can drop multi-agent system accuracy 10-40%. More rounds / more agents
don't fix it. Our 12 hand-written 600-token prompts are 12 attack surfaces.

### 2.5 Reference architectures

**TradingAgents v0.2.4** (TauricResearch, 64K stars, arXiv 2412.20138):
- Layered: Analyst Team (4) → Researcher Team (Bull vs Bear) → Trader → Risk → PM
- Bull and Bear *iterate over n rounds* addressing each other's specific points
- *Structured documents* between agents (not free-text dialogue) to avoid
  message-corruption / "telephone" effect
- Pydantic-typed structured output across all decision agents
- Persistent decision memory across runs
- Mixed model tiers: cheap for retrieval, deep for reasoning

**ContestTrade** (FinStep-AI, arXiv 2508.00554):
- Two teams (Data + Research) with **internal contest mechanism**
- Each agent's predictions are scored on real market feedback continuously
- Only top-ranked agents' outputs are adopted in final decision
- Research agents each get a *distinct "trading belief"* — heterogeneous priors
  break belief entrenchment by construction

## 3. What's wrong with the current war-room (concretely)

| # | Problem | File / line | Impact |
|---|---------|-------------|--------|
| 1 | Synthesis aggregation (Master + Orchestrator combine) | `agents/war-room.ts ~580-625`, `agents/agent-prompts.ts:masterAgent` | -0.6 WR per Maryanskyy |
| 2 | Vote tally is regex over free text | `agents/war-room.ts:601-602` | "I am NOT bullish" matches `/bullish/` → counted as bull |
| 3 | All 11 non-orchestrator agents return free-text | `agents/agent-prompts.ts` (10 of 12 builders) | No structured stance; conviction is implicit |
| 4 | Static identical prompts for all meetings | `agents/agent-prompts.ts` | Belief entrenchment by construction (DReaMAD) |
| 5 | Sequential, not parallel | `agents/war-room.ts:550-595` | 12× latency, no contest mechanism possible |
| 6 | Compact-context truncates non-decision agents to 150 chars | `agents/war-room.ts:56-65` | Bear Wyckoff's nuanced argument loses detail before Master sees it |
| 7 | No iterative debate (each agent speaks once) | `agents/war-room.ts:550-595` | TradingAgents-style Bull↔Bear refinement absent |
| 8 | No persistent decision memory used | `agent_knowledge` table, populated by meta-agent only | Per-meeting agents can't recall past decisions on same instrument |
| 9 | All agents on same expensive model (sonnet-4) | `lib/anthropic.ts` | Wastes tokens on retrieval-style sub-tasks; weak-model paradox unused |
| 10 | 98.7% of close events have no `data.reason` | `agents/war-room.ts` (every `speak({role:'close'})`) | Audit cannot detect over-tightening |

## 4. Upgrade phases — ranked by ROI

Each phase is independently shippable, independently reversible.

### Phase A — Cheap, high-impact, low-risk (≈ 2 hours)

**A1. Universal `data.reason` on every close path.**
- Every `speak({ role: 'close', ... })` in `war-room.ts` gets a `data: { reason: 'cooldown' | 'no-triggers' | 'data-quality' | 'balance-gate' | 'phase-1b' | ... }`.
- Fixes the audit blind spot. Lets the existing `audit-gate-reasons.mjs` script
  detect over-tightening.
- Risk: extremely low (additive only).

**A2. Replace regex vote tally with structured agent output.**
- Change all 10 debate-agent prompt builders to demand JSON:
  ```json
  { "stance": "BULL"|"BEAR"|"NEUTRAL", "conviction": 0-100, "key_arg": "..." }
  ```
- Parse via the same `callAgent<T>` JSON pathway already used for the orchestrator.
- Tally is now `votesFor = parsed.filter(p => p.stance === 'BULL').length`.
- Eliminates "NOT bullish → bullish" failure.
- Risk: low. Failed parses fall back to current regex (graceful degrade).

**A3. Persist final decision + outcome to `agent_knowledge`.**
- After every meeting, insert one row: `{ agent_id: 'orchestrator', type: 'observation', title: '<instrument> <direction> <decision>', context: { trigger, conviction, votes, gates_passed } }`.
- Enables meta-agent + future per-agent scoring without further schema changes.
- Risk: low. Already-existing table, never written to today.

### Phase B — Architecture refactor (≈ one weekend, medium risk)

**B1. Switch to judge-based selection.**
- Master Agent stops "synthesizing". New role: rank the 10 prior agents'
  arguments by quality (1–10 each), pick top-3, return a structured ranking
  with reasons.
- Orchestrator now takes the top-3 ranked arguments (not all 11) and decides.
- Implements judge-based selection per Maryanskyy. Expected uplift: +0.6 WR
  in their data; likely smaller in our setting but directionally positive.
- Risk: medium. Touches the decision path. Backtest gate `quickBacktest` is
  unaffected (deterministic).

**B2. Heterogeneous trading beliefs per meeting.**
- Each meeting picks one of N "macro stance" priors at random for the bull/bear
  agents, e.g. for Macro Agent: `{ hawkish, dovish, neutral }`. Stance is fed
  into the prompt as the agent's *bias*, not the instrument's analysis.
- Forces real diversity. Breaks the "all 12 agents starting from the same
  static prompt" failure mode.
- Risk: medium-low. Stances are explicit in prompt, easy to A/B vs static.

**B3. Iterative Bull ↔ Bear debate (2-3 rounds).**
- Replace single-pass speeches for Bull-ICT and Bear-Wyckoff with a 2-round
  exchange where round 2 must address round 1's strongest counter-point.
- Modeled on TradingAgents Researcher Team's $n$-round dialectic.
- Net token impact ≈ neutral if other agents speak less; can be positive.
- Risk: medium. Adds branch in war-room flow control.

### Phase C — Cost-conscious upgrades (medium term)

**C1. Mixed model tiers.**
- Move `market-analyst`, `correlation-agent`, `scalper-agent` (retrieval-heavy)
  to Claude Haiku (or sonnet-3.5-haiku). Keep deep-thinking on
  `bull-agent`/`bear-agent`/`risk-manager`/`orchestrator`.
- TradingAgents pattern. Maryanskyy's exploratory result: adding a *weaker*
  model can simultaneously raise win rate AND lower cost.
- Risk: low. Per-agent model selection is a one-line config in `lib/anthropic.ts`.
- Expected savings: 30-50% per meeting.

**C2. Per-agent performance scoring (lightweight ContestTrade).**
- After each closed trade, score every speaking agent's stance against the
  outcome. Persist agent-level WR / expectancy to `agent_knowledge`.
- Weight votes by historical agent score in `effectiveConviction` calculation.
- Risk: medium. Requires careful avoidance of over-fitting to small samples.

**C3. Single-agent fallback when budget is low.**
- When `getDailyBudgetStatus().remainingPct < 20%` OR after 3 consecutive
  losses, route the meeting to a single deep-thinking agent with the full
  context dump and skip the 12-agent debate.
- Defends the wallet on bad days, leans on the single-agent ≥ multi-agent
  finding under fixed token budgets.
- Risk: low. Pure fallback path.

### Phase D — Edge research (the actual problem)

**D1. New trigger sources.** Already in OPEN WORK. Without them, no amount of
war-room engineering matters. Candidates from research:
- ICT order blocks + fair-value gaps
- Volume-profile POC reclaims
- Funding-rate mean-reversion
- Microstructure: order-book imbalance > 3:1

**D2. ContestTrade-style Data Team.** Pre-digest 24h of market data + news +
derivatives into a 4K-token "textual factor" before agents see it. Reduces token
waste and surfaces signals the agents currently miss.

**D3. Per-trigger, per-instrument 6-month backtest gate.** Already have
`scripts/backtest-gate-stack.mjs`. Make it a CI hard requirement: any new
trigger must show ≥ 0.05 R/trade in backtest before reaching the war-room.

## 5. Suggested implementation order

| Order | Phase | Time | Risk | Live-trade impact |
|-------|-------|------|------|-------------------|
| 1 | A1 (close-reason logging) | 1h | very low | observability only |
| 2 | A2 (structured stances) | 2h | low | better votes, no behavior change |
| 3 | A3 (decision memory) | 30m | very low | observability + future fuel |
| 4 | C1 (model tiers) | 1h | low | -30-50% cost |
| 5 | B1 (judge selection) | 4h | medium | better decisions |
| 6 | B2 (heterogeneous beliefs) | 3h | medium | breaks groupthink |
| 7 | C3 (single-agent fallback) | 2h | low | wallet defense |
| 8 | B3 (iterative debate) | 4h | medium | better edge cases |
| 9 | C2 (agent scoring) | 1 day | medium | adaptive weighting |
| 10 | D2 (Data Team) | 2 days | medium-high | new signal layer |

Phase A as one PR. Then C1. Then B1+B2 as a single LOCKed multi-commit PR. Etc.

## 6. What NOT to do

- **Don't add more agents.** The single-agent paper says we already have too many.
- **Don't add more rounds of unstructured debate.** That's belief entrenchment.
- **Don't re-enable shorts, SOL/USD, BNB/USD, BB_SQUEEZE.** Documented losers.
- **Don't loosen any gate to "let more trades through".** The backtest verdict
  is that the trigger set has no edge — letting more through just loses faster.

## 7. References

- Maryanskyy A. (2026). *When Agents Disagree: The Selection Bottleneck in Multi-Agent LLM Pipelines*. arXiv:2603.20324.
- Zhao L. et al. (2025). *ContestTrade: A Multi-Agent Trading System Based on Internal Contest Mechanism*. arXiv:2508.00554.
- Xiao Y. et al. (2024). *TradingAgents: Multi-Agents LLM Financial Trading Framework*. arXiv:2412.20138. https://github.com/TauricResearch/TradingAgents
- Liu X. et al. (2025). *From Belief Entrenchment to Robust Reasoning in LLM Agents (DReaMAD)*. arXiv:2503.16814.
- *Single-Agent LLMs Outperform Multi-Agent Systems on Multi-Hop Reasoning Under Equal Thinking Token Budgets*. arXiv:2604.02460.
- *When collaboration fails: persuasion driven adversarial influence in multi-agent LLM debate*. Nature Scientific Reports 2026, s41598-026-42705-7.
