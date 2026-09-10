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

**Live figure, observed through the running API on 2026-09-09:** rari-fuse DAI
reported **12,728,198.58% APY on negative liquidity**, ranked first of 102
stablecoin markets across 20 protocols. The spike's 174% was the tame version.

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

---

## D-012 — Vite + React for the frontend, not Next.js

**Date:** 2026-09-09 · **Status:** Adopted · **Amends:** spec §3

The spec named Next.js. We shipped Vite + React.

**Why:** there is nothing for Next.js to do here. The API is a separate
service, so there is no server rendering, no data fetching in the framework,
and no routing beyond a single page. What Next.js would add on a four-day
build is a second build system to debug. Vite builds the whole app in 500ms
and the deliverable a judge sees is identical.

---

## D-013 — The refusal is shown once, not ninety times

**Date:** 2026-09-09 · **Status:** Adopted

The first build of the markets table struck through every refused market in
place. Against live data that rendered as fourteen consecutive identical
rari-fuse rows and pushed every usable market below the fold — 95 of 102
markets are refused, so the table was almost entirely noise.

It now leads with the single best rate on offer, struck through with the
reason, then lists only the markets the treasury can actually use, then counts
the rest in a footnote.

**Why this is a design decision and not a tweak:** the point of the page is
that chasing yield blindly is dangerous. That argument is made by the top of
the list. Repeating it down the page does not strengthen it — it buries the
answer to the operator's actual question, which is *where can my money go?*

Found by looking at the running page against live data, not by reading the
component.

---

## D-014 — The Privy wallet signs Arc, so no private key enters this process

**Date:** 2026-09-09 · **Status:** Adopted · **Amends:** spec §4 `chain`

Arc settlement transactions are built locally, signed by the Privy server
wallet through `POST /v1/wallets/{id}/rpc`, and broadcast by us.
`ARC_PRIVATE_KEY` is read exactly once — for the one-off transfer that funded
the Privy wallet — and never at runtime.

**Why:** the spike showed a Privy-signed payload carrying `chain_id 5042002`,
so Privy can sign for Arc directly. Two consequences follow, and both are
improvements:

1. **No private key is in our process, our config, or our memory.** The worst
   outcome of compromising this service is issuing signing *requests*, which
   the policy bounds.
2. **The policy becomes load-bearing.** Every Arc movement passes through it.
   Had we signed locally, the Privy policy would have gated the Earn flow only
   — a control over part of the money is a weaker claim than a control over
   all of it.

Verified end to end: 0.1 USDC settled on Arc in tx `0x5895e0ae…`, signed by
Privy, with no key held locally.

---

## D-015 — Two movement ceilings, deliberately different

**Date:** 2026-09-09 · **Status:** Adopted

The kernel caps movement per run at **8 USDC**. The Privy wallet policy caps
value per transaction at **10 USDC**. They are not meant to match.

**Why:** the kernel is the everyday constraint — tight, expressive, aware of
positions and churn. The wallet policy is the backstop that still holds when
the kernel does not run at all: a compromised orchestrator, a bug that skips
validation, an operator calling the API by hand. Setting them equal would
make the outer bound redundant; setting the outer one *lower* would mean
kernel-approved runs get refused at the wallet, training whoever is on call to
ignore refusals.

Outer bound above inner bound is the only ordering where both gates mean
something.

**Found by a live test, not by design review.** The first real settlement
attempt was refused — `policy_violation` — because the ceiling had been left
at the arbitrary value used to prove enforcement during the spike. The control
worked; the number was wrong. Which is the good failure of the two.

---

## D-016 — The allowlist names venues that can receive funds, not protocols we approve of

**Date:** 2026-09-10 · **Status:** Adopted

`PROTOCOL_ALLOWLIST` defaults to **`privy-earn`** alone — the curated Morpho
vault reached through Privy Earn, which is the only venue this deployment holds
an execution adapter for. Aave v3, Compound v3 and Spark remain in the
comparison set the agent reasons over. They are not fundable.

**Why:** the allowlist is the gate K4 enforces on *deposits*. Listing a protocol
we cannot deposit into does not express a risk preference, it authorises a
transfer that must then fail. A live run proved the point: with the three
blue-chips allowlisted the agent parked 70% of the surplus across two of them,
the kernel approved it, and execution settled all three legs as Arc transfers —
the compound-v3 and aave-v3 "deposits" existed only as ledger rows.

An allowlist that names unreachable venues is not a policy, it is a trap.

Widening it stays a one-line operator change: `PROTOCOL_ALLOWLIST=privy-earn,aave-v3`
once an adapter exists. The operator's original answer — blue-chip protocols
only — survives as the rule for *what may be added*, which is what it was for.

**Consequence, accepted:** one fundable venue means every allocation puts 100%
of parked capital in it, so K5 escalates every run to human approval. That is
the correct reading of a concentration limit, and the approval queue exists for
exactly this.

---

## D-017 — The agent is never asked to do money arithmetic

**Date:** 2026-09-10 · **Status:** Adopted

The prompt states the **finished** numbers: the minimum hold, computed with the
same `applyBpsCeil` the kernel validates against, and the maximum deployable.
It no longer gives the agent a buffer and a basis-point multiplier to combine.

**Why:** a live run proposed a hold of 7,014,550 against a floor of 7,015,000
and was vetoed for a shortfall of **450 minor units — $0.00045**. The reasoning
was sound; the ceiling division was not. Every other layer of this system
refuses to let a float near money, and then we asked a language model to
multiply by 11,500 basis points and round up.

Same discipline as `divCeil` and `applyBpsCeil`: compute money once, in one
place, and pass the result.

---

## D-018 — Two market lists in the prompt, capped separately

**Date:** 2026-09-10 · **Status:** Adopted

The prompt shows every allowlisted venue, then the top 20 forbidden venues as a
labelled comparison set. It previously showed the top 25 markets by rate.

**Why:** on live Graph data the highest rates are all abandoned subgraphs —
rari-fuse at 12,728,198% on negative liquidity, then four more above 800%. Of
the eight allowlisted markets in a real run, the best paid 4.93% and **not one
reached the top 25**. The agent was shown a page with no usable venue on it and
reported, correctly, that nothing was fundable. It held the entire surplus and
the rationale read as caution rather than as the blind spot it was.

A truncation by rate decided which venues the agent was permitted to consider.
Nothing may do that except the policy.

D-013 was the same failure in the UI and was fixed by restructuring rather than
by raising a row limit. This is that fix applied to the prompt.

---

## D-019 — The settlement counterparty is a different account

**Date:** 2026-09-10 · **Status:** Adopted

`SETTLEMENT_ADDRESS` is set to the funded Arc EOA, not left to default to the
treasury wallet. `pnpm demo:refund` returns the balance so the demo repeats.

**Why:** defaulting to the treasury wallet made every settlement a transfer
from an address to itself. It confirms on-chain, it costs gas, and it moves
nothing — a reviewer opening the transaction sees a self-transfer and is right
to discount it. Proving a settlement rail requires a counterparty.

The refund script uses `ARC_PRIVATE_KEY`, the faucet EOA's. The treasury wallet
still has no key in this repo (D-014); funding and refunding are the same
category of operator action, and both are disclosed.

---

## D-020 — Two obligation schedules, and the demo runs the scaled one

**Date:** 2026-09-10 · **Status:** Adopted

`OBLIGATIONS` selects between the business's real schedule ($12,200 over 30
days) and a 1/2000 testnet scaling ($6.10). The scaled one is the default.

**Why:** the treasury this build controls is a testnet faucet balance of about
12 USDC. Against the real schedule the agent is correct to park nothing on every
run forever — obligations exceed capital by three orders of magnitude, K1 vetoes
any surplus, and the demonstration proves the buffer invariant and nothing else.
The allocate → escalate → approve → settle path is never reached.

Scaling the obligations rather than inflating the treasury keeps every figure in
the demo a real one. The currencies, the categories, the due dates and the FX
table are untouched. The settlement is a real transaction for its real amount.
Only the denomination moves, and it moves visibly — the ids carry a `-scaled`
suffix so a ledger row can never be mistaken for the business's own.

`OBLIGATIONS=business` runs the real schedule and shows K1 refusing the whole
surplus, which is the other half of the demonstration.
