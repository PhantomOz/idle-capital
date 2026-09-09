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
      allocations: [
        { marketId: "m1", amountUsdc: 5_000_000n },
        { marketId: "m2", amountUsdc: 5_000_000n },
      ],
      rationale: "park the surplus",
    }) },
    execution: { submit: vi.fn(async () => "0xtx"), checkStatus: vi.fn(async () => "confirmed" as const) },
    policy: loadPolicy({}),
    obligations: [],
    now: () => new Date("2026-09-09T00:00:00Z"),
  };
}

const CONCENTRATED: Proposal = {
  hold: 20_000_000n,
  allocations: [
    { marketId: "m1", amountUsdc: 72_000_000n },
    { marketId: "m2", amountUsdc: 8_000_000n },
  ],
  rationale: "concentrated",
};

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
    const down = createApp({ ...d, markets: { fetch: async () => { throw new Error("quorum not met"); } } });
    const res = await down.request("/markets");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("quorum");
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
    const d2 = deps(CONCENTRATED);
    const a2 = createApp(d2);
    const created = await (await a2.request("/runs", { method: "POST" })).json();
    expect(created.run.status).toBe("AWAITING_APPROVAL");

    const res = await a2.request(`/runs/${created.run.id}/approve`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json()).run.status).toBe("SETTLED");
  });

  it("rejects an escalated run without moving money", async () => {
    const d2 = deps(CONCENTRATED);
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
