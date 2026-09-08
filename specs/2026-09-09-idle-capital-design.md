# Idle Capital — Design Spec

**Version:** 1.0 · **Date:** 2026-09-09 · **Status:** Approved
**Source requirement:** Idle Capital Engineering Brief, Rev A (2026-09-07)
**Supersedes:** nothing

---

## 1 · Problem

A twenty-person business trading across Nigeria, Kenya, Ghana and Tanzania holds
working capital in current accounts denominated in currencies that lose value
while the money sits. A large company solves this with a treasury team. A small
one cannot afford the headcount, so it absorbs the loss.

Idle Capital is that treasury function at zero headcount. It reads live onchain
lending yields, weighs them against a forward obligation schedule in four
currencies, and moves the surplus — under a spending policy it cannot exceed.

**Why an agent rather than a dashboard.** Routing a payment is a task; a script
does that. Deciding how much to hold liquid, where to park the rest, and when to
pull it back against obligations falling due on different schedules in different
currencies is a continuous judgment under changing conditions. That is the part
nobody small can staff.

**Why it is safe to automate.** The reason treasury is not already automated at
this company size is fear of an unbounded system moving money wrongly. The
policy layer is what makes autonomy acceptable: routine flows proceed,
exceptions stop for a human.

---

## 2 · Scope

### In

- Live lending-market data via Messari Standardized Subgraphs on Subgraph Studio
- Forward obligation ledger denominated in NGN, KES, GHS, TZS
- LLM agent that proposes an allocation with written rationale
- Deterministic policy kernel that validates, vetoes or escalates proposals
- Privy server wallet with policies as the enforcing control
- Privy self-service Earn vault deposit and withdrawal
- USDC settlement on Arc testnet
- Durable run/intent state machine with idempotent execution
- Web frontend: positions, proposals, rationale, approval queue, run history
- Architecture diagram and documentation

### Out (and why)

| Cut | Reason |
|---|---|
| Fiat settlement legs (NGN/KES/GHS/TZS rails) | See `DECISIONS.md` D-005. Endangers the net-new Start Fresh pool; worth $0 directly; the week compressed. |
| Multi-tenant accounts, auth | Single-treasury demo. Not scored by any track. |
| Live FX oracle | Documented fixed-rate adapter, disclosed. Honest seam. |
| Mainnet deployment | Arc is testnet. Stated plainly in docs and video. |

### Non-negotiable constraints

1. **No mocked, local-only or static data on any runtime path in the query
   layer.** Both Graph tracks disqualify it. Fixtures exist in tests only.
2. **Working frontend *and* backend.** All three Arc tracks require both; a CLI
   does not qualify.
3. **Demo video 2–4 minutes, human-narrated.** Outside that range is rejected at
   upload, not judged down.

---

## 3 · Architecture

pnpm monorepo, TypeScript throughout. Six libraries, two apps.

```
apps/web  ──────────────┐
                        ├──▶ apps/api ──▶ orchestrator + run state machine
apps/api  ──────────────┘         │
                                  ├──▶ packages/yields      (The Graph)
                                  ├──▶ packages/obligations (four-currency ledger)
                                  ├──▶ packages/agent       (LLM proposer)
                                  ├──▶ packages/kernel      (policy validation)
                                  ├──▶ packages/wallet      (Privy)
                                  └──▶ packages/chain       (Arc / viem)
```

| Package | Responsibility | Depends on |
|---|---|---|
| `yields` | One standardized query → N normalized lending markets | Graph only |
| `obligations` | Forward ledger → USDC buffer requirement at horizon | FX adapter |
| `kernel` | Pure validation of a proposal against hard invariants | nothing |
| `agent` | Market + obligation context → structured proposal + rationale | Anthropic API |
| `wallet` | Privy server wallet, policies, Earn vault | Privy SDK |
| `chain` | Arc USDC transfer and receipts | viem |
| `apps/api` | Run orchestration, state machine, SQLite ledger, HTTP | all packages |
| `apps/web` | Positions, proposals, approvals, history | apps/api |

**The load-bearing property:** `kernel` does not trust `agent`. The agent may be
wrong, slow, or name a venue that does not exist. The kernel is pure functions
over a typed proposal and fails closed — anything it cannot parse or verify
escalates to a human rather than executing.

---

## 4 · Package contracts

Interfaces are the spec; implementations may change freely behind them.

### `yields`

```ts
type Market = {
  id: string;              // subgraph market id
  protocol: string;        // e.g. "aave-v3"
  chain: string;
  asset: { symbol: string; decimals: number; address: string };
  /**
   * Fraction, e.g. 0.0431. NOTE: the Messari schema reports PERCENT
   * ("3.0674..." = 3.07%) and returns several rates per market including a
   * BORROWER/STABLE rate of 0. The adapter filters `side: LENDER,
   * type: VARIABLE` and divides by 100. See specs/spikes/ F1.
   */
  supplyApy: number;
  totalSuppliedUsd: number;
  totalBorrowedUsd: number;
  /** supplied - borrowed. MAY BE NEGATIVE on stale subgraphs — see F3. */
  liquidityUsd: number;
};

getLendingMarkets(opts?: { assetSymbols?: string[] }): Promise<Market[]>;
```

One GraphQL query pattern, executed against the Messari standardized schema,
returning markets across every indexed lending protocol. **This is the standards
leverage:** N protocols compared with zero per-protocol integration code. Adding
a protocol is a data change, not a code change.

Fails **closed on quorum**: if fewer than `minProtocolQuorum` protocols return
usable markets, this throws and the run fails. Individual indexer
unavailability is expected on the decentralized network (11 of 46 deployments
were unreachable during the spike) and is not a run failure. There is no cache
and no fixture path either way. (D-007, refined by D-009)

### `obligations`

```ts
type Currency = "NGN" | "KES" | "GHS" | "TZS";

type Obligation = {
  id: string;
  currency: Currency;
  amountMinor: bigint;     // minor units, never float
  dueDate: string;         // ISO date
  category: "payroll" | "supplier" | "tax" | "rent";
  confidence: number;      // 0..1, how certain this falls due as scheduled
};

bufferRequirementUsdc(obligations: Obligation[], horizonDays: number, asOf: Date): bigint;
scheduleByCurrency(obligations: Obligation[], horizonDays: number, asOf: Date): Record<Currency, bigint>;
```

Money is `bigint` minor units everywhere. No floating-point currency arithmetic
crosses a package boundary. Ratios are therefore expressed in basis points, so a
policy factor can be applied to a `bigint` without a float touching money.

Conversions round **up**. Under-reserving is the unsafe direction: a buffer that
is one unit too large costs nothing, one unit too small can miss payroll.

### `kernel`

```ts
type Allocation = { marketId: string; amountUsdc: bigint };

type Policy = {
  bufferHorizonDays: number;        // obligations within this window must stay covered
  bufferMultiplierBps: number;      // safety factor in basis points, 11500 = 1.15x
  venueAllowlist: string[];         // permitted market ids
  maxVenueConcentrationBps: number; // share of parked capital, 5000 = 50%
  maxRunMovementUsdc: bigint;       // ceiling on total moved in one run
  minVenueLiquidityUsd: number;     // liquidity floor a venue must clear
};

type TreasuryState = {
  availableUsdc: bigint;            // liquid, unparked
  positions: { marketId: string; amountUsdc: bigint }[];
  markets: Market[];                // the live set fetched THIS run
  bufferRequiredUsdc: bigint;       // from obligations, at policy horizon
  asOf: Date;                       // injected, never read from the clock
};

type Breach = {
  invariant: "K1" | "K2" | "K3" | "K4" | "K5" | "K6" | "K7" | "K8";
  message: string;                  // human-readable, shown in the approval queue
  observed: string;                 // the value that broke it
  limit: string;                    // the bound it broke
};

type Proposal = {
  hold: bigint;                 // USDC to keep liquid
  allocations: Allocation[];    // USDC to park, per market
  rationale: string;            // agent's written reasoning
};

type Verdict =
  | { kind: "approved" }
  | { kind: "vetoed";    breaches: Breach[] }   // structurally invalid, do not execute
  | { kind: "escalated"; breaches: Breach[] };  // valid but outside envelope, human decides

validate(proposal: Proposal, state: TreasuryState, policy: Policy): Verdict;
```

Pure. No I/O, no clock, no randomness — `asOf` is passed in. This is the package
that gets exhaustive TDD.

### `wallet`

```ts
ensurePolicy(policy: Policy): Promise<PolicyId>;
depositToEarn(amountUsdc: bigint, idempotencyKey: string): Promise<TxRef>;
withdrawFromEarn(amountUsdc: bigint, idempotencyKey: string): Promise<TxRef>;
```

A Privy policy denial is **not an error** — it resolves to an escalation. It is
an expected state of a correctly functioning system.

### `chain`

```ts
settleUsdc(to: Address, amountUsdc: bigint, idempotencyKey: string): Promise<TxRef>;
waitForReceipt(ref: TxRef): Promise<Receipt>;
```

---

## 5 · Policy kernel invariants

Every invariant is a pure predicate over `(proposal, state, policy)`. Each has a
severity that determines whether a breach vetoes or escalates.

| # | Invariant | Breach |
|---|---|---|
| K1 | Retained liquid balance ≥ buffer requirement over the policy horizon | veto |
| K2 | Conservation: `hold + Σ allocations == available balance` | veto |
| K3 | Every `marketId` exists in the live market set fetched this run | veto |
| K4 | No allocation to a market absent from the venue allowlist | veto |
| K5 | No market exceeds `maxVenueConcentrationBps` of parked capital *after* the run | escalate |
| K6 | Total moved this run ≤ `maxRunMovementUsdc` | escalate |
| K7 | Every target market has `liquidityUsd ≥ minVenueLiquidityUsd` | escalate |
| K8 | No allocation amount ≤ 0; no duplicate `marketId` | veto |

**Veto** means the proposal is structurally invalid — the agent produced
nonsense, and no human should be asked to rubber-stamp it. The run fails and is
recorded for inspection.

**Escalate** means the proposal is coherent but outside the autonomous envelope.
It parks in `AWAITING_APPROVAL` for a human, with the breaching invariants named.

An unparseable proposal is treated as K8 veto. The kernel never throws.

---

## 6 · Run state machine

```
  PROPOSED ──▶ VALIDATED ──────────────▶ EXECUTING ──▶ SETTLED
      │            │                        ▲
      │            │                        │ human approves
      │            └──▶ AWAITING_APPROVAL ──┤
      │                        │            │
      │                        └────────────┴──▶ REJECTED
      │                          human declines
      ▼
    FAILED   ◀── kernel veto · Graph failure · unrecoverable execution error
             (reachable from any state; never silently retried)
```

| State | Meaning |
|---|---|
| `PROPOSED` | Agent returned a proposal; not yet validated |
| `VALIDATED` | Kernel approved it |
| `AWAITING_APPROVAL` | Kernel escalated; a human must decide |
| `EXECUTING` | Intents are in flight |
| `SETTLED` | Every intent has a confirmed receipt |
| `REJECTED` | Human declined |
| `FAILED` | Kernel veto, Graph failure, or unrecoverable execution error |

### Intents

A run owns an ordered list of **intents**, each a single money-moving action:

```ts
type Intent = {
  id: string;
  runId: string;
  seq: number;
  kind: "earn_deposit" | "earn_withdraw" | "settle_usdc";
  amountUsdc: bigint;
  idempotencyKey: string;   // unique, stable across retries
  status: "pending" | "submitted" | "confirmed" | "failed";
  txRef: string | null;
};
```

**Recovery contract.** On startup, any intent in `submitted` is reconciled
against chain state before anything new is issued. An intent is never re-issued
under a fresh idempotency key. This is the answer to "money in limbo" (D-003),
and it is built before the happy path.

---

## 7 · Run data flow

1. Trigger — `POST /runs` (manual or scheduled)
2. `yields.getLendingMarkets()` — **live**; failure here fails the run
3. `obligations.bufferRequirementUsdc(horizon)` and per-currency schedule
4. Read current positions and balance via `wallet` + `chain`
5. `agent.propose({ markets, buffer, schedule, positions, balance, policy })`
6. `kernel.validate(proposal, state, policy)`
7. Branch on verdict:
   - approved → materialise intents → `EXECUTING`
   - escalated → `AWAITING_APPROVAL`, surfaced in the frontend
   - vetoed → `FAILED`, breaches recorded
8. Execution: each intent submitted through Privy (policy is the final gate),
   receipts awaited, statuses persisted per intent
9. `SETTLED` when every intent is confirmed

---

## 8 · Error handling

| Failure | Handling |
|---|---|
| Graph quorum not met | Run → `FAILED`. No cache, no fixtures. (D-009) |
| Individual subgraph unreachable | Logged and skipped; expected on a decentralized network |
| Agent returns unparseable output | Kernel K8 veto → `FAILED`, output stored verbatim |
| Agent times out | One retry, then `FAILED` |
| Kernel escalation | `AWAITING_APPROVAL` — expected, not an error |
| Privy policy denies | Escalation with the denial reason — expected, not an error |
| Chain revert | Intent → `failed`, run → `FAILED`, prior intents left recorded |
| Process crash mid-flight | Startup reconciliation of `submitted` intents before new work |

Retries use bounded exponential backoff and only ever on transient transport
errors — never on a policy denial or a revert.

---

## 9 · Testing

| Package | Approach |
|---|---|
| `kernel` | TDD, exhaustive. Every invariant K1–K8, both directions, plus malformed input. This is the safety-critical code. |
| `obligations` | Unit — horizon boundaries, multi-currency aggregation, minor-unit precision |
| `yields` | Integration against the live Studio endpoint; asserts the schema returns usable markets. Proves live data to a judge. |
| `agent` | Schema-conformance of output; recorded market fixtures used to test *validation*, never to fake a runtime path |
| `apps/api` | State-machine transition tests, including crash-and-resume |
| E2E | One scripted run: live Graph → proposal → kernel → Privy testnet → Arc testnet |

---

## 10 · Track traceability

| Track | Requirement | Where satisfied |
|---|---|---|
| Graph — Composable/Standardized | Standardized schema, live data, leverage shown | `packages/yields`, §4; README leverage statement |
| Graph — AI Use Case (Start Fresh) | Graph load-bearing; meaningful reasoning | `packages/agent` consumes `yields`; remove it and there is nothing to decide on |
| Privy — B2B Financial Product | Core integration; B2B workflow; a control | `packages/wallet`; treasury operation; **policies** |
| Privy — Best Financial Flow | One functional flow, generally available feature | Earn vault deposit + withdrawal |
| Arc ×3 | Working frontend + backend; diagram; docs; name the tracks | `apps/web` + `apps/api`; `docs/architecture.md`; submission text |
| Arc — Agentic Economy | "Decision logic tied to real signals" | Live Graph yields are the signal driving the proposal |

---

## 11 · Schedule

| Day | Deliverable |
|---|---|
| Wed 9 Sep | Repo + conventions ✅ · Graph spike · live `yields` · `obligations` + `kernel` TDD |
| Thu 10 Sep | `agent`, run state machine, API, SQLite ledger |
| Fri 11 Sep | Privy wallet + policies + Earn; Arc settlement |
| Sat 12 Sep | Frontend, architecture diagram, documentation |
| Sun 13 Sep | Demo video (human-narrated), README, submission text, submit before 12:00 EDT |

---

## 12 · Open risks

| Sev | Risk | Mitigation |
|---|---|---|
| ~~High~~ **RETIRED** | Messari schema coverage | **Spike complete 2026-09-09 — GO.** 25 protocols, 142 stablecoin markets, one query document. See `specs/spikes/2026-09-09-graph-schema-spike.md`. |
| High | Arc requires frontend + backend + diagram + docs on all three tracks | Full day reserved Saturday; diagram written alongside the build |
| Medium | Privy Earn vaults may need guided onboarding, which cannot be mocked for credit | Verify Wednesday. Fallback: stablecoin transfer flow, also explicitly eligible |
| Medium | Continuous commit history is enforced; squashing or a single push may disqualify | Conventions landed at commit 1; commit continuously, never squash |
| Low | Arc is testnet, so settlement is test USDC | State plainly in docs and video. Every Arc entrant is in the same position; an acknowledged seam scores better than a hidden one |
