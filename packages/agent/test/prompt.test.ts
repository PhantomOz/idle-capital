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
    markets: [
      market("aave-v3:0xa"),
      market("rari-fuse:0xr", { protocol: "rari-fuse", supplyApy: 127281.98, liquidityUsd: -4_700_000 }),
    ],
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

describe("buildPrompt market sections", () => {
  /**
   * The regression that cost a live run. On real Graph data the top rates are
   * all abandoned subgraphs, so a single rate-sorted list truncated to N rows
   * contained zero allowlisted venues and the agent parked nothing.
   */
  it("shows an allowlisted venue even when forbidden venues out-rate it by orders of magnitude", () => {
    const junk = Array.from({ length: 40 }, (_, i) =>
      market(`rari-fuse:0x${i}`, { protocol: "rari-fuse", supplyApy: 1_000 + i, liquidityUsd: -5_000 }),
    );
    const p = buildPrompt(ctx({ markets: [...junk, market("aave-v3:0xa", { supplyApy: 0.037 })] }));
    expect(p).toContain("aave-v3:0xa");
  });

  it("caps the forbidden list so the prompt cannot be flooded", () => {
    const junk = Array.from({ length: 90 }, (_, i) =>
      market(`rari-fuse:0x${i}`, { protocol: "rari-fuse", supplyApy: 1_000 + i }),
    );
    const p = buildPrompt(ctx({ markets: [...junk, market("aave-v3:0xa")] }));
    expect(p.split("rari-fuse:0x").length - 1).toBe(20);
  });

  it("separates the two lists so allowed and forbidden are never read as one table", () => {
    const p = buildPrompt(ctx());
    expect(p).toContain("VENUES THAT MAY RECEIVE FUNDS");
    expect(p).toContain("comparison only, funds may not enter");
    expect(p.indexOf("VENUES THAT MAY RECEIVE FUNDS")).toBeLessThan(p.indexOf("EVERY OTHER VENUE"));
  });

  it("says so plainly when no venue may receive funds", () => {
    const p = buildPrompt(ctx({ markets: [market("rari-fuse:0xr", { protocol: "rari-fuse" })] }));
    expect(p).toContain("nothing may receive funds this run");
  });
});

describe("buildPrompt arithmetic", () => {
  /**
   * A live run proposed a hold 450 minor units under the floor because the
   * prompt gave it the buffer and the multiplier and left the ceiling division
   * to the model. The kernel vetoed it. The prompt now states the finished
   * number, computed by the same function the kernel validates with.
   */
  it("states the hold floor as a finished number, not a multiplication to perform", () => {
    const p = buildPrompt(ctx({ bufferRequiredUsdc: 6_100_000n }));
    expect(p).toContain("hold AT LEAST 7015000");
  });

  it("rounds the floor UP, so a fractional requirement never under-reserves", () => {
    // 1_000_001 x 11500bps = 1_150_001.15 -> 1_150_002
    const p = buildPrompt(ctx({ bufferRequiredUsdc: 1_000_001n }));
    expect(p).toContain("hold AT LEAST 1150002");
  });

  it("states the deployable ceiling so the agent need not subtract either", () => {
    const p = buildPrompt(ctx({ totalUsdc: 11_999_550n, bufferRequiredUsdc: 6_100_000n }));
    expect(p).toContain("most you may park this run: 4984550");
  });

  it("reports zero deployable rather than a negative when obligations exceed the treasury", () => {
    const p = buildPrompt(ctx({ totalUsdc: 1_000_000n, bufferRequiredUsdc: 6_100_000n }));
    expect(p).toContain("most you may park this run: 0");
  });
});

describe("parseProposal transport artefacts", () => {
  const base = { hold: "1", allocations: [], rationale: "because" };

  it("accepts a number wrapped in literal quote characters, as models sometimes emit", () => {
    expect(parseProposal({ ...base, hold: '"7015000"' })?.hold).toBe(7_015_000n);
  });

  it("unwraps quoted allocation amounts too", () => {
    const p = parseProposal({
      ...base,
      allocations: [{ marketId: "aave-v3:0xa", amountUsdc: '"1500000"' }],
    });
    expect(p?.allocations[0]?.amountUsdc).toBe(1_500_000n);
  });

  it("still rejects a non-integer inside the quotes", () => {
    expect(parseProposal({ ...base, hold: '"1.5"' })).toBeNull();
  });

  it("still rejects an empty quoted string", () => {
    expect(parseProposal({ ...base, hold: '""' })).toBeNull();
  });

  it("still rejects an unbalanced quote", () => {
    expect(parseProposal({ ...base, hold: '"7015000' })).toBeNull();
  });
});
