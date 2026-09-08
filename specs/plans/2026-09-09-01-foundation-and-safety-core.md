# Foundation & Safety Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the credential-free half of Idle Capital — shared domain types, the four-currency obligation ledger, and the deterministic policy kernel with all eight invariants under exhaustive test.

**Architecture:** A pnpm/TypeScript monorepo. `@idle/core` holds pure domain types with zero dependencies. `@idle/obligations` converts a four-currency forward schedule into a USDC buffer requirement. `@idle/kernel` validates an untrusted agent proposal against that buffer and the operator's policy, returning approved / vetoed / escalated. The kernel is pure — no I/O, no clock, no randomness — and never throws.

**Tech Stack:** Node 22, pnpm 10, TypeScript 5 (strict), Vitest.

**Spec:** `specs/2026-09-09-idle-capital-design.md`

## Global Constraints

- **Money is `bigint` minor units everywhere.** No floating-point currency arithmetic crosses a package boundary. USDC has 6 decimals (`1 USDC === 1_000_000n`); NGN, KES, GHS and TZS have 2.
- **Ratios are basis points** (`11500` = 1.15×, `5000` = 50%), so a policy factor multiplies a `bigint` without a float touching money.
- **Conversions round up.** Under-reserving is the unsafe direction — a buffer one unit too large costs nothing; one unit too small can miss payroll.
- **The kernel is pure and total.** No I/O, no `Date.now()`, no `Math.random()`; `asOf` is injected. `validate()` must never throw for any input, including malformed ones.
- **The kernel does not trust the agent.** `validate()` accepts `unknown` and narrows at runtime. The *policy*, by contrast, is operator-supplied configuration and is trusted.
- **TypeScript `strict: true`.** No `any` in exported signatures.
- **Commit after every task**, authored by `PhantomOz <faniogor@gmail.com>`, never squashed.
- **Update `ATTRIBUTION.md`** in the same commit that creates a file.

---

### Task 1: Monorepo foundation and `@idle/core` domain types

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`
- Create: `packages/core/src/money.ts`, `market.ts`, `obligation.ts`, `policy.ts`, `treasury.ts`, `proposal.ts`, `index.ts`
- Test: `packages/core/test/money.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `@idle/core` exporting `USDC_UNIT: bigint`, `divCeil(n: bigint, d: bigint): bigint`, `applyBpsCeil(amount: bigint, bps: number): bigint`, and the types `Currency`, `Obligation`, `ObligationCategory`, `Market`, `Policy`, `Position`, `TreasuryState`, `Allocation`, `Proposal`, `InvariantId`, `Breach`, `Verdict`.

- [ ] **Step 1: Create the workspace root**

`package.json`:
```json
{
  "name": "idle-capital",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.20.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.7.0"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "types": ["node"]
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
  },
});
```

- [ ] **Step 2: Create the `@idle/core` package shell**

`packages/core/package.json`:
```json
{
  "name": "@idle/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
```

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

- [ ] **Step 3: Write the failing test for money helpers**

`packages/core/test/money.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { USDC_UNIT, divCeil, applyBpsCeil } from "../src/index.js";

describe("USDC_UNIT", () => {
  it("is 1e6 because USDC has six decimals", () => {
    expect(USDC_UNIT).toBe(1_000_000n);
  });
});

describe("divCeil", () => {
  it("returns the exact quotient when division is clean", () => {
    expect(divCeil(10n, 5n)).toBe(2n);
  });

  it("rounds up on any remainder, because under-reserving is unsafe", () => {
    expect(divCeil(10n, 3n)).toBe(4n);
    expect(divCeil(1n, 1_000_000n)).toBe(1n);
  });

  it("returns zero for a zero numerator", () => {
    expect(divCeil(0n, 7n)).toBe(0n);
  });

  it("returns zero for a negative numerator rather than a negative amount", () => {
    expect(divCeil(-5n, 7n)).toBe(0n);
  });

  it("throws on a non-positive denominator", () => {
    expect(() => divCeil(1n, 0n)).toThrow(RangeError);
    expect(() => divCeil(1n, -3n)).toThrow(RangeError);
  });
});

describe("applyBpsCeil", () => {
  it("applies a 1.15x safety factor", () => {
    expect(applyBpsCeil(1_000_000n, 11_500)).toBe(1_150_000n);
  });

  it("is the identity at 10000 bps", () => {
    expect(applyBpsCeil(123_456n, 10_000)).toBe(123_456n);
  });

  it("rounds up rather than truncating", () => {
    // 1n * 5000 / 10000 = 0.5 -> 1n
    expect(applyBpsCeil(1n, 5_000)).toBe(1n);
  });

  it("returns zero at zero bps", () => {
    expect(applyBpsCeil(999n, 0)).toBe(0n);
  });

  it("throws on a non-integer or negative bps", () => {
    expect(() => applyBpsCeil(1n, 1.5)).toThrow(RangeError);
    expect(() => applyBpsCeil(1n, -1)).toThrow(RangeError);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm vitest run packages/core`
Expected: FAIL — cannot resolve `../src/index.js`

- [ ] **Step 5: Write `packages/core/src/money.ts`**

```ts
/** USDC has six decimals. One whole USDC in minor units. */
export const USDC_UNIT = 1_000_000n;
export const USDC_DECIMALS = 6;

/**
 * Ceiling division for bigints.
 *
 * Rounds up on any remainder. Every money conversion in this system uses it,
 * because under-reserving is the unsafe direction: a buffer one unit too large
 * costs nothing, one unit too small can miss payroll.
 */
export function divCeil(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError(`divCeil: denominator must be > 0, got ${denominator}`);
  }
  if (numerator <= 0n) return 0n;
  return (numerator + denominator - 1n) / denominator;
}

/**
 * Apply a basis-point factor to a bigint amount, rounding up.
 * Ratios are basis points so no float ever touches money.
 */
export function applyBpsCeil(amount: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0) {
    throw new RangeError(`applyBpsCeil: bps must be a non-negative integer, got ${bps}`);
  }
  return divCeil(amount * BigInt(bps), 10_000n);
}
```

- [ ] **Step 6: Write the domain type modules**

`packages/core/src/obligation.ts`:
```ts
export type Currency = "NGN" | "KES" | "GHS" | "TZS";

export const CURRENCIES: readonly Currency[] = ["NGN", "KES", "GHS", "TZS"] as const;

/** All four trade currencies use two minor digits. */
export const CURRENCY_DECIMALS: Readonly<Record<Currency, number>> = {
  NGN: 2, KES: 2, GHS: 2, TZS: 2,
};

export type ObligationCategory = "payroll" | "supplier" | "tax" | "rent";

export type Obligation = {
  id: string;
  currency: Currency;
  /** Minor units of `currency`. Never a float. */
  amountMinor: bigint;
  /** ISO 8601 calendar date, `YYYY-MM-DD`. */
  dueDate: string;
  category: ObligationCategory;
  /** 0..1 — how certain this falls due as scheduled. Informs the agent's
   *  rationale; does NOT reduce the hard buffer floor. */
  confidence: number;
};
```

`packages/core/src/market.ts`:
```ts
export type MarketAsset = {
  symbol: string;
  decimals: number;
  address: string;
};

/** A lending market, normalized from the Messari standardized schema. */
export type Market = {
  id: string;
  protocol: string;
  chain: string;
  asset: MarketAsset;
  /** Supply APY as a fraction, e.g. 0.0431 for 4.31%. */
  supplyApy: number;
  totalSuppliedUsd: number;
  totalBorrowedUsd: number;
  /** supplied - borrowed. What could actually be withdrawn. */
  liquidityUsd: number;
};
```

`packages/core/src/policy.ts`:
```ts
/**
 * Operator-supplied configuration. Unlike an agent proposal, the policy is
 * TRUSTED — it is written by a human and reviewed, not generated.
 */
export type Policy = {
  /** Obligations falling due within this window must stay covered. */
  bufferHorizonDays: number;
  /** Safety factor on the buffer, in basis points. 11500 = 1.15x. */
  bufferMultiplierBps: number;
  /** Market ids the agent may allocate to. */
  venueAllowlist: string[];
  /** Max share of post-run parked capital in any one market. 5000 = 50%. */
  maxVenueConcentrationBps: number;
  /** Ceiling on total USDC moved in a single run. */
  maxRunMovementUsdc: bigint;
  /** A venue below this liquidity is not safely exitable. */
  minVenueLiquidityUsd: number;
};
```

`packages/core/src/treasury.ts`:
```ts
import type { Market } from "./market.js";

export type Position = {
  marketId: string;
  amountUsdc: bigint;
};

export type TreasuryState = {
  /** Liquid, unparked USDC. The pool a proposal allocates from. */
  availableUsdc: bigint;
  positions: Position[];
  /** The live market set fetched THIS run. K3 checks against it. */
  markets: Market[];
  /** From @idle/obligations, at the policy horizon. */
  bufferRequiredUsdc: bigint;
  /** Injected, never read from the clock — the kernel must be pure. */
  asOf: Date;
};
```

`packages/core/src/proposal.ts`:
```ts
export type Allocation = {
  marketId: string;
  amountUsdc: bigint;
};

/** Untrusted output of the LLM agent. */
export type Proposal = {
  /** USDC to keep liquid. */
  hold: bigint;
  /** USDC to park, per market. */
  allocations: Allocation[];
  /** The agent's written reasoning, surfaced to humans. */
  rationale: string;
};

export type InvariantId = "K1" | "K2" | "K3" | "K4" | "K5" | "K6" | "K7" | "K8";

export type Breach = {
  invariant: InvariantId;
  /** Human-readable, shown in the approval queue. */
  message: string;
  /** The value that broke the invariant. */
  observed: string;
  /** The bound it broke. */
  limit: string;
};

export type Verdict =
  | { kind: "approved" }
  /** Structurally invalid — do not execute, do not ask a human to rubber-stamp. */
  | { kind: "vetoed"; breaches: Breach[] }
  /** Coherent but outside the autonomous envelope — a human decides. */
  | { kind: "escalated"; breaches: Breach[] };
```

`packages/core/src/index.ts`:
```ts
export * from "./money.js";
export * from "./obligation.js";
export * from "./market.js";
export * from "./policy.js";
export * from "./treasury.js";
export * from "./proposal.js";
```

- [ ] **Step 7: Install and run the test to verify it passes**

Run: `pnpm install && pnpm vitest run packages/core`
Expected: PASS — 11 tests

- [ ] **Step 8: Verify the typecheck is clean**

Run: `pnpm exec tsc --noEmit -p packages/core/tsconfig.json`
Expected: no output, exit 0

- [ ] **Step 9: Record the new files in ATTRIBUTION.md**

Append to the per-file table in `ATTRIBUTION.md`:
```markdown
| `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts` | `AI` | Workspace scaffolding |
| `packages/core/**` | `AI` | Domain types and money helpers; reviewed by the team |
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Add monorepo foundation and @idle/core domain types

Money is bigint minor units throughout and ratios are basis points, so no
float ever touches a currency amount. divCeil rounds up everywhere because
under-reserving is the unsafe direction.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: FX conversion in `@idle/obligations`

**Files:**
- Create: `packages/obligations/package.json`, `packages/obligations/tsconfig.json`
- Create: `packages/obligations/src/fx.ts`, `packages/obligations/src/index.ts`
- Test: `packages/obligations/test/fx.test.ts`

**Interfaces:**
- Consumes: `@idle/core` — `USDC_UNIT`, `divCeil`, type `Currency`
- Produces: `@idle/obligations` exporting `type FxTable`, `FIXED_FX: FxTable`, `toUsdcMinor(amountMinor: bigint, currency: Currency, fx?: FxTable): bigint`

- [ ] **Step 1: Create the package shell**

`packages/obligations/package.json`:
```json
{
  "name": "@idle/obligations",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@idle/core": "workspace:*" }
}
```

`packages/obligations/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

- [ ] **Step 2: Write the failing test**

`packages/obligations/test/fx.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { FIXED_FX, toUsdcMinor } from "../src/index.js";

describe("FIXED_FX", () => {
  it("documents when it was captured and that it is not a live oracle", () => {
    expect(FIXED_FX.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(FIXED_FX.source.length).toBeGreaterThan(0);
  });

  it("covers all four trade currencies", () => {
    expect(Object.keys(FIXED_FX.minorPerUsd).sort()).toEqual(["GHS", "KES", "NGN", "TZS"]);
  });
});

describe("toUsdcMinor", () => {
  it("converts exactly one dollar's worth of NGN to one USDC", () => {
    // 160_000 kobo === 1600.00 NGN === 1 USD at the fixed rate
    expect(toUsdcMinor(160_000n, "NGN")).toBe(1_000_000n);
  });

  it("converts each currency at its own rate", () => {
    expect(toUsdcMinor(12_900n, "KES")).toBe(1_000_000n);
    expect(toUsdcMinor(1_550n, "GHS")).toBe(1_000_000n);
    expect(toUsdcMinor(270_000n, "TZS")).toBe(1_000_000n);
  });

  it("scales linearly", () => {
    expect(toUsdcMinor(1_600_000n, "NGN")).toBe(10_000_000n);
  });

  it("rounds up so a converted obligation is never under-reserved", () => {
    // 1 kobo is a vanishing fraction of a USDC, but it must not vanish to zero
    expect(toUsdcMinor(1n, "NGN")).toBe(7n);
  });

  it("returns zero for a zero amount", () => {
    expect(toUsdcMinor(0n, "NGN")).toBe(0n);
  });

  it("accepts an injected table so rates are never hard-wired into callers", () => {
    const table = { ...FIXED_FX, minorPerUsd: { ...FIXED_FX.minorPerUsd, NGN: 200_000n } };
    expect(toUsdcMinor(200_000n, "NGN", table)).toBe(1_000_000n);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run packages/obligations`
Expected: FAIL — cannot resolve `../src/index.js`

- [ ] **Step 4: Write `packages/obligations/src/fx.ts`**

```ts
import { USDC_UNIT, divCeil, type Currency } from "@idle/core";

export type FxTable = {
  /** ISO date the rates were captured. */
  asOf: string;
  /** Provenance, surfaced in the UI and README as a disclosed seam. */
  source: string;
  /** Minor units of local currency per 1 USD. NGN 1600.00/USD -> 160_000n. */
  minorPerUsd: Readonly<Record<Currency, bigint>>;
};

/**
 * Idle Capital does not consume a live FX oracle. Rates are a documented
 * fixed table, disclosed in the README and the demo, exactly as Arc being a
 * testnet is disclosed. Swapping in an oracle means replacing this object.
 */
export const FIXED_FX: FxTable = {
  asOf: "2026-09-01",
  source: "Documented fixed-rate table; not a live oracle. See specs/2026-09-09-idle-capital-design.md §2.",
  minorPerUsd: {
    NGN: 160_000n, // 1600.00 NGN / USD
    KES: 12_900n,  //  129.00 KES / USD
    GHS: 1_550n,   //   15.50 GHS / USD
    TZS: 270_000n, // 2700.00 TZS / USD
  },
};

/**
 * Convert a local-currency minor amount into USDC minor units, rounding UP.
 * Rounding up keeps a converted obligation from ever being under-reserved.
 */
export function toUsdcMinor(
  amountMinor: bigint,
  currency: Currency,
  fx: FxTable = FIXED_FX,
): bigint {
  const minorPerUsd = fx.minorPerUsd[currency];
  return divCeil(amountMinor * USDC_UNIT, minorPerUsd);
}
```

`packages/obligations/src/index.ts`:
```ts
export * from "./fx.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm install && pnpm vitest run packages/obligations`
Expected: PASS — 8 tests

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add documented fixed-rate FX conversion

Rounds up so a converted obligation is never under-reserved. The table is a
disclosed seam, not a live oracle, and the source field says so.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Buffer requirement and per-currency schedule

**Files:**
- Create: `packages/obligations/src/buffer.ts`
- Modify: `packages/obligations/src/index.ts`
- Test: `packages/obligations/test/buffer.test.ts`

**Interfaces:**
- Consumes: `@idle/core` types `Currency`, `Obligation`; `./fx.js` — `toUsdcMinor`, `FIXED_FX`, `type FxTable`
- Produces: `withinHorizon(o: Obligation, horizonDays: number, asOf: Date): boolean`, `bufferRequirementUsdc(obligations: Obligation[], horizonDays: number, asOf: Date, fx?: FxTable): bigint`, `scheduleByCurrency(obligations: Obligation[], horizonDays: number, asOf: Date, fx?: FxTable): Record<Currency, bigint>` (values in USDC minor units)

- [ ] **Step 1: Write the failing test**

`packages/obligations/test/buffer.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Obligation } from "@idle/core";
import { bufferRequirementUsdc, scheduleByCurrency, withinHorizon } from "../src/index.js";

const ASOF = new Date("2026-09-09T00:00:00Z");

function ob(over: Partial<Obligation> & Pick<Obligation, "id" | "currency" | "amountMinor" | "dueDate">): Obligation {
  return { category: "supplier", confidence: 1, ...over };
}

describe("withinHorizon", () => {
  it("includes an obligation due inside the window", () => {
    expect(withinHorizon(ob({ id: "a", currency: "NGN", amountMinor: 1n, dueDate: "2026-09-20" }), 30, ASOF)).toBe(true);
  });

  it("includes an obligation due exactly on the horizon edge", () => {
    expect(withinHorizon(ob({ id: "a", currency: "NGN", amountMinor: 1n, dueDate: "2026-10-09" }), 30, ASOF)).toBe(true);
  });

  it("excludes an obligation due past the horizon", () => {
    expect(withinHorizon(ob({ id: "a", currency: "NGN", amountMinor: 1n, dueDate: "2026-10-10" }), 30, ASOF)).toBe(false);
  });

  it("INCLUDES a past-due obligation, which is still owed", () => {
    expect(withinHorizon(ob({ id: "a", currency: "NGN", amountMinor: 1n, dueDate: "2026-08-01" }), 30, ASOF)).toBe(true);
  });
});

describe("bufferRequirementUsdc", () => {
  it("is zero with no obligations", () => {
    expect(bufferRequirementUsdc([], 30, ASOF)).toBe(0n);
  });

  it("sums obligations across all four currencies in USDC", () => {
    const obligations = [
      ob({ id: "n", currency: "NGN", amountMinor: 160_000n, dueDate: "2026-09-15" }),
      ob({ id: "k", currency: "KES", amountMinor: 12_900n, dueDate: "2026-09-16" }),
      ob({ id: "g", currency: "GHS", amountMinor: 1_550n, dueDate: "2026-09-17" }),
      ob({ id: "t", currency: "TZS", amountMinor: 270_000n, dueDate: "2026-09-18" }),
    ];
    expect(bufferRequirementUsdc(obligations, 30, ASOF)).toBe(4_000_000n);
  });

  it("excludes obligations beyond the horizon", () => {
    const obligations = [
      ob({ id: "in", currency: "NGN", amountMinor: 160_000n, dueDate: "2026-09-15" }),
      ob({ id: "out", currency: "NGN", amountMinor: 160_000n, dueDate: "2026-12-01" }),
    ];
    expect(bufferRequirementUsdc(obligations, 30, ASOF)).toBe(1_000_000n);
  });

  it("does NOT discount low-confidence obligations — the buffer is a hard floor", () => {
    const obligations = [
      ob({ id: "n", currency: "NGN", amountMinor: 160_000n, dueDate: "2026-09-15", confidence: 0.1 }),
    ];
    expect(bufferRequirementUsdc(obligations, 30, ASOF)).toBe(1_000_000n);
  });
});

describe("scheduleByCurrency", () => {
  it("reports every currency, including those with nothing due", () => {
    const result = scheduleByCurrency(
      [ob({ id: "n", currency: "NGN", amountMinor: 160_000n, dueDate: "2026-09-15" })],
      30, ASOF,
    );
    expect(result).toEqual({ NGN: 1_000_000n, KES: 0n, GHS: 0n, TZS: 0n });
  });

  it("aggregates multiple obligations in the same currency", () => {
    const result = scheduleByCurrency(
      [
        ob({ id: "a", currency: "TZS", amountMinor: 270_000n, dueDate: "2026-09-15" }),
        ob({ id: "b", currency: "TZS", amountMinor: 270_000n, dueDate: "2026-09-16" }),
      ],
      30, ASOF,
    );
    expect(result.TZS).toBe(2_000_000n);
  });

  it("sums to the same total as bufferRequirementUsdc", () => {
    const obligations = [
      ob({ id: "n", currency: "NGN", amountMinor: 1_234_567n, dueDate: "2026-09-15" }),
      ob({ id: "k", currency: "KES", amountMinor: 98_765n, dueDate: "2026-09-16" }),
    ];
    const schedule = scheduleByCurrency(obligations, 30, ASOF);
    const summed = Object.values(schedule).reduce((a, b) => a + b, 0n);
    expect(summed).toBe(bufferRequirementUsdc(obligations, 30, ASOF));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/obligations/test/buffer.test.ts`
Expected: FAIL — `withinHorizon` is not exported

- [ ] **Step 3: Write `packages/obligations/src/buffer.ts`**

```ts
import { CURRENCIES, type Currency, type Obligation } from "@idle/core";
import { FIXED_FX, toUsdcMinor, type FxTable } from "./fx.js";

const MS_PER_DAY = 86_400_000;

/**
 * Is this obligation the treasury's problem within `horizonDays`?
 *
 * Past-due obligations count. Something owed last month is still owed, and
 * excluding it would under-reserve exactly when the business is already late.
 */
export function withinHorizon(o: Obligation, horizonDays: number, asOf: Date): boolean {
  const due = Date.parse(`${o.dueDate}T00:00:00Z`);
  if (Number.isNaN(due)) return false;
  return due <= asOf.getTime() + horizonDays * MS_PER_DAY;
}

/**
 * Total USDC that must stay liquid to cover obligations within the horizon.
 *
 * `confidence` deliberately does NOT scale the amount. The buffer is a hard
 * floor; a 10%-likely payroll run still needs the cash on the day it lands.
 * Confidence is surfaced to the agent for its rationale instead.
 */
export function bufferRequirementUsdc(
  obligations: Obligation[],
  horizonDays: number,
  asOf: Date,
  fx: FxTable = FIXED_FX,
): bigint {
  return obligations
    .filter((o) => withinHorizon(o, horizonDays, asOf))
    .reduce((total, o) => total + toUsdcMinor(o.amountMinor, o.currency, fx), 0n);
}

/** The same total, split by currency, in USDC minor units. */
export function scheduleByCurrency(
  obligations: Obligation[],
  horizonDays: number,
  asOf: Date,
  fx: FxTable = FIXED_FX,
): Record<Currency, bigint> {
  const out = Object.fromEntries(CURRENCIES.map((c) => [c, 0n])) as Record<Currency, bigint>;
  for (const o of obligations) {
    if (!withinHorizon(o, horizonDays, asOf)) continue;
    out[o.currency] += toUsdcMinor(o.amountMinor, o.currency, fx);
  }
  return out;
}
```

Append to `packages/obligations/src/index.ts`:
```ts
export * from "./buffer.js";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/obligations`
Expected: PASS — 19 tests total in the package

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add four-currency buffer requirement and per-currency schedule

Past-due obligations count toward the buffer: something owed last month is
still owed, and excluding it would under-reserve exactly when the business is
already late. Confidence does not scale the amount — the buffer is a hard
floor, and confidence informs the agent's rationale instead.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Kernel invariants K8 and K2 — well-formedness and conservation

**Files:**
- Create: `packages/kernel/package.json`, `packages/kernel/tsconfig.json`
- Create: `packages/kernel/src/invariants.ts`, `packages/kernel/src/index.ts`
- Test: `packages/kernel/test/invariants.test.ts`

**Interfaces:**
- Consumes: `@idle/core` — types `Proposal`, `TreasuryState`, `Policy`, `Breach`
- Produces: `k8WellFormed(proposal: unknown): Breach | null`, `k2Conservation(p: Proposal, s: TreasuryState): Breach | null`

- [ ] **Step 1: Create the package shell**

`packages/kernel/package.json`:
```json
{
  "name": "@idle/kernel",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@idle/core": "workspace:*" }
}
```

`packages/kernel/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

- [ ] **Step 2: Write the failing test**

`packages/kernel/test/invariants.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Market, Proposal, TreasuryState } from "@idle/core";
import { k2Conservation, k8WellFormed } from "../src/index.js";

const ASOF = new Date("2026-09-09T00:00:00Z");

function market(id: string, over: Partial<Market> = {}): Market {
  return {
    id, protocol: "aave-v3", chain: "arbitrum",
    asset: { symbol: "USDC", decimals: 6, address: "0xusdc" },
    supplyApy: 0.04, totalSuppliedUsd: 10_000_000, totalBorrowedUsd: 4_000_000,
    liquidityUsd: 6_000_000, ...over,
  };
}

function state(over: Partial<TreasuryState> = {}): TreasuryState {
  return {
    availableUsdc: 100_000_000n, positions: [], markets: [market("m1"), market("m2")],
    bufferRequiredUsdc: 30_000_000n, asOf: ASOF, ...over,
  };
}

describe("k8WellFormed", () => {
  it("passes a valid proposal", () => {
    const p: Proposal = { hold: 1n, allocations: [{ marketId: "m1", amountUsdc: 1n }], rationale: "ok" };
    expect(k8WellFormed(p)).toBeNull();
  });

  it("passes a proposal that parks nothing", () => {
    expect(k8WellFormed({ hold: 5n, allocations: [], rationale: "hold everything" })).toBeNull();
  });

  // NOT it.each — it spreads array elements as arguments, so the `[]` case
  // would pass zero args and silently test `undefined` twice instead.
  it("rejects non-object input", () => {
    for (const bad of [null, undefined, 42, "proposal", []]) {
      expect(k8WellFormed(bad)?.invariant).toBe("K8");
    }
  });

  it("rejects a missing allocations array", () => {
    expect(k8WellFormed({ hold: 1n, rationale: "x" })?.invariant).toBe("K8");
  });

  it("rejects a non-bigint hold, which is how a float sneaks into money", () => {
    expect(k8WellFormed({ hold: 1, allocations: [], rationale: "x" })?.invariant).toBe("K8");
  });

  it("rejects a negative hold", () => {
    expect(k8WellFormed({ hold: -1n, allocations: [], rationale: "x" })?.invariant).toBe("K8");
  });

  it("rejects a zero-amount allocation as meaningless", () => {
    const p = { hold: 1n, allocations: [{ marketId: "m1", amountUsdc: 0n }], rationale: "x" };
    expect(k8WellFormed(p)?.invariant).toBe("K8");
  });

  it("rejects a negative allocation, which would invert the transfer", () => {
    const p = { hold: 1n, allocations: [{ marketId: "m1", amountUsdc: -5n }], rationale: "x" };
    expect(k8WellFormed(p)?.invariant).toBe("K8");
  });

  it("rejects duplicate market ids, which would double-count concentration", () => {
    const p = {
      hold: 1n,
      allocations: [{ marketId: "m1", amountUsdc: 1n }, { marketId: "m1", amountUsdc: 2n }],
      rationale: "x",
    };
    const breach = k8WellFormed(p);
    expect(breach?.invariant).toBe("K8");
    expect(breach?.message).toMatch(/duplicate/i);
  });

  it("rejects a non-string rationale", () => {
    expect(k8WellFormed({ hold: 1n, allocations: [], rationale: 7 })?.invariant).toBe("K8");
  });
});

describe("k2Conservation", () => {
  it("passes when hold plus allocations equals the available balance exactly", () => {
    const p: Proposal = {
      hold: 40_000_000n,
      allocations: [{ marketId: "m1", amountUsdc: 60_000_000n }],
      rationale: "x",
    };
    expect(k2Conservation(p, state())).toBeNull();
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

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run packages/kernel`
Expected: FAIL — cannot resolve `../src/index.js`

- [ ] **Step 4: Write `packages/kernel/src/invariants.ts`**

```ts
import type { Breach, Proposal, TreasuryState } from "@idle/core";

function breach(
  invariant: Breach["invariant"], message: string, observed: string, limit: string,
): Breach {
  return { invariant, message, observed, limit };
}

function isBigInt(v: unknown): v is bigint {
  return typeof v === "bigint";
}

/**
 * K8 — structural well-formedness. VETO.
 *
 * Runs first and takes `unknown`, because everything downstream assumes a
 * typed Proposal and the agent is not trusted to produce one. TypeScript
 * types are erased at runtime; this is the only thing standing between a
 * hallucinated shape and the money-moving path.
 */
export function k8WellFormed(proposal: unknown): Breach | null {
  if (typeof proposal !== "object" || proposal === null || Array.isArray(proposal)) {
    return breach("K8", "Proposal is not an object", String(proposal), "object");
  }
  const p = proposal as Record<string, unknown>;

  if (!isBigInt(p.hold)) {
    return breach("K8", "hold is not a bigint", typeof p.hold, "bigint");
  }
  if (p.hold < 0n) {
    return breach("K8", "hold is negative", p.hold.toString(), ">= 0");
  }
  if (typeof p.rationale !== "string") {
    return breach("K8", "rationale is not a string", typeof p.rationale, "string");
  }
  if (!Array.isArray(p.allocations)) {
    return breach("K8", "allocations is not an array", typeof p.allocations, "array");
  }

  const seen = new Set<string>();
  for (const raw of p.allocations) {
    if (typeof raw !== "object" || raw === null) {
      return breach("K8", "allocation is not an object", String(raw), "object");
    }
    const a = raw as Record<string, unknown>;
    if (typeof a.marketId !== "string" || a.marketId.length === 0) {
      return breach("K8", "allocation marketId is not a non-empty string", String(a.marketId), "string");
    }
    if (!isBigInt(a.amountUsdc)) {
      return breach("K8", `allocation ${a.marketId} amountUsdc is not a bigint`, typeof a.amountUsdc, "bigint");
    }
    if (a.amountUsdc <= 0n) {
      return breach("K8", `allocation ${a.marketId} is not positive`, a.amountUsdc.toString(), "> 0");
    }
    if (seen.has(a.marketId)) {
      return breach("K8", `duplicate allocation to market ${a.marketId}`, a.marketId, "unique market ids");
    }
    seen.add(a.marketId);
  }
  return null;
}

/**
 * K2 — conservation. VETO.
 *
 * Every available unit is either held or allocated. A proposal that does not
 * balance is either conjuring USDC or silently stranding it, and neither is
 * something a human should be asked to approve.
 */
export function k2Conservation(p: Proposal, s: TreasuryState): Breach | null {
  const allocated = p.allocations.reduce((sum, a) => sum + a.amountUsdc, 0n);
  const total = p.hold + allocated;
  if (total !== s.availableUsdc) {
    return breach(
      "K2",
      "hold plus allocations does not equal the available balance",
      `${total} (hold ${p.hold} + allocated ${allocated})`,
      s.availableUsdc.toString(),
    );
  }
  return null;
}
```

`packages/kernel/src/index.ts`:
```ts
export * from "./invariants.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm install && pnpm vitest run packages/kernel`
Expected: PASS — 13 tests

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add kernel invariants K8 (well-formedness) and K2 (conservation)

K8 takes `unknown` on purpose. TypeScript types are erased at runtime, and
the agent is not trusted to produce a valid shape — this is the only thing
between a hallucinated proposal and the money-moving path.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Kernel invariants K1, K3, K4 — buffer, market existence, allowlist

**Files:**
- Modify: `packages/kernel/src/invariants.ts`
- Test: `packages/kernel/test/invariants.test.ts` (append)

**Interfaces:**
- Consumes: `@idle/core` — `applyBpsCeil`, types `Policy`, `Proposal`, `TreasuryState`, `Breach`
- Produces: `k1BufferCoverage(p: Proposal, s: TreasuryState, pol: Policy): Breach | null`, `k3MarketExists(p: Proposal, s: TreasuryState): Breach | null`, `k4Allowlist(p: Proposal, pol: Policy): Breach | null`

- [ ] **Step 1: Write the failing test**

Append to `packages/kernel/test/invariants.test.ts`:
```ts
import { k1BufferCoverage, k3MarketExists, k4Allowlist } from "../src/index.js";
import type { Policy } from "@idle/core";

function policy(over: Partial<Policy> = {}): Policy {
  return {
    bufferHorizonDays: 30,
    bufferMultiplierBps: 11_500,
    venueAllowlist: ["m1", "m2"],
    maxVenueConcentrationBps: 5_000,
    maxRunMovementUsdc: 1_000_000_000n,
    minVenueLiquidityUsd: 1_000_000,
    ...over,
  };
}

describe("k1BufferCoverage", () => {
  it("passes when hold covers the buffer times the safety factor", () => {
    // 30_000_000 * 1.15 = 34_500_000
    const p: Proposal = { hold: 34_500_000n, allocations: [], rationale: "x" };
    expect(k1BufferCoverage(p, state(), policy())).toBeNull();
  });

  it("passes when hold exceeds the requirement", () => {
    const p: Proposal = { hold: 90_000_000n, allocations: [], rationale: "x" };
    expect(k1BufferCoverage(p, state(), policy())).toBeNull();
  });

  it("rejects hold one unit below the requirement", () => {
    const p: Proposal = { hold: 34_499_999n, allocations: [], rationale: "x" };
    const b = k1BufferCoverage(p, state(), policy());
    expect(b?.invariant).toBe("K1");
    expect(b?.limit).toContain("34500000");
  });

  it("applies the safety multiplier rather than the raw buffer", () => {
    const p: Proposal = { hold: 30_000_000n, allocations: [], rationale: "x" };
    expect(k1BufferCoverage(p, state(), policy())?.invariant).toBe("K1");
  });

  it("passes trivially when nothing is owed", () => {
    const p: Proposal = { hold: 0n, allocations: [], rationale: "x" };
    expect(k1BufferCoverage(p, state({ bufferRequiredUsdc: 0n }), policy())).toBeNull();
  });
});

describe("k3MarketExists", () => {
  it("passes when every target is in this run's live market set", () => {
    const p: Proposal = { hold: 0n, allocations: [{ marketId: "m1", amountUsdc: 1n }], rationale: "x" };
    expect(k3MarketExists(p, state())).toBeNull();
  });

  it("rejects a market the agent invented", () => {
    const p: Proposal = { hold: 0n, allocations: [{ marketId: "ghost", amountUsdc: 1n }], rationale: "x" };
    const b = k3MarketExists(p, state());
    expect(b?.invariant).toBe("K3");
    expect(b?.observed).toContain("ghost");
  });
});

describe("k4Allowlist", () => {
  it("passes when every target is allowlisted", () => {
    const p: Proposal = { hold: 0n, allocations: [{ marketId: "m2", amountUsdc: 1n }], rationale: "x" };
    expect(k4Allowlist(p, policy())).toBeNull();
  });

  it("rejects a real market that the operator has not permitted", () => {
    const p: Proposal = { hold: 0n, allocations: [{ marketId: "m3", amountUsdc: 1n }], rationale: "x" };
    expect(k4Allowlist(p, policy())?.invariant).toBe("K4");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/kernel`
Expected: FAIL — `k1BufferCoverage` is not exported

- [ ] **Step 3: Append to `packages/kernel/src/invariants.ts`**

```ts
import { applyBpsCeil, type Policy } from "@idle/core";

/**
 * K1 — buffer coverage. VETO.
 *
 * The retained liquid balance must cover obligations at the policy horizon,
 * scaled by the safety factor. This is the invariant the whole product exists
 * to hold: park the surplus, never the payroll.
 */
export function k1BufferCoverage(p: Proposal, s: TreasuryState, pol: Policy): Breach | null {
  const required = applyBpsCeil(s.bufferRequiredUsdc, pol.bufferMultiplierBps);
  if (p.hold < required) {
    return breach(
      "K1",
      `retained balance does not cover obligations over ${pol.bufferHorizonDays} days`,
      p.hold.toString(),
      `${required} (buffer ${s.bufferRequiredUsdc} x ${pol.bufferMultiplierBps}bps)`,
    );
  }
  return null;
}

/**
 * K3 — market existence. VETO.
 *
 * Checked against the market set fetched THIS run, not a cached list. An
 * agent that names a market which no longer exists is proposing a transfer
 * into nothing.
 */
export function k3MarketExists(p: Proposal, s: TreasuryState): Breach | null {
  const live = new Set(s.markets.map((m) => m.id));
  for (const a of p.allocations) {
    if (!live.has(a.marketId)) {
      return breach("K3", `market ${a.marketId} is not in this run's live market set`, a.marketId, `one of ${[...live].join(", ")}`);
    }
  }
  return null;
}

/**
 * K4 — venue allowlist. VETO.
 *
 * A market can be real, liquid and high-yielding and still be one the
 * operator has not agreed to hold funds in.
 */
export function k4Allowlist(p: Proposal, pol: Policy): Breach | null {
  const allowed = new Set(pol.venueAllowlist);
  for (const a of p.allocations) {
    if (!allowed.has(a.marketId)) {
      return breach("K4", `market ${a.marketId} is not on the venue allowlist`, a.marketId, pol.venueAllowlist.join(", "));
    }
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/kernel`
Expected: PASS — 22 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add kernel invariants K1, K3, K4

K1 is the invariant the product exists to hold: park the surplus, never the
payroll. K3 checks against the market set fetched this run rather than a
cached list, so an agent naming a market that has since disappeared cannot
propose a transfer into nothing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Kernel invariants K5, K6, K7 — concentration, movement cap, liquidity floor

**Files:**
- Modify: `packages/kernel/src/invariants.ts`
- Test: `packages/kernel/test/invariants.test.ts` (append)

**Interfaces:**
- Consumes: as Task 5
- Produces: `k5Concentration(p: Proposal, s: TreasuryState, pol: Policy): Breach | null`, `k6RunMovement(p: Proposal, pol: Policy): Breach | null`, `k7Liquidity(p: Proposal, s: TreasuryState, pol: Policy): Breach | null`

- [ ] **Step 1: Write the failing test**

Append to `packages/kernel/test/invariants.test.ts`:
```ts
import { k5Concentration, k6RunMovement, k7Liquidity } from "../src/index.js";

describe("k5Concentration", () => {
  it("passes an even split at exactly the 50% cap", () => {
    const p: Proposal = {
      hold: 0n,
      allocations: [
        { marketId: "m1", amountUsdc: 50_000_000n },
        { marketId: "m2", amountUsdc: 50_000_000n },
      ],
      rationale: "x",
    };
    expect(k5Concentration(p, state(), policy())).toBeNull();
  });

  it("escalates when one venue takes more than the cap", () => {
    const p: Proposal = {
      hold: 0n,
      allocations: [
        { marketId: "m1", amountUsdc: 60_000_000n },
        { marketId: "m2", amountUsdc: 40_000_000n },
      ],
      rationale: "x",
    };
    const b = k5Concentration(p, state(), policy());
    expect(b?.invariant).toBe("K5");
    expect(b?.observed).toContain("m1");
  });

  it("counts EXISTING positions, not just this run's allocations", () => {
    // 40m already in m1, adding 30m of a 60m run -> 70m of 100m parked = 70%
    const p: Proposal = {
      hold: 0n,
      allocations: [
        { marketId: "m1", amountUsdc: 30_000_000n },
        { marketId: "m2", amountUsdc: 30_000_000n },
      ],
      rationale: "x",
    };
    const s = state({ positions: [{ marketId: "m1", amountUsdc: 40_000_000n }] });
    expect(k5Concentration(p, s, policy())?.invariant).toBe("K5");
  });

  it("passes when nothing is parked at all", () => {
    const p: Proposal = { hold: 100_000_000n, allocations: [], rationale: "x" };
    expect(k5Concentration(p, state(), policy())).toBeNull();
  });
});

describe("k6RunMovement", () => {
  it("passes at exactly the cap", () => {
    const p: Proposal = { hold: 0n, allocations: [{ marketId: "m1", amountUsdc: 1_000_000_000n }], rationale: "x" };
    expect(k6RunMovement(p, policy())).toBeNull();
  });

  it("escalates one unit over the cap", () => {
    const p: Proposal = { hold: 0n, allocations: [{ marketId: "m1", amountUsdc: 1_000_000_001n }], rationale: "x" };
    expect(k6RunMovement(p, policy())?.invariant).toBe("K6");
  });
});

describe("k7Liquidity", () => {
  it("passes a venue above the liquidity floor", () => {
    const p: Proposal = { hold: 0n, allocations: [{ marketId: "m1", amountUsdc: 1n }], rationale: "x" };
    expect(k7Liquidity(p, state(), policy())).toBeNull();
  });

  it("escalates a venue we could not exit", () => {
    const s = state({ markets: [market("m1", { liquidityUsd: 500 }), market("m2")] });
    const p: Proposal = { hold: 0n, allocations: [{ marketId: "m1", amountUsdc: 1n }], rationale: "x" };
    const b = k7Liquidity(p, s, policy());
    expect(b?.invariant).toBe("K7");
  });

  it("ignores the liquidity of venues the proposal does not touch", () => {
    const s = state({ markets: [market("m1"), market("m2", { liquidityUsd: 1 })] });
    const p: Proposal = { hold: 0n, allocations: [{ marketId: "m1", amountUsdc: 1n }], rationale: "x" };
    expect(k7Liquidity(p, s, policy())).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/kernel`
Expected: FAIL — `k5Concentration` is not exported

- [ ] **Step 3: Append to `packages/kernel/src/invariants.ts`**

```ts
/**
 * K5 — venue concentration. ESCALATE.
 *
 * Measured on the position AFTER the run, including capital already parked.
 * Measuring only this run's movement would let an agent reach any
 * concentration it liked by splitting the approach across several runs.
 */
export function k5Concentration(p: Proposal, s: TreasuryState, pol: Policy): Breach | null {
  const after = new Map<string, bigint>();
  for (const pos of s.positions) {
    after.set(pos.marketId, (after.get(pos.marketId) ?? 0n) + pos.amountUsdc);
  }
  for (const a of p.allocations) {
    after.set(a.marketId, (after.get(a.marketId) ?? 0n) + a.amountUsdc);
  }

  let totalParked = 0n;
  for (const amount of after.values()) totalParked += amount;
  if (totalParked === 0n) return null;

  const cap = applyBpsCeil(totalParked, pol.maxVenueConcentrationBps);
  for (const [marketId, amount] of after) {
    if (amount > cap) {
      return breach(
        "K5",
        `market ${marketId} would hold more than the permitted share of parked capital`,
        `${marketId} at ${amount} of ${totalParked}`,
        `${cap} (${pol.maxVenueConcentrationBps}bps)`,
      );
    }
  }
  return null;
}

/**
 * K6 — per-run movement ceiling. ESCALATE.
 *
 * Bounds the blast radius of any single bad decision, whoever made it.
 */
export function k6RunMovement(p: Proposal, pol: Policy): Breach | null {
  const moved = p.allocations.reduce((sum, a) => sum + a.amountUsdc, 0n);
  if (moved > pol.maxRunMovementUsdc) {
    return breach("K6", "this run moves more than the per-run ceiling", moved.toString(), pol.maxRunMovementUsdc.toString());
  }
  return null;
}

/**
 * K7 — venue liquidity floor. ESCALATE.
 *
 * Yield on capital that cannot be withdrawn is not yield. Only venues the
 * proposal actually targets are checked.
 */
export function k7Liquidity(p: Proposal, s: TreasuryState, pol: Policy): Breach | null {
  const byId = new Map(s.markets.map((m) => [m.id, m]));
  for (const a of p.allocations) {
    const m = byId.get(a.marketId);
    if (m === undefined) continue; // K3 owns the missing-market case
    if (m.liquidityUsd < pol.minVenueLiquidityUsd) {
      return breach(
        "K7",
        `market ${a.marketId} is below the liquidity floor and may not be exitable`,
        `${m.liquidityUsd}`,
        `${pol.minVenueLiquidityUsd}`,
      );
    }
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/kernel`
Expected: PASS — 31 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add kernel invariants K5, K6, K7

K5 measures concentration on the position after the run, including capital
already parked. Measuring only this run's movement would let an agent reach
any concentration it liked by splitting the approach across several runs.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `validate()` — verdict precedence and the never-throws guarantee

**Files:**
- Create: `packages/kernel/src/validate.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/test/validate.test.ts`

**Interfaces:**
- Consumes: all eight invariants from `./invariants.js`
- Produces: `validate(proposal: unknown, state: TreasuryState, policy: Policy): Verdict`

- [ ] **Step 1: Write the failing test**

`packages/kernel/test/validate.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Market, Policy, Proposal, TreasuryState } from "@idle/core";
import { validate } from "../src/index.js";

const ASOF = new Date("2026-09-09T00:00:00Z");

function market(id: string, over: Partial<Market> = {}): Market {
  return {
    id, protocol: "aave-v3", chain: "arbitrum",
    asset: { symbol: "USDC", decimals: 6, address: "0xusdc" },
    supplyApy: 0.04, totalSuppliedUsd: 10_000_000, totalBorrowedUsd: 4_000_000,
    liquidityUsd: 6_000_000, ...over,
  };
}
function state(over: Partial<TreasuryState> = {}): TreasuryState {
  return {
    availableUsdc: 100_000_000n, positions: [], markets: [market("m1"), market("m2")],
    bufferRequiredUsdc: 30_000_000n, asOf: ASOF, ...over,
  };
}
function policy(over: Partial<Policy> = {}): Policy {
  return {
    bufferHorizonDays: 30, bufferMultiplierBps: 11_500,
    venueAllowlist: ["m1", "m2"], maxVenueConcentrationBps: 5_000,
    maxRunMovementUsdc: 1_000_000_000n, minVenueLiquidityUsd: 1_000_000, ...over,
  };
}

describe("validate", () => {
  it("approves a proposal that satisfies every invariant", () => {
    const p: Proposal = {
      hold: 40_000_000n,
      allocations: [
        { marketId: "m1", amountUsdc: 30_000_000n },
        { marketId: "m2", amountUsdc: 30_000_000n },
      ],
      rationale: "TZS payroll lands in six days; park the surplus evenly.",
    };
    expect(validate(p, state(), policy())).toEqual({ kind: "approved" });
  });

  it("vetoes rather than escalates when both kinds of breach are present", () => {
    // K1 breach (veto) AND K6 breach (escalate) at once
    const p: Proposal = {
      hold: 0n,
      allocations: [{ marketId: "m1", amountUsdc: 100_000_000n }],
      rationale: "x",
    };
    const v = validate(p, state(), policy({ maxRunMovementUsdc: 1n }));
    expect(v.kind).toBe("vetoed");
  });

  it("reports every veto breach, not only the first", () => {
    const p: Proposal = { hold: 0n, allocations: [{ marketId: "ghost", amountUsdc: 100_000_000n }], rationale: "x" };
    const v = validate(p, state(), policy());
    expect(v.kind).toBe("vetoed");
    if (v.kind !== "approved") {
      const ids = v.breaches.map((b) => b.invariant);
      expect(ids).toContain("K1");
      expect(ids).toContain("K3");
      expect(ids).toContain("K4");
    }
  });

  it("escalates a coherent proposal that steps outside the envelope", () => {
    const p: Proposal = {
      hold: 40_000_000n,
      allocations: [{ marketId: "m1", amountUsdc: 60_000_000n }],
      rationale: "x",
    };
    const v = validate(p, state(), policy());
    expect(v.kind).toBe("escalated");
    if (v.kind !== "approved") {
      expect(v.breaches.map((b) => b.invariant)).toContain("K5");
    }
  });

  it("vetoes malformed input as K8 without throwing", () => {
    for (const bad of [null, undefined, 42, "nope", [], { hold: 1 }]) {
      const v = validate(bad, state(), policy());
      expect(v.kind).toBe("vetoed");
    }
  });

  it("never throws, even when state itself is malformed", () => {
    const p: Proposal = { hold: 100_000_000n, allocations: [], rationale: "x" };
    const broken = { ...state(), markets: null } as unknown as TreasuryState;
    expect(() => validate(p, broken, policy())).not.toThrow();
  });

  it("is deterministic — the same inputs give the same verdict", () => {
    const p: Proposal = { hold: 100_000_000n, allocations: [], rationale: "x" };
    const a = validate(p, state(), policy());
    const b = validate(p, state(), policy());
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/kernel/test/validate.test.ts`
Expected: FAIL — `validate` is not exported

- [ ] **Step 3: Write `packages/kernel/src/validate.ts`**

```ts
import type { Breach, Policy, Proposal, TreasuryState, Verdict } from "@idle/core";
import {
  k1BufferCoverage, k2Conservation, k3MarketExists, k4Allowlist,
  k5Concentration, k6RunMovement, k7Liquidity, k8WellFormed,
} from "./invariants.js";

function present(breaches: (Breach | null)[]): Breach[] {
  return breaches.filter((b): b is Breach => b !== null);
}

/**
 * Validate an untrusted agent proposal against treasury state and operator
 * policy.
 *
 * Precedence is deliberate. VETO invariants are evaluated first and win
 * outright: a structurally invalid proposal must never reach a human for
 * approval, because asking someone to rubber-stamp nonsense trains them to
 * rubber-stamp. Only a proposal that is coherent in every respect can be
 * escalated for a judgment call.
 *
 * This function is total. It never throws for any input — malformed proposal,
 * malformed state, anything. A validator that can throw is a validator that
 * can be bypassed by crashing it.
 */
export function validate(proposal: unknown, state: TreasuryState, policy: Policy): Verdict {
  try {
    const malformed = k8WellFormed(proposal);
    if (malformed !== null) return { kind: "vetoed", breaches: [malformed] };

    const p = proposal as Proposal;

    const vetoes = present([
      k2Conservation(p, state),
      k1BufferCoverage(p, state, policy),
      k3MarketExists(p, state),
      k4Allowlist(p, policy),
    ]);
    if (vetoes.length > 0) return { kind: "vetoed", breaches: vetoes };

    const escalations = present([
      k5Concentration(p, state, policy),
      k6RunMovement(p, policy),
      k7Liquidity(p, state, policy),
    ]);
    if (escalations.length > 0) return { kind: "escalated", breaches: escalations };

    return { kind: "approved" };
  } catch (error) {
    return {
      kind: "vetoed",
      breaches: [{
        invariant: "K8",
        message: "validation threw; treating as structurally invalid",
        observed: error instanceof Error ? error.message : String(error),
        limit: "no exception",
      }],
    };
  }
}
```

Append to `packages/kernel/src/index.ts`:
```ts
export * from "./validate.js";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/kernel`
Expected: PASS — 38 tests

- [ ] **Step 5: Run the whole suite and the typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all packages pass, typecheck clean

- [ ] **Step 6: Record the packages in ATTRIBUTION.md**

Append to the per-file table:
```markdown
| `packages/obligations/**` | `AI` | FX table and buffer math; rates and rounding direction reviewed by the team |
| `packages/kernel/**` | `AI` | Invariants K1-K8 and validate(); invariant semantics and veto/escalate split are team decisions (see DECISIONS.md D-006) |
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add validate() with veto-over-escalate precedence

Vetoes win outright over escalations. A structurally invalid proposal must
never reach a human for approval, because asking someone to rubber-stamp
nonsense trains them to rubber-stamp.

validate() is total — it never throws for any input, including malformed
state. A validator that can throw is a validator that can be bypassed by
crashing it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Definition of done

- [ ] `pnpm test` passes — 38 kernel, 19 obligations, 11 core (68 total)
- [ ] `pnpm typecheck` is clean under `strict` with `noUncheckedIndexedAccess`
- [ ] No float appears in any exported money signature
- [ ] `validate()` returns a `Verdict` for every input in the malformed-input test set and throws for none
- [ ] `ATTRIBUTION.md` lists every package created
- [ ] Seven commits, one per task, authored by `PhantomOz`

## What this plan deliberately does not cover

This plan covers spec §4 (`core`, `obligations`, `kernel` contracts) and §5
(invariants K1–K8) in full. Deferred to later plans:

| Deferred | Blocked on | Spec section |
|---|---|---|
| `@idle/yields` | **The Graph spike** — the interface depends on what the Messari schema actually returns | §4 |
| `@idle/agent` | `yields` (it reasons over markets) | §4 |
| `@idle/wallet`, `@idle/chain` | Privy + Arc credentials | §4 |
| `apps/api` — run/intent state machine | all of the above | §6, §7, §8 |
| `apps/web` | `apps/api` | §3 |

Writing the `yields` plan before the spike reports would mean placeholders,
which this skill forbids. It gets its own plan the moment the spike lands.
