import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Market, Obligation, Proposal } from "@idle/core";
import { getRun, listIntents, openLedger } from "@idle/ledger";
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
  // Two venues, not one: a single-venue target is 100% concentrated and K5
  // escalates it, which is correct but makes a poor happy-path fixture.
  const proposal: Proposal = {
    hold: 90_000_000n,
    allocations: [
      { marketId: "m1", amountUsdc: 5_000_000n },
      { marketId: "m2", amountUsdc: 5_000_000n },
    ],
    rationale: "NGN payroll on the 20th; park the surplus across Aave and Compound.",
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
      // hold covers the buffer, so K1 passes and K5 is what actually fires
      hold: 20_000_000n,
      allocations: [
        { marketId: "m1", amountUsdc: 72_000_000n },
        { marketId: "m2", amountUsdc: 8_000_000n },
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
        positions: [
          { marketId: "m1", amountUsdc: 5_000_000n },
          { marketId: "m2", amountUsdc: 5_000_000n },
        ],
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
      hold: 20_000_000n,
      allocations: [
        { marketId: "m1", amountUsdc: 72_000_000n },
        { marketId: "m2", amountUsdc: 8_000_000n },
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
