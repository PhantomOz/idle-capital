import { describe, expect, it } from "vitest";
import type { Market, Policy, Proposal, TreasuryState } from "@idle/core";
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
