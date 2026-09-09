# Decisions

One entry per architectural call, with the reasoning. These are judgments a
judge can test, and they are ours regardless of who typed the code.

---

## D-001 — Standardized-schema path over composing two Graph products

**Date:** 2026-09-07 · **Status:** Adopted

The Graph's Composable/Standardized track accepts either composition of two or
more Graph products, or meaningful use of a standardized schema. We take the
standardized-schema path via Messari Standardized Subgraphs.

**Why:** Lower integration risk on a compressed timeline, and closer to the
track's stated ideal. The leverage statement is also cleaner to demonstrate:
one query pattern, N lending protocols compared, zero per-protocol integration
code. Composition would have meant two integrations and a weaker story.

---

## D-002 — Policies as the Privy control

**Date:** 2026-09-07 · **Status:** Adopted

Privy's track requires at least one control — policies, signers, key quorums or
intents. We implement policies.

**Why:** It is not a checkbox. The reason treasury automation does not already
exist at this company size is fear of an unbounded system moving money wrongly.
The policy layer is the mechanism that makes autonomy acceptable: routine flows
proceed, exceptions stop for a human. Without it we would not point an agent at
money at all.

---

## D-003 — State machine before happy path

**Date:** 2026-09-07 · **Status:** Adopted

The run lifecycle and its durable intent ledger are built before any successful
end-to-end path.

**Why:** Money in limbo is the failure mode a treasury product cannot survive. A
crash between "withdrew from venue" and "settled obligation" must be
recoverable, and must never double-spend. Idempotency keys on every
money-moving intent are therefore a day-one requirement, not hardening.

---

## D-004 — One corridor finished over four partial

**Date:** 2026-09-07 · **Status:** Adopted

Completeness is scored; breadth is not.

---

## D-005 — Fiat rails leg cut

**Date:** 2026-09-09 · **Status:** Adopted · **Supersedes:** pipeline step 06

The four-currency fiat settlement leg is cut from scope. NGN, KES, GHS and TZS
remain as the denomination of the obligation schedule — the treasury reasoning
is genuinely four-currency — but no real fiat moves.

**Why (three reasons, in order of weight):**

1. **It endangers a $5,000 prize.** The Graph AI track requires a net-new build
   ("Start Fresh" pool). Importing our existing rails-integration module would
   read as good engineering practice inside this repo and would forfeit that
   pool. The reuse instinct is exactly the risk.
2. **It is worth $0 directly.** Privy's Financial Flow track needs *one*
   functional flow. The Earn vault deposit/withdraw already satisfies it; the
   onramp was only ever a second, redundant qualifier.
3. **Two of six planned days were lost.** The brief already marked this leg
   cuttable if the week compressed. It compressed.

**Cost accepted:** the demo settles in test USDC on Arc only. We state that
seam plainly rather than hide it.

---

## D-006 — Three-layer decision core: agent proposes, kernel disposes

**Date:** 2026-09-09 · **Status:** Adopted

The decision core is three layers, not one:

1. An LLM agent reasons over live yields and the obligation schedule, and emits
   a structured **proposal** with a written rationale.
2. A deterministic **policy kernel** validates that proposal against hard
   invariants — buffer coverage, venue concentration cap, per-run movement cap,
   venue allowlist, liquidity floor — and may veto or escalate.
3. **Privy policies** enforce at the wallet as the final gate.

**Why:** The alternatives were each worse in a specific way. A pure
deterministic optimiser is the "script" we explicitly distinguish an agent from,
and gives the Graph AI track thin reasoning to score. An LLM that tool-calls
execution directly leans the entire safety argument on Privy policies alone,
which weakens the very claim we lead with.

The kernel not trusting the agent is the architecture. The agent may be wrong,
slow, or hallucinate a venue that does not exist; the kernel is pure functions
over a typed proposal and fails closed. Anything it cannot parse escalates to a
human — it never executes.

---

## D-007 — Fail closed on Graph query failure; never fall back to fixtures

**Date:** 2026-09-09 · **Status:** Adopted

If the live Graph query fails, the run fails. There is no cached-data fallback
and no fixture path in the query layer.

**Why:** Both Graph tracks state that mocked, local-only or static datasets do
not qualify. A silent fallback to cached data would be worse than an honest
failure — it would make the product look like it works while quietly
disqualifying the submission. Fixtures exist in tests only, never on a runtime
path.

---

## D-008 — Disclose AI assistance in commit trailers as well as ATTRIBUTION.md

**Date:** 2026-09-09 · **Status:** Adopted

Commits carry `Co-Authored-By` trailers naming the AI model, in addition to the
per-file record in `ATTRIBUTION.md`. Commit authorship remains the team member
who directed and reviewed the work.

**Why:** Disclosure is the protection, not the exposure. A team that states
plainly that the build was AI-assisted and shows its specs is in a stronger
position than one that gets asked and looks evasive. The trailers are not the
attribution mechanism — `ATTRIBUTION.md` is — but there is no upside to being
quieter about it than we have to be.

---

## D-009 — Graph query fails on quorum, not on any single subgraph

**Date:** 2026-09-09 · **Status:** Adopted · **Refines:** D-007

D-007 said a failed Graph query fails the run. The spike showed that is
unworkable as written: 11 of 46 lending deployments were unreachable at probe
time — "no allocations", "bad indexers", ordinary decentralized-network churn
with no fault on our side. A rule that fails the run whenever any one of 25
subgraphs is mid-reallocation would brick the product most days.

The rule is now a **quorum**: the run fails if fewer than `minProtocolQuorum`
protocols return usable markets. An individual unreachable subgraph is logged
and skipped.

**What does not change:** there is still no cache fallback and no fixture path
on any runtime code path. D-007's actual purpose — never quietly serving stale
or mocked data to a track that forbids it — is untouched. What changed is the
granularity of "failure", not the honesty rule.

---

## D-010 — The venue allowlist and liquidity floor are load-bearing, and the spike proved it

**Date:** 2026-09-09 · **Status:** Adopted · **Evidence:** spike F3, F4

Ranking the live market set by yield puts **rari-fuse FRAX at 174.24% APY with
negative $4.7M liquidity** at the top. Rari Fuse was exploited and abandoned in
2022; its subgraph still answers, and still reports the best yield in the set.
Iron Bank USDT reports 75.10%. Aave v3 USDC reports a genuine 12.85% on $2.16bn
of deposits with $0.2M of liquidity — the rate is real, the exit is not.

An agent optimising naively for APY sends the treasury to the first of these.

K4 (venue allowlist) and K7 (liquidity floor) were written as prudent hardening
before any data existed. They are now the two invariants standing between the
agent and a live trap that the highest-yield sort surfaces on the first query.

**Consequence for the demo:** show this. A yield ranking with rari-fuse at the
top, and the kernel refusing it, argues the product's whole thesis — the agent
proposes, the kernel disposes — better than any explanation of the
architecture.

---

## D-011 — Allocations are the target end state, not a delta

**Date:** 2026-09-09 · **Status:** Adopted · **Amends:** spec §4, §5 (K2, K5, K6)

`Proposal.allocations` now describes the treasury's intended end state per
venue. `TreasuryState.totalUsdc` is the whole treasury, liquid plus parked.
The orchestrator derives the moves by diffing target against current.

**Why:** the incremental shape could not express a withdrawal. K2 balanced
against the liquid slice only, K5 added targets on top of existing positions,
and K8 rejects non-positive amounts — so the agent could deploy surplus and
never pull it back. That is half the product missing: the brief's own framing
is "how much to park, where, and *when to pull it back* against obligations."

Three consequences:

1. **K2** checks the whole treasury. A rebalance that moves nothing still has
   to account for everything.
2. **K5** reads targets directly instead of adding positions to them. The
   split-across-runs concentration evasion the old form guarded against is now
   impossible by construction rather than by check.
3. **K6** measures *churn* — the sum of absolute differences between target and
   current — rather than the size of the targets. Under the old form it summed
   allocations, which under target semantics would charge a no-op rebalance the
   full value of the position and breach the movement cap every time.

**Discovered by wiring, not by review.** The gap only became visible when the
orchestrator had to turn a validated proposal into actual moves and there was
no way to express "take it out". Worth recording as evidence that building the
execution path early surfaces design errors that reading the spec did not.
