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
