import { describe, expect, it } from "vitest";
import type { Market, Policy, Proposal, TreasuryState } from "@idle/core";
import {
  k1BufferCoverage, k2Conservation, k3MarketExists, k4Allowlist,
  k5Concentration, k6RunMovement, k7Liquidity, k8WellFormed,
} from "../src/index.js";

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
    protocolAllowlist: ["aave-v3"],
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
  it("passes when the target market's protocol is allowlisted", () => {
    const p: Proposal = { hold: 0n, allocations: [{ marketId: "m2", amountUsdc: 1n }], rationale: "x" };
    expect(k4Allowlist(p, state(), policy())).toBeNull();
  });

  it("rejects a market whose protocol is not allowlisted", () => {
    const s = state({ markets: [market("m1"), market("m2", { protocol: "rari-fuse" })] });
    const p: Proposal = { hold: 0n, allocations: [{ marketId: "m2", amountUsdc: 1n }], rationale: "x" };
    const b = k4Allowlist(p, s, policy());
    expect(b?.invariant).toBe("K4");
    expect(b?.observed).toContain("rari-fuse");
  });

  it("allows every market of an allowlisted protocol without enumerating them", () => {
    const s = state({ markets: [market("usdc"), market("dai"), market("weth")] });
    const p: Proposal = {
      hold: 0n,
      allocations: [{ marketId: "usdc", amountUsdc: 1n }, { marketId: "dai", amountUsdc: 1n }],
      rationale: "x",
    };
    expect(k4Allowlist(p, s, policy())).toBeNull();
  });

  it("defers to K3 for a market that is not in the live set at all", () => {
    const p: Proposal = { hold: 0n, allocations: [{ marketId: "ghost", amountUsdc: 1n }], rationale: "x" };
    expect(k4Allowlist(p, state(), policy())).toBeNull();
  });
});

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
