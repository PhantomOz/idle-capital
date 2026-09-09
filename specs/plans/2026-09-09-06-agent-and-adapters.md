# Agent & Execution Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the three ports the system was built around — the LLM proposer, the Privy treasury snapshot, and the Privy-signed Arc executor — and run the whole pipeline end to end against live services.

**Architecture:** `@idle/agent` implements `ProposerPort` via Claude with a forced tool schema. `@idle/wallet` implements `TreasuryPort` and `ExecutionPort` against the Privy server wallet, signing Arc transactions through `/v1/wallets/{id}/rpc` so the Privy policy gates every movement. `@idle/chain` builds and broadcasts those transactions on Arc.

**Tech Stack:** `@anthropic-ai/sdk`, `viem`, TypeScript 5 strict, Vitest.

**Spec:** `specs/2026-09-09-idle-capital-design.md` §4, §7
**Spike:** `specs/spikes/2026-09-09-privy-arc-spike.md` — the verified endpoint shapes and the policy-enforcement result

## Global Constraints

- Inherits every Plan 1 constraint.
- **No private key enters this process.** The Privy wallet signs; `ARC_PRIVATE_KEY` is used only for the one-off funding transfer already performed and is not read at runtime.
- **The agent is untrusted.** Its output is parsed defensively and handed straight to the kernel. Any shape the kernel cannot read is a K8 veto, never a crash.
- **USDC is Arc's native gas token.** A settlement transfer is a native value transfer, not an ERC-20 call. Amounts on the wire are 18-decimal wei; treasury amounts are 6-decimal USDC minor units. The conversion happens in exactly one place.
- **Every live call is injectable.** Tests never hit Anthropic, Privy, or Arc.

---

### Task 1: `@idle/agent` — the LLM proposer

**Files:**
- Create: `packages/agent/package.json`, `packages/agent/tsconfig.json`
- Create: `packages/agent/src/prompt.ts`, `packages/agent/src/proposer.ts`, `packages/agent/src/index.ts`
- Test: `packages/agent/test/prompt.test.ts`, `packages/agent/test/proposer.test.ts`

**Interfaces:**
- Consumes: `@idle/core` types; `ProposalContext` shape from `@idle/api` (duplicated locally to avoid a cycle)
- Produces: `buildPrompt(ctx): string`, `ALLOCATION_TOOL`, `parseProposal(input: unknown): Proposal | null`, `createProposer(opts): ProposerPort`

- [ ] **Step 1: Package shell**

`packages/agent/package.json`:
```json
{
  "name": "@idle/agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@idle/core": "workspace:*",
    "@anthropic-ai/sdk": "^0.32.0"
  }
}
```

`packages/agent/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

- [ ] **Step 2: Write the failing tests**

`packages/agent/test/prompt.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Market, Obligation, Policy, Position } from "@idle/core";
import { buildPrompt, parseProposal } from "../src/index.js";

function market(id: string, over: Partial<Market> = {}): Market {
  return {
    id, protocol: "aave-v3", chain: "ethereum",
    asset: { symbol: "USDC", decimals: 6, address: "0x" },
    supplyApy: 0.04, totalSuppliedUsd: 1e8, totalBorrowedUsd: 4e7, liquidityUsd: 6e7, ...over,
  };
}
const POLICY: Policy = {
  bufferHorizonDays: 30, bufferMultiplierBps: 11_500,
  protocolAllowlist: ["aave-v3", "compound-v3"],
  maxVenueConcentrationBps: 5_000, maxRunMovementUsdc: 500_000_000_000n,
  minVenueLiquidityUsd: 1_000_000,
};
const OBLIGATIONS: Obligation[] = [
  { id: "o1", currency: "TZS", amountMinor: 1_134_000_000n, dueDate: "2026-09-15",
    category: "payroll", confidence: 1 },
];
const POSITIONS: Position[] = [{ marketId: "aave-v3:0xa", amountUsdc: 3_000_000n }];

function ctx(over: Record<string, unknown> = {}) {
  return {
    markets: [market("aave-v3:0xa"), market("rari-fuse:0xr", { protocol: "rari-fuse", supplyApy: 127281.98, liquidityUsd: -4_700_000 })],
    positions: POSITIONS, totalUsdc: 100_000_000n, bufferRequiredUsdc: 4_200_000n,
    scheduleByCurrency: { NGN: 0n, KES: 0n, GHS: 0n, TZS: 4_200_000n },
    obligations: OBLIGATIONS, policy: POLICY, asOf: new Date("2026-09-09T00:00:00Z"),
    ...over,
  };
}

describe("buildPrompt", () => {
  it("states the treasury total the proposal must account for", () => {
    expect(buildPrompt(ctx())).toContain("100000000");
  });

  it("names the buffer the agent may not spend", () => {
    expect(buildPrompt(ctx())).toContain("4200000");
  });

  it("names the allowlisted protocols so a good proposal avoids a veto", () => {
    const p = buildPrompt(ctx());
    expect(p).toContain("aave-v3");
    expect(p).toContain("compound-v3");
  });

  it("shows the market it must NOT choose, so avoiding it is a decision", () => {
    // The trap is in the data on purpose. An agent that never sees rari-fuse
    // has not avoided it.
    expect(buildPrompt(ctx())).toContain("rari-fuse");
  });

  it("gives obligations with their due dates and currencies", () => {
    const p = buildPrompt(ctx());
    expect(p).toContain("TZS");
    expect(p).toContain("2026-09-15");
  });

  it("states the concentration cap as a percentage the agent can act on", () => {
    expect(buildPrompt(ctx())).toContain("50%");
  });

  it("gives current positions so the agent proposes a target, not a delta", () => {
    expect(buildPrompt(ctx())).toContain("3000000");
  });
});

describe("parseProposal", () => {
  it("parses a well-formed tool payload into bigints", () => {
    const p = parseProposal({
      hold: "40000000",
      allocations: [{ marketId: "aave-v3:0xa", amountUsdc: "60000000" }],
      rationale: "payroll first",
    });
    expect(p?.hold).toBe(40_000_000n);
    expect(p?.allocations[0]?.amountUsdc).toBe(60_000_000n);
  });

  it("accepts an empty allocation list — holding everything is a decision", () => {
    const p = parseProposal({ hold: "100000000", allocations: [], rationale: "rates are poor" });
    expect(p?.allocations).toEqual([]);
  });

  it("returns null rather than throwing on a non-numeric amount", () => {
    expect(parseProposal({ hold: "lots", allocations: [], rationale: "x" })).toBeNull();
  });

  it("returns null on a missing rationale, because the rationale is the product", () => {
    expect(parseProposal({ hold: "1", allocations: [] })).toBeNull();
  });

  it("returns null for anything that is not an object", () => {
    for (const bad of [null, undefined, 42, "x", []]) expect(parseProposal(bad)).toBeNull();
  });

  it("returns null on a fractional amount rather than truncating it", () => {
    expect(parseProposal({ hold: "1.5", allocations: [], rationale: "x" })).toBeNull();
  });
});
```

`packages/agent/test/proposer.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import type { Policy } from "@idle/core";
import { createProposer } from "../src/index.js";

const POLICY: Policy = {
  bufferHorizonDays: 30, bufferMultiplierBps: 11_500,
  protocolAllowlist: ["aave-v3"], maxVenueConcentrationBps: 5_000,
  maxRunMovementUsdc: 500_000_000_000n, minVenueLiquidityUsd: 1_000_000,
};
const CTX = {
  markets: [], positions: [], totalUsdc: 100_000_000n, bufferRequiredUsdc: 0n,
  scheduleByCurrency: {}, obligations: [], policy: POLICY,
  asOf: new Date("2026-09-09T00:00:00Z"),
};

function fakeClient(content: unknown[]) {
  return { messages: { create: vi.fn(async () => ({ content })) } };
}

describe("createProposer", () => {
  it("returns the proposal the model submitted through the tool", async () => {
    const client = fakeClient([{ type: "tool_use", name: "submit_allocation",
      input: { hold: "40000000", allocations: [{ marketId: "m1", amountUsdc: "60000000" }],
               rationale: "payroll in six days" } }]);
    const p = await createProposer({ client: client as never, model: "test" }).propose(CTX as never);
    expect(p.hold).toBe(40_000_000n);
    expect(p.rationale).toContain("payroll");
  });

  it("throws when the model answers in prose instead of calling the tool", async () => {
    const client = fakeClient([{ type: "text", text: "I think you should park it all." }]);
    await expect(createProposer({ client: client as never, model: "test" }).propose(CTX as never))
      .rejects.toThrow(/tool/i);
  });

  it("throws when the tool payload cannot be parsed, rather than inventing a proposal", async () => {
    const client = fakeClient([{ type: "tool_use", name: "submit_allocation",
      input: { hold: "not-a-number", allocations: [], rationale: "x" } }]);
    await expect(createProposer({ client: client as never, model: "test" }).propose(CTX as never))
      .rejects.toThrow(/parse|invalid/i);
  });

  it("forces the tool rather than leaving the model the choice", async () => {
    const client = fakeClient([{ type: "tool_use", name: "submit_allocation",
      input: { hold: "100000000", allocations: [], rationale: "hold" } }]);
    await createProposer({ client: client as never, model: "test" }).propose(CTX as never);
    const args = client.messages.create.mock.calls[0]?.[0] as { tool_choice?: { type: string } };
    expect(args.tool_choice?.type).toBe("tool");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run packages/agent`
Expected: FAIL — cannot resolve `../src/index.js`

- [ ] **Step 4: Write `packages/agent/src/prompt.ts`**

```ts
import type { Market, Obligation, Policy, Position } from "@idle/core";

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

/** The tool the model must call. Forcing it removes "answered in prose" as a
 *  failure mode entirely. */
export const ALLOCATION_TOOL = {
  name: "submit_allocation",
  description: "Submit the treasury's target allocation and the reasoning behind it.",
  input_schema: {
    type: "object" as const,
    properties: {
      hold: {
        type: "string",
        description: "USDC minor units to keep liquid. A decimal integer string, no decimal point.",
      },
      allocations: {
        type: "array",
        description: "Target holding per market AFTER this run — absolute, not a change.",
        items: {
          type: "object",
          properties: {
            marketId: { type: "string" },
            amountUsdc: { type: "string", description: "USDC minor units, decimal integer string." },
          },
          required: ["marketId", "amountUsdc"],
        },
      },
      rationale: {
        type: "string",
        description:
          "Two or three sentences a business owner would understand, naming the obligation " +
          "that drove the decision. No jargon, no restating the numbers.",
      },
    },
    required: ["hold", "allocations", "rationale"],
  },
};

function pct(bps: number): string {
  return `${bps / 100}%`;
}

/**
 * The whole decision, stated once.
 *
 * The market list deliberately includes venues the policy forbids. An agent
 * that never sees rari-fuse at 12,000,000% has not avoided it, and the point
 * of the reasoning layer is that it avoids it *knowingly* — with the kernel
 * as the backstop rather than the only defence.
 */
export function buildPrompt(ctx: ProposalContext): string {
  const markets = [...ctx.markets]
    .sort((a, b) => b.supplyApy - a.supplyApy)
    .slice(0, 25)
    .map((m) => {
      const allowed = ctx.policy.protocolAllowlist.includes(m.protocol);
      return `  ${m.id} | ${m.protocol} | ${m.asset.symbol} | apy ${(m.supplyApy * 100).toFixed(2)}% ` +
             `| liquidity $${Math.round(m.liquidityUsd).toLocaleString("en-US")} ` +
             `| ${allowed ? "ALLOWED" : "NOT ALLOWED"}`;
    }).join("\n");

  const positions = ctx.positions.length === 0
    ? "  (nothing parked yet)"
    : ctx.positions.map((p) => `  ${p.marketId} | ${p.amountUsdc} USDC minor`).join("\n");

  const obligations = ctx.obligations.length === 0
    ? "  (none scheduled)"
    : ctx.obligations.map((o) =>
        `  ${o.dueDate} | ${o.currency} ${o.amountMinor} minor | ${o.category} | confidence ${o.confidence}`,
      ).join("\n");

  return `You are the treasury function for a twenty-person business trading across
Nigeria, Kenya, Ghana and Tanzania. You decide how much working capital stays
liquid against obligations that fall due, and where the surplus is parked.

Today is ${ctx.asOf.toISOString().slice(0, 10)}.

TREASURY
  total: ${ctx.totalUsdc} USDC minor units (6 decimals; 1000000 = 1 USDC)
  this is liquid plus everything already parked

CURRENTLY PARKED
${positions}

OBLIGATIONS DUE WITHIN ${ctx.policy.bufferHorizonDays} DAYS
${obligations}
  converted and totalled: ${ctx.bufferRequiredUsdc} USDC minor
  you must hold at least ${ctx.bufferRequiredUsdc} x ${pct(ctx.policy.bufferMultiplierBps)} of that

LENDING MARKETS, best rate first
${markets}

POLICY, enforced whatever you propose
  funds may only enter: ${ctx.policy.protocolAllowlist.join(", ")}
  no venue may hold more than ${pct(ctx.policy.maxVenueConcentrationBps)} of parked capital
  a venue must hold at least $${ctx.policy.minVenueLiquidityUsd.toLocaleString("en-US")} of liquidity
  at most ${ctx.policy.maxRunMovementUsdc} USDC minor may move in one run

Some markets above show extraordinary rates. Those are stale or abandoned
subgraphs still reporting; the liquidity column tells you the truth. Treat a
rate you cannot exit as no rate at all.

Call submit_allocation with the target holding for EACH venue after this run —
absolute amounts, not changes — plus what stays liquid. hold plus every
allocation must sum to exactly ${ctx.totalUsdc}.`;
}
```

- [ ] **Step 5: Write `packages/agent/src/proposer.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { Allocation, Proposal } from "@idle/core";
import { ALLOCATION_TOOL, buildPrompt, type ProposalContext } from "./prompt.js";

/** Strict decimal-integer string to bigint. Rejects "1.5", "1e3", "" and " 1". */
function toMinor(v: unknown): bigint | null {
  if (typeof v !== "string" || !/^-?\d+$/.test(v)) return null;
  try { return BigInt(v); } catch { return null; }
}

/**
 * Parse the model's tool payload.
 *
 * Returns null for anything unusable rather than throwing or repairing. The
 * kernel is the authority on whether a proposal is acceptable; this function's
 * only job is deciding whether it is even a proposal.
 */
export function parseProposal(input: unknown): Proposal | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;

  const hold = toMinor(o.hold);
  if (hold === null) return null;
  if (typeof o.rationale !== "string" || o.rationale.trim().length === 0) return null;
  if (!Array.isArray(o.allocations)) return null;

  const allocations: Allocation[] = [];
  for (const raw of o.allocations) {
    if (typeof raw !== "object" || raw === null) return null;
    const a = raw as Record<string, unknown>;
    if (typeof a.marketId !== "string" || a.marketId.length === 0) return null;
    const amount = toMinor(a.amountUsdc);
    if (amount === null) return null;
    allocations.push({ marketId: a.marketId, amountUsdc: amount });
  }
  return { hold, allocations, rationale: o.rationale };
}

export type ProposerOptions = {
  client?: Anthropic;
  apiKey?: string;
  model?: string;
  maxTokens?: number;
};

/**
 * The reasoning layer.
 *
 * The tool is forced, so "the model replied in prose" is not a failure mode
 * that reaches production. Everything it returns still goes to the kernel,
 * which trusts none of it.
 */
export function createProposer(opts: ProposerOptions = {}) {
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY });
  const model = opts.model ?? process.env.AGENT_MODEL ?? "claude-opus-5";
  const maxTokens = opts.maxTokens ?? 2048;

  return {
    async propose(ctx: ProposalContext): Promise<Proposal> {
      const res = await client.messages.create({
        model,
        max_tokens: maxTokens,
        tools: [ALLOCATION_TOOL],
        tool_choice: { type: "tool", name: ALLOCATION_TOOL.name },
        messages: [{ role: "user", content: buildPrompt(ctx) }],
      });

      const block = (res.content as { type: string; name?: string; input?: unknown }[])
        .find((b) => b.type === "tool_use" && b.name === ALLOCATION_TOOL.name);
      if (block === undefined) {
        throw new Error("Agent did not call the submit_allocation tool");
      }
      const proposal = parseProposal(block.input);
      if (proposal === null) {
        throw new Error(`Agent returned an invalid proposal: ${JSON.stringify(block.input).slice(0, 200)}`);
      }
      return proposal;
    },
  };
}
```

`packages/agent/src/index.ts`:
```ts
export * from "./prompt.js";
export * from "./proposer.js";
```

- [ ] **Step 6: Run tests**

Run: `pnpm install && pnpm vitest run packages/agent && pnpm typecheck`
Expected: PASS — 17 tests

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add the LLM proposer

The tool is forced, so 'the model answered in prose' cannot reach production.
The payload is then parsed defensively — a fractional amount or a missing
rationale returns null rather than being repaired, because the kernel is the
authority on whether a proposal is acceptable and this only decides whether
it is even a proposal.

The prompt deliberately shows markets the policy forbids. An agent that never
sees rari-fuse at 12,000,000% has not avoided it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `@idle/chain` — Arc transactions

**Files:**
- Create: `packages/chain/package.json`, `packages/chain/tsconfig.json`
- Create: `packages/chain/src/arc.ts`, `packages/chain/src/index.ts`
- Test: `packages/chain/test/arc.test.ts`

**Interfaces:**
- Produces: `ARC_TESTNET` chain definition, `usdcMinorToWei(minor: bigint): bigint`, `weiToUsdcMinor(wei: bigint): bigint`, `createArcClient(rpcUrl): ArcClient` with `getBalanceUsdcMinor(address)`, `buildTransfer({to, amountUsdcMinor, from})`, `broadcast(signed)`, `waitForReceipt(hash)`

- [ ] **Step 1: Write the failing test**

`packages/chain/test/arc.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ARC_TESTNET, usdcMinorToWei, weiToUsdcMinor } from "../src/index.js";

describe("ARC_TESTNET", () => {
  it("is chain 5042002", () => {
    expect(ARC_TESTNET.id).toBe(5042002);
  });

  it("declares USDC as the native currency, because on Arc it is", () => {
    expect(ARC_TESTNET.nativeCurrency.symbol).toBe("USDC");
    expect(ARC_TESTNET.nativeCurrency.decimals).toBe(18);
  });
});

describe("usdcMinorToWei", () => {
  it("scales six-decimal treasury units to eighteen-decimal wei", () => {
    expect(usdcMinorToWei(1_000_000n)).toBe(1_000_000_000_000_000_000n);
  });

  it("keeps a single minor unit representable", () => {
    expect(usdcMinorToWei(1n)).toBe(1_000_000_000_000n);
  });

  it("handles zero", () => {
    expect(usdcMinorToWei(0n)).toBe(0n);
  });
});

describe("weiToUsdcMinor", () => {
  it("is the inverse for whole units", () => {
    expect(weiToUsdcMinor(1_000_000_000_000_000_000n)).toBe(1_000_000n);
  });

  it("rounds DOWN, so a reported balance is never overstated", () => {
    expect(weiToUsdcMinor(1_999_999_999_999n)).toBe(1n);
  });

  it("round-trips every whole minor unit", () => {
    for (const n of [0n, 1n, 12_000_000n, 9_007_199_254_740_993n]) {
      expect(weiToUsdcMinor(usdcMinorToWei(n))).toBe(n);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/chain`
Expected: FAIL — cannot resolve `../src/index.js`

- [ ] **Step 3: Write `packages/chain/src/arc.ts`**

```ts
import { createPublicClient, http, type Address, type Hex } from "viem";

/**
 * Arc testnet.
 *
 * USDC is the NATIVE gas token here — a settlement transfer is a value
 * transfer, not an ERC-20 call, and the predeploy at 0x3600... mirrors the
 * same balance. Verified against the live chain; see the Privy/Arc spike.
 */
export const ARC_TESTNET = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [] as string[] } },
} as const;

/** Arc's native unit is 18 decimals; the treasury counts USDC in 6. */
const SCALE = 1_000_000_000_000n; // 10 ** 12

export function usdcMinorToWei(minor: bigint): bigint {
  return minor * SCALE;
}

/** Rounds DOWN. A balance we report must never be larger than the one we hold. */
export function weiToUsdcMinor(wei: bigint): bigint {
  return wei / SCALE;
}

export type ArcClient = {
  getBalanceUsdcMinor(address: Address): Promise<bigint>;
  buildTransfer(args: { from: Address; to: Address; amountUsdcMinor: bigint }): Promise<{
    to: Address; value: Hex; chain_id: number; nonce: number;
    gas_limit: Hex; max_fee_per_gas: Hex; max_priority_fee_per_gas: Hex;
  }>;
  broadcast(signed: Hex): Promise<Hex>;
  waitForReceipt(hash: Hex): Promise<{ status: "success" | "reverted"; blockNumber: bigint }>;
};

export function createArcClient(rpcUrl: string): ArcClient {
  const chain = { ...ARC_TESTNET, rpcUrls: { default: { http: [rpcUrl] } } };
  const pub = createPublicClient({ chain, transport: http(rpcUrl) });

  return {
    async getBalanceUsdcMinor(address) {
      return weiToUsdcMinor(await pub.getBalance({ address }));
    },

    async buildTransfer({ from, to, amountUsdcMinor }) {
      const [nonce, fees] = await Promise.all([
        pub.getTransactionCount({ address: from }),
        pub.estimateFeesPerGas(),
      ]);
      return {
        to,
        value: `0x${usdcMinorToWei(amountUsdcMinor).toString(16)}` as Hex,
        chain_id: ARC_TESTNET.id,
        nonce,
        gas_limit: "0x5208" as Hex, // 21000, a plain value transfer
        max_fee_per_gas: `0x${(fees.maxFeePerGas ?? 1_000_000_000n).toString(16)}` as Hex,
        max_priority_fee_per_gas:
          `0x${(fees.maxPriorityFeePerGas ?? 1_000_000_000n).toString(16)}` as Hex,
      };
    },

    async broadcast(signed) {
      return pub.request({ method: "eth_sendRawTransaction", params: [signed] }) as Promise<Hex>;
    },

    async waitForReceipt(hash) {
      const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
      return { status: r.status, blockNumber: r.blockNumber };
    },
  };
}
```

`packages/chain/src/index.ts`:
```ts
export * from "./arc.js";
```

`packages/chain/package.json`:
```json
{
  "name": "@idle/chain",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@idle/core": "workspace:*", "viem": "^2.21.0" }
}
```

`packages/chain/tsconfig.json`: same shape as the other packages.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm install && pnpm vitest run packages/chain`
Expected: PASS — 9 tests

```bash
git add -A
git commit -m "Add the Arc chain adapter

USDC is Arc's native gas token, so settlement is a value transfer rather than
an ERC-20 call — verified against the live chain before writing this.

The 6-to-18 decimal conversion lives in exactly one place and rounds DOWN on
the way back, because a balance we report must never be larger than the one
we actually hold.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `@idle/wallet` — Privy treasury and executor

**Files:**
- Create: `packages/wallet/package.json`, `packages/wallet/tsconfig.json`
- Create: `packages/wallet/src/privy.ts`, `packages/wallet/src/index.ts`
- Test: `packages/wallet/test/privy.test.ts`

**Interfaces:**
- Produces: `createPrivyClient(opts)` with `signTransaction(tx)`, `getWallet()`, `ensurePolicy(spec)`; `createPrivyTreasury(deps): TreasuryPort`; `createPrivyArcExecutor(deps): ExecutionPort`

- [ ] **Step 1: Write the failing test**

`packages/wallet/test/privy.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { createPrivyArcExecutor, createPrivyClient, createPrivyTreasury } from "../src/index.js";

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  return vi.fn(async (url: string, init: RequestInit) => {
    const { status, body } = handler(String(url), init);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

const OPTS = { appId: "app", appSecret: "secret", walletId: "w1",
               address: "0xAbC0000000000000000000000000000000000001" as const };

describe("createPrivyClient", () => {
  it("authenticates with Basic auth and the app-id header, never a query string", async () => {
    const f = fakeFetch(() => ({ status: 200, body: { method: "eth_signTransaction", data: { signed_transaction: "0xdead" } } }));
    const c = createPrivyClient({ ...OPTS, fetchImpl: f });
    await c.signTransaction({ to: "0x1", value: "0x1", chain_id: 1, nonce: 0,
                              gas_limit: "0x5208", max_fee_per_gas: "0x1", max_priority_fee_per_gas: "0x1" });
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).not.toContain("secret");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^Basic /);
    expect(headers["privy-app-id"]).toBe("app");
  });

  it("returns the signed transaction", async () => {
    const f = fakeFetch(() => ({ status: 200, body: { data: { signed_transaction: "0xsigned" } } }));
    const c = createPrivyClient({ ...OPTS, fetchImpl: f });
    expect(await c.signTransaction({} as never)).toBe("0xsigned");
  });

  it("surfaces a policy denial as a distinct, recognisable failure", async () => {
    const f = fakeFetch(() => ({ status: 400, body: { error: "RPC request denied due to policy violation", code: "policy_violation" } }));
    const c = createPrivyClient({ ...OPTS, fetchImpl: f });
    await expect(c.signTransaction({} as never)).rejects.toThrow(/policy/i);
  });
});

describe("createPrivyTreasury", () => {
  it("reports the on-chain balance plus parked positions as the treasury total", async () => {
    const arc = { getBalanceUsdcMinor: vi.fn(async () => 12_000_000n) };
    const t = createPrivyTreasury({
      arc: arc as never, address: OPTS.address,
      listPositions: async () => [{ marketId: "aave-v3:0xa", amountUsdc: 3_000_000n }],
    });
    const snap = await t.snapshot();
    expect(snap.totalUsdc).toBe(15_000_000n);
    expect(snap.positions).toHaveLength(1);
  });

  it("reports liquid-only when nothing is parked", async () => {
    const arc = { getBalanceUsdcMinor: vi.fn(async () => 12_000_000n) };
    const t = createPrivyTreasury({ arc: arc as never, address: OPTS.address, listPositions: async () => [] });
    expect((await t.snapshot()).totalUsdc).toBe(12_000_000n);
  });
});

describe("createPrivyArcExecutor", () => {
  const intent = { id: "i1", runId: "r1", seq: 0, kind: "settle_usdc" as const,
                   amountUsdc: 1_000_000n, marketId: null, idempotencyKey: "r1:0",
                   status: "pending" as const, txRef: null, error: null };

  it("builds, signs through Privy, and broadcasts", async () => {
    const arc = {
      buildTransfer: vi.fn(async () => ({ to: "0x2", value: "0x1", chain_id: 5042002, nonce: 0,
        gas_limit: "0x5208", max_fee_per_gas: "0x1", max_priority_fee_per_gas: "0x1" })),
      broadcast: vi.fn(async () => "0xhash"),
      waitForReceipt: vi.fn(async () => ({ status: "success" as const, blockNumber: 1n })),
      getBalanceUsdcMinor: vi.fn(async () => 0n),
    };
    const privy = { signTransaction: vi.fn(async () => "0xsigned") };
    const ex = createPrivyArcExecutor({ arc: arc as never, privy: privy as never,
      address: OPTS.address, settlementAddress: "0x2" as never });

    expect(await ex.submit(intent)).toBe("0xhash");
    expect(privy.signTransaction).toHaveBeenCalled();
    expect(arc.broadcast).toHaveBeenCalledWith("0xsigned");
  });

  it("does NOT broadcast when the policy refuses the signature", async () => {
    const arc = {
      buildTransfer: vi.fn(async () => ({} as never)),
      broadcast: vi.fn(), waitForReceipt: vi.fn(), getBalanceUsdcMinor: vi.fn(),
    };
    const privy = { signTransaction: vi.fn(async () => { throw new Error("policy_violation"); }) };
    const ex = createPrivyArcExecutor({ arc: arc as never, privy: privy as never,
      address: OPTS.address, settlementAddress: "0x2" as never });

    await expect(ex.submit(intent)).rejects.toThrow(/policy/i);
    expect(arc.broadcast).not.toHaveBeenCalled();
  });

  it("maps a reverted receipt to failed, not confirmed", async () => {
    const arc = { waitForReceipt: vi.fn(async () => ({ status: "reverted" as const, blockNumber: 1n })) };
    const ex = createPrivyArcExecutor({ arc: arc as never, privy: {} as never,
      address: OPTS.address, settlementAddress: "0x2" as never });
    expect(await ex.checkStatus("0xhash")).toBe("failed");
  });

  it("reports pending rather than guessing when the receipt is not there yet", async () => {
    const arc = { waitForReceipt: vi.fn(async () => { throw new Error("timeout"); }) };
    const ex = createPrivyArcExecutor({ arc: arc as never, privy: {} as never,
      address: OPTS.address, settlementAddress: "0x2" as never });
    expect(await ex.checkStatus("0xhash")).toBe("pending");
  });
});
```

- [ ] **Step 2: Run to verify failure, then write `packages/wallet/src/privy.ts`**

```ts
import type { Address, Hex } from "viem";
import type { ArcClient } from "@idle/chain";
import type { Position } from "@idle/core";

const API = "https://api.privy.io";

export type ArcTransaction = {
  to: string; value: Hex; chain_id: number; nonce: number;
  gas_limit: Hex; max_fee_per_gas: Hex; max_priority_fee_per_gas: Hex;
};

export type PrivyOptions = {
  appId: string;
  appSecret: string;
  walletId: string;
  address: Address;
  fetchImpl?: typeof fetch;
};

/** Raised when the wallet policy refuses a signature. Not an error in the
 *  system — the control doing its job. */
export class PolicyViolationError extends Error {
  constructor(detail: string) {
    super(`Privy policy refused the transaction: ${detail}`);
    this.name = "PolicyViolationError";
  }
}

export function createPrivyClient(opts: PrivyOptions) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers = {
    // Basic auth in a header, never a query string — a secret in a URL ends up
    // in logs, proxies and referrers.
    authorization: "Basic " + Buffer.from(`${opts.appId}:${opts.appSecret}`).toString("base64"),
    "privy-app-id": opts.appId,
    "content-type": "application/json",
  };

  async function call(path: string, method: string, body?: unknown): Promise<unknown> {
    const res = await fetchImpl(`${API}${path}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(45_000),
    });
    const parsed = await res.json().catch(() => ({})) as { error?: string; code?: string };
    if (!res.ok) {
      const detail = parsed.error ?? `HTTP ${res.status}`;
      if (parsed.code === "policy_violation" || /policy/i.test(detail)) {
        throw new PolicyViolationError(detail);
      }
      throw new Error(`Privy ${method} ${path}: ${detail}`);
    }
    return parsed;
  }

  return {
    async signTransaction(transaction: ArcTransaction): Promise<Hex> {
      const out = await call(`/v1/wallets/${opts.walletId}/rpc`, "POST", {
        method: "eth_signTransaction",
        chain_type: "ethereum",
        params: { transaction },
      }) as { data?: { signed_transaction?: string } };
      const signed = out.data?.signed_transaction;
      if (typeof signed !== "string") throw new Error("Privy returned no signed transaction");
      return signed as Hex;
    },
    getWallet: () => call(`/v1/wallets/${opts.walletId}`, "GET"),
  };
}

/**
 * The treasury snapshot.
 *
 * `totalUsdc` is liquid plus parked, because allocations are absolute targets
 * (D-011) and conservation is checked against the whole treasury.
 */
export function createPrivyTreasury(deps: {
  arc: ArcClient;
  address: Address;
  listPositions: () => Promise<Position[]>;
}) {
  return {
    async snapshot() {
      const [liquid, positions] = await Promise.all([
        deps.arc.getBalanceUsdcMinor(deps.address),
        deps.listPositions(),
      ]);
      const parked = positions.reduce((sum, p) => sum + p.amountUsdc, 0n);
      return { totalUsdc: liquid + parked, positions };
    },
  };
}

/**
 * Executes intents on Arc, signed by the Privy wallet.
 *
 * Signing happens before broadcasting, so a policy refusal costs nothing: the
 * transaction never reaches the chain. That ordering is the whole reason the
 * policy is a real control rather than an audit trail.
 */
export function createPrivyArcExecutor(deps: {
  arc: ArcClient;
  privy: { signTransaction(tx: ArcTransaction): Promise<Hex> };
  address: Address;
  settlementAddress: Address;
}) {
  return {
    async submit(intent: { amountUsdc: bigint }): Promise<string> {
      const tx = await deps.arc.buildTransfer({
        from: deps.address,
        to: deps.settlementAddress,
        amountUsdcMinor: intent.amountUsdc,
      });
      const signed = await deps.privy.signTransaction(tx as ArcTransaction);
      return deps.arc.broadcast(signed);
    },

    async checkStatus(txRef: string): Promise<"confirmed" | "failed" | "pending"> {
      try {
        const r = await deps.arc.waitForReceipt(txRef as Hex);
        return r.status === "success" ? "confirmed" : "failed";
      } catch {
        // Not knowing is better than guessing in either direction.
        return "pending";
      }
    },
  };
}
```

- [ ] **Step 3: Run tests and commit**

Run: `pnpm vitest run packages/wallet && pnpm typecheck`
Expected: PASS — 9 tests

```bash
git add -A
git commit -m "Add the Privy treasury and Arc executor

Signing happens before broadcasting, so a policy refusal costs nothing — the
transaction never reaches the chain. That ordering is the whole reason the
policy is a control rather than an audit trail.

A policy denial gets its own error type. It is not a fault in the system; it
is the control working, and the orchestrator escalates rather than retries.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wire the server and run it live

**Files:**
- Modify: `apps/api/src/server.ts`, `apps/api/package.json`, `.env.example`
- Create: `apps/api/src/obligations-fixture.ts`

**Interfaces:**
- Produces: a server whose ports are all real

- [ ] **Step 1: Add the demo obligation schedule**

`apps/api/src/obligations-fixture.ts` — a real four-currency schedule for the
business the product is for. These are the company's own liabilities, not
market data, so they are configuration rather than something to fetch.

```ts
import type { Obligation } from "@idle/core";

/**
 * The business's forward obligations, in the four currencies it trades in.
 *
 * This is company data, not market data — there is no feed to read it from,
 * and every treasury system takes it as input. The Graph tracks' live-data
 * rule is about the lending rates, which are fetched live and never faked.
 */
export const DEMO_OBLIGATIONS: Obligation[] = [
  { id: "ng-payroll-sep", currency: "NGN", amountMinor: 480_000_000n, dueDate: "2026-09-25",
    category: "payroll", confidence: 1 },
  { id: "ke-supplier-sep", currency: "KES", amountMinor: 38_700_000n, dueDate: "2026-09-18",
    category: "supplier", confidence: 0.9 },
  { id: "gh-rent-oct", currency: "GHS", amountMinor: 1_860_000n, dueDate: "2026-10-01",
    category: "rent", confidence: 1 },
  { id: "tz-payroll-sep", currency: "TZS", amountMinor: 1_350_000_000n, dueDate: "2026-09-15",
    category: "payroll", confidence: 1 },
];
```

- [ ] **Step 2: Replace the placeholder adapters in `server.ts`**

```ts
import { serve } from "@hono/node-server";
import { getLendingMarkets } from "@idle/yields";
import { openLedger, reconcile } from "@idle/ledger";
import { createProposer } from "@idle/agent";
import { createArcClient } from "@idle/chain";
import { createPrivyArcExecutor, createPrivyClient, createPrivyTreasury } from "@idle/wallet";
import type { Address } from "viem";
import { createApp } from "./app.js";
import { loadPolicy } from "./config.js";
import { DEMO_OBLIGATIONS } from "./obligations-fixture.js";
import type { MarketsPort, OrchestratorDeps } from "./index.js";

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") throw new Error(`${name} is not set`);
  return v;
}

const policy = loadPolicy(process.env);
const ledger = openLedger(process.env.LEDGER_PATH ?? ".idle/ledger.db");

const arc = createArcClient(required("ARC_RPC_URL"));
const address = required("PRIVY_WALLET_ADDRESS") as Address;

const privy = createPrivyClient({
  appId: required("PRIVY_APP_ID"),
  appSecret: required("PRIVY_APP_SECRET"),
  walletId: required("PRIVY_WALLET_ID"),
  address,
});

const markets: MarketsPort = {
  async fetch() {
    const res = await getLendingMarkets({
      apiKey: required("GRAPH_API_KEY"),
      assetSymbols: ["USDC", "USDT", "DAI"],
    });
    return res.markets;
  },
};

// Parked positions come from the Earn vault once one is configured in the
// Privy Dashboard. Until then nothing is parked, and the agent works with a
// fully liquid treasury — which is the honest state, not a stub.
const treasury = createPrivyTreasury({ arc, address, listPositions: async () => [] });

const execution = createPrivyArcExecutor({
  arc, privy, address,
  settlementAddress: (process.env.SETTLEMENT_ADDRESS ?? address) as Address,
});

const deps: OrchestratorDeps = {
  ledger, markets, treasury,
  proposer: createProposer({ apiKey: required("ANTHROPIC_API_KEY") }),
  execution, policy,
  obligations: DEMO_OBLIGATIONS,
  now: () => new Date(),
};

// Reconcile anything left in flight BEFORE accepting new work. D-003.
const report = await reconcile(ledger, execution);
if (report.checked > 0) console.log("reconciled on startup:", report);

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: createApp(deps).fetch, port });
console.log(`idle-capital api on :${port}  wallet ${address}`);
```

- [ ] **Step 3: Extend `.env.example`**

```
# Privy server wallet, created via POST /v1/wallets
PRIVY_WALLET_ID=
PRIVY_WALLET_ADDRESS=
# Where settled obligations are paid. Defaults to the treasury wallet itself.
SETTLEMENT_ADDRESS=
# Agent model. Defaults to claude-opus-5.
AGENT_MODEL=
```

- [ ] **Step 4: Run the whole pipeline live**

Run: start the server with a populated `.env`, then `curl -X POST localhost:8787/runs`
Expected: a run that reaches `SETTLED`, `AWAITING_APPROVAL`, or `FAILED` with a
kernel verdict — every one of those is a correct outcome. What must NOT happen
is a crash or a run with no verdict.

- [ ] **Step 5: Commit**

---

## Definition of done

- [ ] `pnpm test` passes with the new agent, chain and wallet tests
- [ ] `pnpm typecheck` clean
- [ ] No private key is read at runtime
- [ ] A policy denial produces `PolicyViolationError` and no broadcast
- [ ] A live `POST /runs` produces a run with a kernel verdict and a rationale
