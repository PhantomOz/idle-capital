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
    protocolAllowlist: ["aave-v3"], maxVenueConcentrationBps: 5_000,
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
