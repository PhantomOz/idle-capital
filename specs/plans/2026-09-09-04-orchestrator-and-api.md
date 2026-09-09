# Orchestrator & API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `yields → obligations → proposer → kernel → ledger` into a real run, expose it over HTTP, and give a human the approval surface escalations need. Plus the kernel change target semantics requires.

**Architecture:** The orchestrator owns the pipeline and derives intents by diffing the proposal's target state against current positions — withdrawals first, then deposits. The LLM proposer and the Privy/Arc executor sit behind ports, so everything here is buildable and testable before those credentials exist.

**Tech Stack:** Hono (HTTP), TypeScript 5 strict, Vitest.

**Spec:** `specs/2026-09-09-idle-capital-design.md` §6, §7
**Decision:** D-011 (this plan) — allocations are the target end state, not a delta.

## Global Constraints

- Inherits every Plan 1 constraint.
- **`allocations` is the TARGET state per venue**, not an increment. `TreasuryState.totalUsdc` is the whole treasury, liquid plus parked.
- **Withdrawals are sequenced before deposits.** You cannot deploy capital you have not freed yet.
- **The orchestrator never bypasses the kernel.** Every money-moving intent derives from a proposal the kernel approved or a human approved after escalation.
- **Ports, not implementations.** `ProposerPort` and `TreasuryPort` are declared here; the LLM and Privy adapters implement them later without changing anything above.

---

### Task 1: Kernel target semantics

**Files:**
- Modify: `packages/core/src/treasury.ts`, `packages/kernel/src/invariants.ts`, `packages/kernel/src/validate.ts`
- Test: `packages/kernel/test/invariants.test.ts`, `packages/kernel/test/validate.test.ts`

**Interfaces:**
- Produces: `TreasuryState.totalUsdc` (replaces `availableUsdc`); `k6RunMovement(p: Proposal, s: TreasuryState, pol: Policy): Breach | null` (gains state)

- [ ] **Step 1: Update the tests**

In `packages/kernel/test/invariants.test.ts` and `validate.test.ts`, rename in the `state()` helper:
```ts
    availableUsdc: 100_000_000n,
```
to:
```ts
    totalUsdc: 100_000_000n,
```

Replace the `describe("k2Conservation", ...)` block:
```ts
describe("k2Conservation", () => {
  it("passes when hold plus targets equals the whole treasury", () => {
    const p: Proposal = {
      hold: 40_000_000n,
      allocations: [{ marketId: "m1", amountUsdc: 60_000_000n }],
      rationale: "x",
    };
    expect(k2Conservation(p, state())).toBeNull();
  });

  it("counts capital already parked, because targets are absolute", () => {
    // 30m already in m1; target 60m there and hold 40m still totals 100m
    const s = state({ positions: [{ marketId: "m1", amountUsdc: 30_000_000n }] });
    const p: Proposal = {
      hold: 40_000_000n,
      allocations: [{ marketId: "m1", amountUsdc: 60_000_000n }],
      rationale: "x",
    };
    expect(k2Conservation(p, s)).toBeNull();
  });

  it("rejects a proposal that conjures USDC from nowhere", () => {
    const p: Proposal = {
      hold: 40_000_000n,
      allocations: [{ marketId: "m1", amountUsdc: 61_000_000n }],
      rationale: "x",
    };
    const breach = k2Conservation(p, state());
    expect(breach?.invariant).toBe("K2");
    expect(breach?.observed).toContain("101000000");
  });

  it("rejects a proposal that loses USDC", () => {
    const p: Proposal = { hold: 1n, allocations: [], rationale: "x" };
    expect(k2Conservation(p, state())?.invariant).toBe("K2");
  });
});
```

Replace the K5 test `"counts EXISTING positions, not just this run's allocations"` with:
```ts
  it("reads the target directly, since targets already describe the end state", () => {
    // m1 target 70m of 100m parked = 70%, over the 50% cap
    const p: Proposal = {
      hold: 0n,
      allocations: [
        { marketId: "m1", amountUsdc: 70_000_000n },
        { marketId: "m2", amountUsdc: 30_000_000n },
      ],
      rationale: "x",
    };
    expect(k5Concentration(p, state(), policy())?.invariant).toBe("K5");
  });

  it("is not fooled by capital already parked, because it never adds it twice", () => {
    // Same 50/50 target, but half of m1 is already there. Still 50%, still fine.
    const s = state({ positions: [{ marketId: "m1", amountUsdc: 25_000_000n }] });
    const p: Proposal = {
      hold: 0n,
      allocations: [
        { marketId: "m1", amountUsdc: 50_000_000n },
        { marketId: "m2", amountUsdc: 50_000_000n },
      ],
      rationale: "x",
    };
    expect(k5Concentration(p, s, policy())).toBeNull();
  });
```

Replace the `describe("k6RunMovement", ...)` block:
```ts
describe("k6RunMovement", () => {
  it("measures churn, not the size of the target", () => {
    // Target equals current: nothing moves, however large the position
    const s = state({ positions: [{ marketId: "m1", amountUsdc: 100_000_000n }] });
    const p: Proposal = {
      hold: 0n,
      allocations: [{ marketId: "m1", amountUsdc: 100_000_000n }],
      rationale: "x",
    };
    expect(k6RunMovement(p, s, policy({ maxRunMovementUsdc: 1n }))).toBeNull();
  });

  it("counts a deposit as movement", () => {
    const p: Proposal = { hold: 0n, allocations: [{ marketId: "m1", amountUsdc: 100_000_000n }], rationale: "x" };
    expect(k6RunMovement(p, state(), policy({ maxRunMovementUsdc: 1n }))?.invariant).toBe("K6");
  });

  it("counts a withdrawal as movement too", () => {
    const s = state({ positions: [{ marketId: "m1", amountUsdc: 100_000_000n }] });
    const p: Proposal = { hold: 100_000_000n, allocations: [], rationale: "x" };
    expect(k6RunMovement(p, s, policy({ maxRunMovementUsdc: 1n }))?.invariant).toBe("K6");
  });

  it("passes at exactly the cap", () => {
    const p: Proposal = { hold: 0n, allocations: [{ marketId: "m1", amountUsdc: 100_000_000n }], rationale: "x" };
    expect(k6RunMovement(p, state(), policy({ maxRunMovementUsdc: 100_000_000n }))).toBeNull();
  });
});
```

In `validate.test.ts`, the `"escalates a coherent proposal"` test needs `hold: 40_000_000n` with `m1: 60_000_000n` — already 100m total, so it stands. The `"vetoes rather than escalates"` test uses `policy({ maxRunMovementUsdc: 1n })` — still a K6 breach under churn maths, so it stands.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/kernel`
Expected: FAIL — `totalUsdc` is not a known property

- [ ] **Step 3: Rename the field in `packages/core/src/treasury.ts`**

```ts
export type TreasuryState = {
  /**
   * The WHOLE treasury: liquid plus everything already parked. Allocations
   * are absolute targets, so conservation is checked against the total —
   * not against the liquid slice, which would make a rebalance look like it
   * conjured money.
   */
  totalUsdc: bigint;
  positions: Position[];
  /** The live market set fetched THIS run. K3 checks against it. */
  markets: Market[];
  /** From @idle/obligations, at the policy horizon. */
  bufferRequiredUsdc: bigint;
  /** Injected, never read from the clock — the kernel must be pure. */
  asOf: Date;
};
```

- [ ] **Step 4: Update K2, K5, K6 in `packages/kernel/src/invariants.ts`**

Replace `k2Conservation`:
```ts
/**
 * K2 — conservation. VETO.
 *
 * Every unit of the treasury is either held liquid or targeted at a venue.
 * Checked against the WHOLE treasury because allocations are absolute
 * targets: a rebalance that moves nothing still has to account for
 * everything.
 */
export function k2Conservation(p: Proposal, s: TreasuryState): Breach | null {
  const targeted = p.allocations.reduce((sum, a) => sum + a.amountUsdc, 0n);
  const total = p.hold + targeted;
  if (total !== s.totalUsdc) {
    return breach(
      "K2",
      "hold plus targets does not equal the treasury total",
      `${total} (hold ${p.hold} + targeted ${targeted})`,
      s.totalUsdc.toString(),
    );
  }
  return null;
}
```

Replace the body of `k5Concentration` (keep the doc comment, change the maths):
```ts
/**
 * K5 — venue concentration. ESCALATE.
 *
 * Reads the targets directly. They already describe the end state, so there
 * is nothing to add — and the split-across-runs evasion that an incremental
 * shape would allow is impossible here by construction rather than by check.
 */
export function k5Concentration(p: Proposal, _s: TreasuryState, pol: Policy): Breach | null {
  let totalParked = 0n;
  for (const a of p.allocations) totalParked += a.amountUsdc;
  if (totalParked === 0n) return null;

  const cap = applyBpsCeil(totalParked, pol.maxVenueConcentrationBps);
  for (const a of p.allocations) {
    if (a.amountUsdc > cap) {
      return breach(
        "K5",
        `market ${a.marketId} would hold more than the permitted share of parked capital`,
        `${a.marketId} at ${a.amountUsdc} of ${totalParked}`,
        `${cap} (${pol.maxVenueConcentrationBps}bps)`,
      );
    }
  }
  return null;
}
```

Replace `k6RunMovement`:
```ts
/**
 * K6 — per-run movement ceiling. ESCALATE.
 *
 * Measures CHURN — the sum of absolute differences between target and
 * current — not the size of the targets. Under target semantics a proposal
 * that changes nothing still names the full position, and charging that
 * against the movement cap would block every no-op rebalance.
 *
 * Bounds the blast radius of any single bad decision, whoever made it.
 */
export function k6RunMovement(p: Proposal, s: TreasuryState, pol: Policy): Breach | null {
  const current = new Map<string, bigint>();
  for (const pos of s.positions) {
    current.set(pos.marketId, (current.get(pos.marketId) ?? 0n) + pos.amountUsdc);
  }
  let moved = 0n;
  const seen = new Set<string>();
  for (const a of p.allocations) {
    seen.add(a.marketId);
    const now = current.get(a.marketId) ?? 0n;
    moved += a.amountUsdc > now ? a.amountUsdc - now : now - a.amountUsdc;
  }
  // Venues the proposal drops entirely are full withdrawals.
  for (const [marketId, amount] of current) {
    if (!seen.has(marketId)) moved += amount;
  }

  if (moved > pol.maxRunMovementUsdc) {
    return breach("K6", "this run moves more than the per-run ceiling",
                  moved.toString(), pol.maxRunMovementUsdc.toString());
  }
  return null;
}
```

- [ ] **Step 5: Update the call site in `validate.ts`**

```ts
      k6RunMovement(p, state, policy),
```

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run packages/kernel && pnpm typecheck`
Expected: PASS — 44 kernel tests, typecheck clean

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Make allocations the target end state, not a delta

The incremental shape could not express a withdrawal: K2 balanced against
the liquid slice only, K5 added targets on top of existing positions, and K8
rejects non-positive amounts. The agent could deploy surplus and never pull
it back — which is half the product, since obligations come due.

Targets fix it. The kernel validates the state the treasury will be in; the
orchestrator derives the moves. K6 now measures churn rather than target
size, or every no-op rebalance would breach the movement cap.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Ledger — nullable proposal so a pre-proposal failure is still recorded

**Files:**
- Modify: `packages/ledger/src/runs.ts`
- Test: `packages/ledger/test/runs.test.ts`

**Interfaces:**
- Produces: `createRun(l, id, proposal: Proposal | null)`, `attachProposal(l: Ledger, id: string, proposal: Proposal): Run`

**Why:** If the Graph quorum fails there is no proposal yet, but the attempt still deserves a record. Creating the run first and attaching the proposal once it exists keeps the audit trail complete.

- [ ] **Step 1: Add the failing tests**

Append to `packages/ledger/test/runs.test.ts`:
```ts
describe("runs without a proposal yet", () => {
  it("can start a run before a proposal exists", () => {
    const r = createRun(l, "r1", null);
    expect(r.status).toBe("PROPOSED");
    expect(r.proposal).toBeNull();
  });

  it("can fail a run that never got a proposal, keeping the audit trail", () => {
    createRun(l, "r1", null);
    expect(transitionRun(l, "r1", "FAILED").status).toBe("FAILED");
  });

  it("attaches a proposal once it exists", () => {
    createRun(l, "r1", null);
    attachProposal(l, "r1", PROPOSAL);
    expect(getRun(l, "r1")?.proposal?.hold).toBe(40_000_000n);
  });

  it("refuses to attach a proposal outside PROPOSED", () => {
    createRun(l, "r1", PROPOSAL);
    transitionRun(l, "r1", "VALIDATED");
    expect(() => attachProposal(l, "r1", PROPOSAL)).toThrow(/PROPOSED/);
  });
});
```

Add `attachProposal` to the import list at the top of that file.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/ledger/test/runs.test.ts`
Expected: FAIL — `attachProposal` is not exported

- [ ] **Step 3: Implement**

In `packages/ledger/src/runs.ts`, change the signature and add the function:
```ts
export function createRun(l: Ledger, id: string, proposal: Proposal | null): Run {
  const now = new Date().toISOString();
  l.raw.prepare(
    "INSERT INTO runs (id,status,proposal,verdict,created_at,updated_at) VALUES (?,?,?,?,?,?)",
  ).run(id, "PROPOSED", proposal === null ? null : toJson(proposal), null, now, now);
  return getRun(l, id)!;
}

/**
 * Attach the proposal once the agent has produced one.
 *
 * A run is created before the proposal exists so that a failure earlier in
 * the pipeline — a Graph quorum miss, say — still leaves a record. Only legal
 * while the run is still PROPOSED; a validated run's proposal is what was
 * validated, and must not move under it.
 */
export function attachProposal(l: Ledger, id: string, proposal: Proposal): Run {
  const current = getRun(l, id);
  if (current === null) throw new Error(`Run ${id} not found`);
  if (current.status !== "PROPOSED") {
    throw new Error(`Run ${id}: cannot attach a proposal in ${current.status}; only PROPOSED`);
  }
  l.raw.prepare("UPDATE runs SET proposal=?, updated_at=? WHERE id=?")
    .run(toJson(proposal), new Date().toISOString(), id);
  return getRun(l, id)!;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/ledger`
Expected: PASS — 49 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Allow a run to exist before its proposal does

If the Graph quorum fails there is no proposal, but the attempt still
deserves a record. Creating the run first and attaching the proposal once it
exists keeps the audit trail complete instead of losing failed runs entirely.

Attaching is legal only in PROPOSED — a validated run's proposal is what was
validated, and must not move under it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Ports, config, and intent derivation

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`
- Create: `apps/api/src/ports.ts`, `apps/api/src/config.ts`, `apps/api/src/derive.ts`, `apps/api/src/index.ts`
- Test: `apps/api/test/derive.test.ts`

**Interfaces:**
- Produces: `interface ProposerPort { propose(ctx: ProposalContext): Promise<Proposal> }`, `interface TreasuryPort { snapshot(): Promise<{ totalUsdc: bigint; positions: Position[] }> }`, `interface MarketsPort { fetch(): Promise<Market[]> }`, `type ProposalContext`, `deriveIntents(proposal: Proposal, positions: Position[]): IntentSpec[]`, `loadPolicy(env: NodeJS.ProcessEnv): Policy`

- [ ] **Step 1: Create the package shell**

`apps/api/package.json`:
```json
{
  "name": "@idle/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "dev": "node --experimental-strip-types src/server.ts" },
  "dependencies": {
    "@idle/core": "workspace:*",
    "@idle/kernel": "workspace:*",
    "@idle/ledger": "workspace:*",
    "@idle/obligations": "workspace:*",
    "@idle/yields": "workspace:*",
    "hono": "^4.6.0",
    "@hono/node-server": "^1.13.0"
  }
}
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

- [ ] **Step 2: Write the failing test**

`apps/api/test/derive.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Position, Proposal } from "@idle/core";
import { deriveIntents } from "../src/index.js";

function prop(allocations: Proposal["allocations"], hold = 0n): Proposal {
  return { hold, allocations, rationale: "x" };
}

describe("deriveIntents", () => {
  it("deposits into a venue with no current position", () => {
    const out = deriveIntents(prop([{ marketId: "m1", amountUsdc: 10n }]), []);
    expect(out).toEqual([{ kind: "earn_deposit", amountUsdc: 10n, marketId: "m1" }]);
  });

  it("withdraws from a venue the target drops entirely", () => {
    const positions: Position[] = [{ marketId: "m1", amountUsdc: 10n }];
    const out = deriveIntents(prop([]), positions);
    expect(out).toEqual([{ kind: "earn_withdraw", amountUsdc: 10n, marketId: "m1" }]);
  });

  it("emits nothing when the target already matches", () => {
    const positions: Position[] = [{ marketId: "m1", amountUsdc: 10n }];
    expect(deriveIntents(prop([{ marketId: "m1", amountUsdc: 10n }]), positions)).toEqual([]);
  });

  it("emits only the difference, not the whole target", () => {
    const positions: Position[] = [{ marketId: "m1", amountUsdc: 4n }];
    const out = deriveIntents(prop([{ marketId: "m1", amountUsdc: 10n }]), positions);
    expect(out).toEqual([{ kind: "earn_deposit", amountUsdc: 6n, marketId: "m1" }]);
  });

  it("SEQUENCES WITHDRAWALS FIRST — you cannot deploy capital you have not freed", () => {
    const positions: Position[] = [{ marketId: "m1", amountUsdc: 10n }];
    const out = deriveIntents(prop([{ marketId: "m2", amountUsdc: 10n }]), positions);
    expect(out.map((i) => i.kind)).toEqual(["earn_withdraw", "earn_deposit"]);
    expect(out[0]?.marketId).toBe("m1");
    expect(out[1]?.marketId).toBe("m2");
  });

  it("handles a partial rebalance across three venues", () => {
    const positions: Position[] = [
      { marketId: "m1", amountUsdc: 100n },
      { marketId: "m2", amountUsdc: 50n },
    ];
    const out = deriveIntents(prop([
      { marketId: "m1", amountUsdc: 40n },
      { marketId: "m2", amountUsdc: 50n },
      { marketId: "m3", amountUsdc: 60n },
    ]), positions);
    expect(out).toEqual([
      { kind: "earn_withdraw", amountUsdc: 60n, marketId: "m1" },
      { kind: "earn_deposit", amountUsdc: 60n, marketId: "m3" },
    ]);
  });

  it("is deterministic, so a retry derives the identical sequence", () => {
    const positions: Position[] = [{ marketId: "m1", amountUsdc: 10n }];
    const p = prop([{ marketId: "m2", amountUsdc: 10n }]);
    expect(deriveIntents(p, positions)).toEqual(deriveIntents(p, positions));
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run apps/api`
Expected: FAIL — cannot resolve `../src/index.js`

- [ ] **Step 4: Write `apps/api/src/ports.ts`**

```ts
import type { Market, Obligation, Policy, Position, Proposal } from "@idle/core";

/** Everything the proposer is given to reason over. */
export type ProposalContext = {
  markets: Market[];
  positions: Position[];
  totalUsdc: bigint;
  bufferRequiredUsdc: bigint;
  scheduleByCurrency: Record<string, bigint>;
  obligations: Obligation[];
  policy: Policy;
  asOf: Date;
};

/**
 * The agent seam. An LLM implements this; so could a deterministic optimiser.
 * The kernel does not care and does not trust either.
 */
export interface ProposerPort {
  propose(ctx: ProposalContext): Promise<Proposal>;
}

/** Where the treasury's current shape comes from. Privy implements this. */
export interface TreasuryPort {
  snapshot(): Promise<{ totalUsdc: bigint; positions: Position[] }>;
}

/** The live market set. @idle/yields implements this. */
export interface MarketsPort {
  fetch(): Promise<Market[]>;
}
```

- [ ] **Step 5: Write `apps/api/src/derive.ts`**

```ts
import type { Position, Proposal } from "@idle/core";
import type { IntentSpec } from "@idle/ledger";

/**
 * Turn an approved target state into the ordered moves that reach it.
 *
 * Withdrawals are emitted before deposits, always. Capital has to be freed
 * before it can be deployed, and a deposit that runs ahead of its funding
 * withdrawal fails at the venue rather than in our code, where it is much
 * harder to reason about.
 *
 * Deterministic: the same proposal and positions always derive the same
 * sequence. That is what makes the ledger's idempotency keys stable across a
 * crash — a retry must recompute exactly the same intents in exactly the
 * same order, or the keys stop lining up.
 */
export function deriveIntents(proposal: Proposal, positions: Position[]): IntentSpec[] {
  const current = new Map<string, bigint>();
  for (const p of positions) {
    current.set(p.marketId, (current.get(p.marketId) ?? 0n) + p.amountUsdc);
  }
  const target = new Map<string, bigint>();
  for (const a of proposal.allocations) {
    target.set(a.marketId, (target.get(a.marketId) ?? 0n) + a.amountUsdc);
  }

  const marketIds = [...new Set([...current.keys(), ...target.keys()])].sort();

  const withdrawals: IntentSpec[] = [];
  const deposits: IntentSpec[] = [];
  for (const marketId of marketIds) {
    const now = current.get(marketId) ?? 0n;
    const want = target.get(marketId) ?? 0n;
    if (want > now) {
      deposits.push({ kind: "earn_deposit", amountUsdc: want - now, marketId });
    } else if (want < now) {
      withdrawals.push({ kind: "earn_withdraw", amountUsdc: now - want, marketId });
    }
  }
  return [...withdrawals, ...deposits];
}
```

- [ ] **Step 6: Write `apps/api/src/config.ts`**

```ts
import type { Policy } from "@idle/core";

function int(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${key} must be an integer, got ${raw}`);
  return n;
}

/**
 * The operator's policy. Trusted configuration, unlike an agent proposal —
 * written by a human and reviewed, not generated.
 *
 * The allowlist default is the blue-chip set: audited, deeply liquid, and
 * defensible to anyone asking why these three. Every other protocol in the
 * registry still appears in the comparison the agent reasons over; they just
 * cannot receive funds.
 */
export function loadPolicy(env: NodeJS.ProcessEnv = process.env): Policy {
  const allowlist = (env.PROTOCOL_ALLOWLIST ?? "aave-v3,compound-v3,spark-lend")
    .split(",").map((s) => s.trim()).filter((s) => s.length > 0);

  return {
    bufferHorizonDays: int(env, "BUFFER_HORIZON_DAYS", 30),
    bufferMultiplierBps: int(env, "BUFFER_MULTIPLIER_BPS", 11_500),
    protocolAllowlist: allowlist,
    maxVenueConcentrationBps: int(env, "MAX_VENUE_CONCENTRATION_BPS", 5_000),
    maxRunMovementUsdc: BigInt(env.MAX_RUN_MOVEMENT_USDC ?? "500000000000"),
    minVenueLiquidityUsd: int(env, "MIN_VENUE_LIQUIDITY_USD", 1_000_000),
  };
}
```

`apps/api/src/index.ts`:
```ts
export * from "./ports.js";
export * from "./derive.js";
export * from "./config.js";
```

- [ ] **Step 7: Run tests**

Run: `pnpm install && pnpm vitest run apps/api`
Expected: PASS — 7 tests

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Add ports, policy config and intent derivation

deriveIntents turns an approved target state into ordered moves, withdrawals
always before deposits — capital has to be freed before it can be deployed.

It is deterministic on purpose: a retry after a crash must recompute exactly
the same intents in the same order, or the ledger's idempotency keys stop
lining up and the double-spend guarantee evaporates.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The orchestrator

**Files:**
- Create: `apps/api/src/orchestrator.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/test/orchestrator.test.ts`

**Interfaces:**
- Produces: `type OrchestratorDeps`, `startRun(deps: OrchestratorDeps, runId: string): Promise<Run>`, `approveRun(deps: OrchestratorDeps, runId: string): Promise<Run>`, `rejectRun(l: Ledger, runId: string): Run`

- [ ] **Step 1: Write the failing test**

`apps/api/test/orchestrator.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Market, Obligation, Proposal } from "@idle/core";
import { getRun, listIntents, openLedger, type ExecutionPort, type Ledger } from "@idle/ledger";
import { approveRun, loadPolicy, rejectRun, startRun, type OrchestratorDeps } from "../src/index.js";

const ASOF = new Date("2026-09-09T00:00:00Z");

function market(id: string, over: Partial<Market> = {}): Market {
  return {
    id, protocol: "aave-v3", chain: "ethereum",
    asset: { symbol: "USDC", decimals: 6, address: "0xusdc" },
    supplyApy: 0.04, totalSuppliedUsd: 1e8, totalBorrowedUsd: 4e7,
    liquidityUsd: 6e7, ...over,
  };
}

const OBLIGATIONS: Obligation[] = [
  { id: "o1", currency: "NGN", amountMinor: 1_600_000n, dueDate: "2026-09-20",
    category: "payroll", confidence: 1 },
];

function deps(over: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  const l = over.ledger ?? openLedger(":memory:");
  const proposal: Proposal = {
    hold: 90_000_000n,
    allocations: [{ marketId: "m1", amountUsdc: 10_000_000n }],
    rationale: "NGN payroll on the 20th; park the surplus in Aave.",
  };
  return {
    ledger: l,
    markets: { fetch: vi.fn(async () => [market("m1"), market("m2")]) },
    treasury: { snapshot: vi.fn(async () => ({ totalUsdc: 100_000_000n, positions: [] })) },
    proposer: { propose: vi.fn(async () => proposal) },
    execution: { submit: vi.fn(async () => "0xtx"), checkStatus: vi.fn(async () => "confirmed" as const) },
    policy: loadPolicy({}),
    obligations: OBLIGATIONS,
    now: () => ASOF,
    ...over,
  };
}

let d: OrchestratorDeps;
beforeEach(() => { d = deps(); });

describe("startRun", () => {
  it("runs the pipeline through to SETTLED when everything is in order", async () => {
    const run = await startRun(d, "r1");
    expect(run.status).toBe("SETTLED");
    expect(listIntents(d.ledger, "r1")[0]?.kind).toBe("earn_deposit");
  });

  it("stores the agent's rationale for a human to read", async () => {
    await startRun(d, "r1");
    expect(getRun(d.ledger, "r1")?.proposal?.rationale).toContain("payroll");
  });

  it("fails the run — and still records it — when the Graph quorum misses", async () => {
    const broken = deps({ markets: { fetch: vi.fn(async () => { throw new Error("quorum not met"); }) } });
    const run = await startRun(broken, "r1");
    expect(run.status).toBe("FAILED");
    expect(getRun(broken.ledger, "r1")).not.toBeNull();
  });

  it("never asks the proposer anything when the market fetch failed", async () => {
    const proposer = { propose: vi.fn() };
    const broken = deps({
      markets: { fetch: vi.fn(async () => { throw new Error("down"); }) },
      proposer: proposer as never,
    });
    await startRun(broken, "r1");
    expect(proposer.propose).not.toHaveBeenCalled();
  });

  it("VETOES a proposal that breaks conservation, and moves no money", async () => {
    const bad: Proposal = { hold: 1n, allocations: [], rationale: "nonsense" };
    const d2 = deps({ proposer: { propose: vi.fn(async () => bad) } });
    const run = await startRun(d2, "r1");
    expect(run.status).toBe("FAILED");
    expect(run.verdict?.kind).toBe("vetoed");
    expect(d2.execution.submit).not.toHaveBeenCalled();
  });

  it("ESCALATES a concentrated proposal instead of executing it", async () => {
    const concentrated: Proposal = {
      hold: 0n,
      allocations: [
        { marketId: "m1", amountUsdc: 90_000_000n },
        { marketId: "m2", amountUsdc: 10_000_000n },
      ],
      rationale: "all in on m1",
    };
    const d2 = deps({ proposer: { propose: vi.fn(async () => concentrated) } });
    const run = await startRun(d2, "r1");
    expect(run.status).toBe("AWAITING_APPROVAL");
    expect(run.verdict?.kind).toBe("escalated");
    expect(d2.execution.submit).not.toHaveBeenCalled();
  });

  it("refuses a market the agent invented, without asking a human", async () => {
    const ghost: Proposal = {
      hold: 0n, allocations: [{ marketId: "does-not-exist", amountUsdc: 100_000_000n }],
      rationale: "hallucinated",
    };
    const d2 = deps({ proposer: { propose: vi.fn(async () => ghost) } });
    const run = await startRun(d2, "r1");
    expect(run.status).toBe("FAILED");
    expect(run.verdict?.kind).toBe("vetoed");
  });

  it("refuses a protocol outside the allowlist even when the market is real", async () => {
    const d2 = deps({
      markets: { fetch: vi.fn(async () => [market("m1", { protocol: "rari-fuse", supplyApy: 1.74 })]) },
      proposer: { propose: vi.fn(async () => ({
        hold: 0n, allocations: [{ marketId: "m1", amountUsdc: 100_000_000n }],
        rationale: "174% APY, too good to pass up",
      })) },
    });
    const run = await startRun(d2, "r1");
    expect(run.status).toBe("FAILED");
    expect(run.verdict?.kind).toBe("vetoed");
    if (run.verdict?.kind === "vetoed") {
      expect(run.verdict.breaches.map((b) => b.invariant)).toContain("K4");
    }
  });

  it("emits no intents when the target already matches the current position", async () => {
    const d2 = deps({
      treasury: { snapshot: vi.fn(async () => ({
        totalUsdc: 100_000_000n,
        positions: [{ marketId: "m1", amountUsdc: 10_000_000n }],
      })) },
    });
    const run = await startRun(d2, "r1");
    expect(listIntents(d2.ledger, "r1")).toHaveLength(0);
    expect(run.status).toBe("SETTLED");
  });
});

describe("approveRun / rejectRun", () => {
  async function escalated(): Promise<OrchestratorDeps> {
    const d2 = deps({ proposer: { propose: vi.fn(async () => ({
      hold: 0n,
      allocations: [
        { marketId: "m1", amountUsdc: 90_000_000n },
        { marketId: "m2", amountUsdc: 10_000_000n },
      ],
      rationale: "concentrated",
    })) } });
    await startRun(d2, "r1");
    return d2;
  }

  it("executes an escalated run once a human approves it", async () => {
    const d2 = await escalated();
    const run = await approveRun(d2, "r1");
    expect(run.status).toBe("SETTLED");
    expect(d2.execution.submit).toHaveBeenCalled();
  });

  it("moves no money when a human rejects", async () => {
    const d2 = await escalated();
    const run = rejectRun(d2.ledger, "r1");
    expect(run.status).toBe("REJECTED");
    expect(d2.execution.submit).not.toHaveBeenCalled();
  });

  it("refuses to approve a run that is not awaiting approval", async () => {
    await startRun(d, "r1");
    await expect(approveRun(d, "r1")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run apps/api/test/orchestrator.test.ts`
Expected: FAIL — `startRun` is not exported

- [ ] **Step 3: Write `apps/api/src/orchestrator.ts`**

```ts
import type { Obligation, Policy } from "@idle/core";
import { validate } from "@idle/kernel";
import { bufferRequirementUsdc, scheduleByCurrency } from "@idle/obligations";
import {
  attachProposal, createRun, getRun, listIntents, markFailed, markSubmitted,
  materialiseIntents, transitionRun,
  type ExecutionPort, type Ledger, type Run,
} from "@idle/ledger";
import { deriveIntents } from "./derive.js";
import type { MarketsPort, ProposerPort, TreasuryPort } from "./ports.js";

export type OrchestratorDeps = {
  ledger: Ledger;
  markets: MarketsPort;
  treasury: TreasuryPort;
  proposer: ProposerPort;
  execution: ExecutionPort;
  policy: Policy;
  obligations: Obligation[];
  now: () => Date;
};

/**
 * One run, start to finish. Spec §7.
 *
 * The order is load-bearing. Market data is fetched before anything else so a
 * Graph failure costs nothing and asks the agent nothing. The kernel sits
 * between the proposal and any intent, so no money-moving record can exist
 * that the kernel did not approve — a vetoed run creates zero intents rather
 * than intents nobody executes.
 */
export async function startRun(deps: OrchestratorDeps, runId: string): Promise<Run> {
  const { ledger, policy, obligations } = deps;
  const asOf = deps.now();

  // Created before the proposal exists so a failure here is still recorded.
  createRun(ledger, runId, null);

  let markets;
  let snapshot;
  try {
    [markets, snapshot] = await Promise.all([deps.markets.fetch(), deps.treasury.snapshot()]);
  } catch {
    return transitionRun(ledger, runId, "FAILED");
  }

  const bufferRequiredUsdc = bufferRequirementUsdc(obligations, policy.bufferHorizonDays, asOf);
  const state = {
    totalUsdc: snapshot.totalUsdc,
    positions: snapshot.positions,
    markets,
    bufferRequiredUsdc,
    asOf,
  };

  let proposal;
  try {
    proposal = await deps.proposer.propose({
      markets,
      positions: snapshot.positions,
      totalUsdc: snapshot.totalUsdc,
      bufferRequiredUsdc,
      scheduleByCurrency: scheduleByCurrency(obligations, policy.bufferHorizonDays, asOf),
      obligations,
      policy,
      asOf,
    });
  } catch {
    return transitionRun(ledger, runId, "FAILED");
  }
  attachProposal(ledger, runId, proposal);

  const verdict = validate(proposal, state, policy);
  if (verdict.kind === "vetoed") {
    return transitionRun(ledger, runId, "FAILED", { verdict });
  }
  if (verdict.kind === "escalated") {
    return transitionRun(ledger, runId, "AWAITING_APPROVAL", { verdict });
  }

  transitionRun(ledger, runId, "VALIDATED", { verdict });
  return execute(deps, runId);
}

/** Approve an escalated run. The human is the second gate, never the first. */
export async function approveRun(deps: OrchestratorDeps, runId: string): Promise<Run> {
  const run = getRun(deps.ledger, runId);
  if (run === null) throw new Error(`Run ${runId} not found`);
  if (run.status !== "AWAITING_APPROVAL") {
    throw new Error(`Run ${runId}: cannot approve from ${run.status}`);
  }
  return execute(deps, runId);
}

export function rejectRun(ledger: Ledger, runId: string): Run {
  return transitionRun(ledger, runId, "REJECTED");
}

/**
 * Materialise and submit the intents for an approved run.
 *
 * Intents are derived from the stored proposal, not from anything held in
 * memory, so this path is identical whether it runs straight after validation
 * or hours later when a human clicks approve.
 */
async function execute(deps: OrchestratorDeps, runId: string): Promise<Run> {
  const { ledger } = deps;
  const run = getRun(ledger, runId);
  if (run === null || run.proposal === null) throw new Error(`Run ${runId} has no proposal`);

  const snapshot = await deps.treasury.snapshot();
  const specs = deriveIntents(run.proposal, snapshot.positions);

  transitionRun(ledger, runId, "EXECUTING");
  materialiseIntents(ledger, runId, specs);

  for (const intent of listIntents(ledger, runId)) {
    if (intent.status !== "pending") continue; // already in flight from an earlier attempt
    try {
      const txRef = await deps.execution.submit(intent);
      markSubmitted(ledger, intent.id, txRef);
    } catch (e) {
      markFailed(ledger, intent.id, e instanceof Error ? e.message : String(e));
      return transitionRun(ledger, runId, "FAILED");
    }
  }

  // Confirm what we just submitted. Anything still pending is picked up by the
  // startup reconciliation sweep instead.
  for (const intent of listIntents(ledger, runId)) {
    if (intent.status !== "submitted" || intent.txRef === null) continue;
    try {
      const status = await deps.execution.checkStatus(intent.txRef);
      if (status === "confirmed") {
        const { markConfirmed } = await import("@idle/ledger");
        markConfirmed(ledger, intent.id);
      } else if (status === "failed") {
        markFailed(ledger, intent.id, "transaction failed");
      }
    } catch { /* leave in flight for reconcile() */ }
  }

  const finalIntents = listIntents(ledger, runId);
  if (finalIntents.some((i) => i.status === "failed")) {
    return transitionRun(ledger, runId, "FAILED");
  }
  if (finalIntents.every((i) => i.status === "confirmed")) {
    return transitionRun(ledger, runId, "SETTLED");
  }
  return getRun(ledger, runId)!;
}
```

Append to `apps/api/src/index.ts`:
```ts
export * from "./orchestrator.js";
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run apps/api && pnpm typecheck`
Expected: PASS — 19 tests, typecheck clean

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add the orchestrator: yields to kernel to ledger

The order is load-bearing. Market data is fetched first so a Graph failure
costs nothing and asks the agent nothing. The kernel sits between the
proposal and any intent, so no money-moving record can exist that the kernel
did not approve — a vetoed run creates zero intents rather than intents
nobody executes.

Intents are derived from the STORED proposal, so approval hours later takes
exactly the same path as immediate execution.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: HTTP surface

**Files:**
- Create: `apps/api/src/server.ts`, `apps/api/src/app.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/test/app.test.ts`

**Interfaces:**
- Produces: `createApp(deps: OrchestratorDeps): Hono`, and a `server.ts` entrypoint

- [ ] **Step 1: Write the failing test**

`apps/api/test/app.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Market, Proposal } from "@idle/core";
import { openLedger } from "@idle/ledger";
import { createApp, loadPolicy, type OrchestratorDeps } from "../src/index.js";

function market(id: string): Market {
  return {
    id, protocol: "aave-v3", chain: "ethereum",
    asset: { symbol: "USDC", decimals: 6, address: "0xusdc" },
    supplyApy: 0.04, totalSuppliedUsd: 1e8, totalBorrowedUsd: 4e7, liquidityUsd: 6e7,
  };
}

function deps(proposal?: Proposal): OrchestratorDeps {
  return {
    ledger: openLedger(":memory:"),
    markets: { fetch: vi.fn(async () => [market("m1"), market("m2")]) },
    treasury: { snapshot: vi.fn(async () => ({ totalUsdc: 100_000_000n, positions: [] })) },
    proposer: { propose: vi.fn(async () => proposal ?? {
      hold: 90_000_000n,
      allocations: [{ marketId: "m1", amountUsdc: 10_000_000n }],
      rationale: "park the surplus",
    }) },
    execution: { submit: vi.fn(async () => "0xtx"), checkStatus: vi.fn(async () => "confirmed" as const) },
    policy: loadPolicy({}),
    obligations: [],
    now: () => new Date("2026-09-09T00:00:00Z"),
  };
}

let d: OrchestratorDeps;
let app: ReturnType<typeof createApp>;
beforeEach(() => { d = deps(); app = createApp(d); });

describe("GET /health", () => {
  it("reports ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});

describe("GET /policy", () => {
  it("returns the active policy with bigints as strings", async () => {
    const body = await (await app.request("/policy")).json();
    expect(body.protocolAllowlist).toContain("aave-v3");
    expect(typeof body.maxRunMovementUsdc).toBe("string");
  });
});

describe("GET /markets", () => {
  it("returns the live market set", async () => {
    const body = await (await app.request("/markets")).json();
    expect(body.markets).toHaveLength(2);
  });

  it("reports 503 when the data source is down, rather than serving nothing quietly", async () => {
    const broken = createApp(deps());
    (d.markets.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("quorum"));
    const res = await createApp({ ...d, markets: { fetch: async () => { throw new Error("quorum"); } } })
      .request("/markets");
    expect(res.status).toBe(503);
    expect(broken).toBeDefined();
  });
});

describe("POST /runs", () => {
  it("starts a run and returns it", async () => {
    const res = await app.request("/runs", { method: "POST" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.run.status).toBe("SETTLED");
  });

  it("serialises bigint amounts as strings", async () => {
    const body = await (await app.request("/runs", { method: "POST" })).json();
    expect(typeof body.run.proposal.hold).toBe("string");
  });
});

describe("GET /runs and /runs/:id", () => {
  it("lists runs", async () => {
    await app.request("/runs", { method: "POST" });
    const body = await (await app.request("/runs")).json();
    expect(body.runs).toHaveLength(1);
  });

  it("returns a run with its intents", async () => {
    const created = await (await app.request("/runs", { method: "POST" })).json();
    const body = await (await app.request(`/runs/${created.run.id}`)).json();
    expect(body.run.id).toBe(created.run.id);
    expect(Array.isArray(body.intents)).toBe(true);
  });

  it("404s for a run that does not exist", async () => {
    expect((await app.request("/runs/nope")).status).toBe(404);
  });
});

describe("approval endpoints", () => {
  it("approves an escalated run", async () => {
    const d2 = deps({
      hold: 0n,
      allocations: [
        { marketId: "m1", amountUsdc: 90_000_000n },
        { marketId: "m2", amountUsdc: 10_000_000n },
      ],
      rationale: "concentrated",
    });
    const a2 = createApp(d2);
    const created = await (await a2.request("/runs", { method: "POST" })).json();
    expect(created.run.status).toBe("AWAITING_APPROVAL");

    const res = await a2.request(`/runs/${created.run.id}/approve`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json()).run.status).toBe("SETTLED");
  });

  it("rejects an escalated run without moving money", async () => {
    const d2 = deps({
      hold: 0n,
      allocations: [
        { marketId: "m1", amountUsdc: 90_000_000n },
        { marketId: "m2", amountUsdc: 10_000_000n },
      ],
      rationale: "concentrated",
    });
    const a2 = createApp(d2);
    const created = await (await a2.request("/runs", { method: "POST" })).json();
    const res = await a2.request(`/runs/${created.run.id}/reject`, { method: "POST" });
    expect((await res.json()).run.status).toBe("REJECTED");
    expect(d2.execution.submit).not.toHaveBeenCalled();
  });

  it("409s when approving a run that is not awaiting approval", async () => {
    const created = await (await app.request("/runs", { method: "POST" })).json();
    const res = await app.request(`/runs/${created.run.id}/approve`, { method: "POST" });
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run apps/api/test/app.test.ts`
Expected: FAIL — `createApp` is not exported

- [ ] **Step 3: Write `apps/api/src/app.ts`**

```ts
import { Hono } from "hono";
import { getRun, listIntents, listRuns } from "@idle/ledger";
import { approveRun, rejectRun, startRun, type OrchestratorDeps } from "./orchestrator.js";

/**
 * bigint has no JSON representation. Every amount crosses the wire as a
 * decimal string — the frontend parses it back, and nothing is silently
 * rounded through a double on the way.
 */
function jsonSafe<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v: unknown) =>
    typeof v === "bigint" ? v.toString() : v)) as unknown;
}

export function createApp(deps: OrchestratorDeps): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/policy", (c) => c.json(jsonSafe(deps.policy)));

  app.get("/markets", async (c) => {
    try {
      const markets = await deps.markets.fetch();
      return c.json(jsonSafe({ markets, count: markets.length }));
    } catch (e) {
      // 503, not 200-with-empty. A treasury UI showing "no markets" when the
      // truth is "we could not ask" is worse than an honest error.
      return c.json({ error: e instanceof Error ? e.message : "market data unavailable" }, 503);
    }
  });

  app.post("/runs", async (c) => {
    const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const run = await startRun(deps, runId);
    return c.json(jsonSafe({ run, intents: listIntents(deps.ledger, runId) }), 201);
  });

  app.get("/runs", (c) => c.json(jsonSafe({ runs: listRuns(deps.ledger) })));

  app.get("/runs/:id", (c) => {
    const run = getRun(deps.ledger, c.req.param("id"));
    if (run === null) return c.json({ error: "run not found" }, 404);
    return c.json(jsonSafe({ run, intents: listIntents(deps.ledger, run.id) }));
  });

  app.post("/runs/:id/approve", async (c) => {
    const id = c.req.param("id");
    if (getRun(deps.ledger, id) === null) return c.json({ error: "run not found" }, 404);
    try {
      const run = await approveRun(deps, id);
      return c.json(jsonSafe({ run, intents: listIntents(deps.ledger, id) }));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "cannot approve" }, 409);
    }
  });

  app.post("/runs/:id/reject", (c) => {
    const id = c.req.param("id");
    if (getRun(deps.ledger, id) === null) return c.json({ error: "run not found" }, 404);
    try {
      return c.json(jsonSafe({ run: rejectRun(deps.ledger, id) }));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "cannot reject" }, 409);
    }
  });

  return app;
}
```

- [ ] **Step 4: Write `apps/api/src/server.ts`**

```ts
import { serve } from "@hono/node-server";
import { getLendingMarkets } from "@idle/yields";
import { openLedger, reconcile, type ExecutionPort } from "@idle/ledger";
import { createApp } from "./app.js";
import { loadPolicy } from "./config.js";
import type { OrchestratorDeps, ProposerPort, TreasuryPort } from "./ports.js";

const policy = loadPolicy(process.env);
const ledger = openLedger(process.env.LEDGER_PATH ?? ".idle/ledger.db");

const markets = {
  async fetch() {
    const key = process.env.GRAPH_API_KEY;
    if (key === undefined || key === "") throw new Error("GRAPH_API_KEY is not set");
    const res = await getLendingMarkets({ apiKey: key, assetSymbols: ["USDC", "USDT", "DAI"] });
    return res.markets;
  },
};

// Placeholder adapters. Replaced by the Privy and Anthropic implementations;
// the interfaces do not change when they are.
const treasury: TreasuryPort = {
  async snapshot() {
    throw new Error("TreasuryPort not wired yet — Privy adapter pending");
  },
};
const proposer: ProposerPort = {
  async propose() {
    throw new Error("ProposerPort not wired yet — agent pending");
  },
};
const execution: ExecutionPort = {
  async submit() { throw new Error("ExecutionPort not wired yet — Privy/Arc adapters pending"); },
  async checkStatus() { throw new Error("ExecutionPort not wired yet"); },
};

const deps: OrchestratorDeps = {
  ledger, markets, treasury, proposer, execution, policy,
  obligations: [], now: () => new Date(),
};

// Reconcile anything left in flight BEFORE accepting new work. D-003.
await reconcile(ledger, execution).catch(() => { /* nothing in flight on a cold start */ });

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: createApp(deps).fetch, port });
console.log(`idle-capital api on :${port}`);
```

Append to `apps/api/src/index.ts`:
```ts
export * from "./app.js";
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run apps/api && pnpm typecheck`
Expected: PASS — 30 tests, typecheck clean

- [ ] **Step 6: Update ATTRIBUTION.md and commit**

Append:
```markdown
| `apps/api/**` | `AI` | Ports, orchestrator, HTTP surface; policy defaults are team decisions (D-010) |
```

```bash
git add -A
git commit -m "Add the HTTP surface over the orchestrator

Every amount crosses the wire as a decimal string, because bigint has no JSON
representation and silently rounding money through a double is how accounting
bugs start.

/markets answers 503 when the data source is down rather than 200 with an
empty list — a treasury UI showing 'no markets' when the truth is 'we could
not ask' is worse than an honest error.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Definition of done

- [ ] `pnpm test` passes — 44 kernel, 49 ledger, 30 api, 19 obligations, 11 core, 27 yields (180 total)
- [ ] `pnpm typecheck` clean
- [ ] A vetoed run creates zero intents
- [ ] An escalated run moves no money until approved
- [ ] `deriveIntents` sequences withdrawals before deposits
- [ ] The rari-fuse allowlist refusal is covered by an orchestrator test

## Deferred

`@idle/agent` (needs `ANTHROPIC_API_KEY`), Privy `TreasuryPort` + `ExecutionPort`, Arc settlement, `apps/web`.
