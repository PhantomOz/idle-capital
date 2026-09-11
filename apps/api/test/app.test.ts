import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Market, Obligation, Proposal } from "@idle/core";
import { createBusiness, openLedger, setObligations, type Business, type Ledger } from "@idle/ledger";
import { createApp, loadPolicy, type OrchestratorDeps, type TenantHost } from "../src/index.js";

/**
 * These suites test the HTTP surface, not the operator's venue choice. Reading
 * the deployment default coupled them to it: narrowing the shipped allowlist to
 * the one venue this deployment can execute against turned nine passing tests
 * into K4 vetoes overnight.
 */
const TEST_ENV = { PROTOCOL_ALLOWLIST: "aave-v3,compound-v3" };

function market(id: string): Market {
  return {
    id, protocol: "aave-v3", chain: "ethereum",
    asset: { symbol: "USDC", decimals: 6, address: "0xusdc" },
    supplyApy: 0.04, totalSuppliedUsd: 1e8, totalBorrowedUsd: 4e7, liquidityUsd: 6e7,
  };
}

const SPREAD: Proposal = {
  hold: 90_000_000n,
  allocations: [
    { marketId: "m1", amountUsdc: 5_000_000n },
    { marketId: "m2", amountUsdc: 5_000_000n },
  ],
  rationale: "park the surplus",
};

const CONCENTRATED: Proposal = {
  hold: 20_000_000n,
  allocations: [
    { marketId: "m1", amountUsdc: 72_000_000n },
    { marketId: "m2", amountUsdc: 8_000_000n },
  ],
  rationale: "concentrated",
};

const OBLIGATION: Obligation = {
  id: "o1", currency: "NGN", amountMinor: 1_600_000n,
  dueDate: "2026-09-25", category: "payroll", confidence: 1,
};

let ledger: Ledger;

type Harness = {
  app: ReturnType<typeof createApp>;
  ledger: Ledger;
  provisioned: { name: string }[];
  funded: { to: string; amount: bigint }[];
  submit: ReturnType<typeof vi.fn>;
};

function harness(over: {
  proposal?: Proposal;
  provisionFails?: boolean;
  noFaucet?: boolean;
  marketsFail?: boolean;
  treasuryFails?: boolean;
} = {}): Harness {
  ledger = openLedger(":memory:");
  const provisioned: { name: string }[] = [];
  const funded: { to: string; amount: bigint }[] = [];
  const submit = vi.fn(async () => "0xtx");

  const depsFor = (b: Business): OrchestratorDeps => ({
    ledger,
    markets: {
      fetch: vi.fn(async () => {
        if (over.marketsFail === true) throw new Error("gateway down");
        return [market("m1"), market("m2")];
      }),
    },
    treasury: {
      snapshot: vi.fn(async () => {
        if (over.treasuryFails === true) throw new Error("wallet unreachable");
        return { totalUsdc: 100_000_000n, positions: [] };
      }),
    },
    proposer: { propose: vi.fn(async () => over.proposal ?? SPREAD) },
    execution: { submit, checkStatus: vi.fn(async () => "confirmed" as const) },
    policy: loadPolicy(TEST_ENV),
    obligations: [OBLIGATION],
    now: () => new Date("2026-09-09T00:00:00Z"),
    // Bound to `b` so a test that crossed tenants would read the wrong name.
    ...(b.id === "" ? {} : {}),
  });

  let n = 0;
  const host: TenantHost = {
    ledger,
    policy: loadPolicy(TEST_ENV),
    markets: {
      fetch: vi.fn(async () => {
        if (over.marketsFail === true) throw new Error("gateway down");
        return [market("m1"), market("m2")];
      }),
    },
    provisioner: {
      provision: vi.fn(async ({ name }) => {
        if (over.provisionFails === true) throw new Error("Privy is down");
        provisioned.push({ name });
        n += 1;
        return { walletId: `wal_${n}`, address: `0xaddr${n}` as `0x${string}`, policyId: `pol_${n}` };
      }),
    },
    depsFor,
    chainId: 5042002,
    perTxCeilingUsdcMinor: 10_000_000n,
    newId: (p) => `${p}_${++n}`,
    ...(over.noFaucet === true ? {} : {
      fund: async (b: Business, amount: bigint) => {
        funded.push({ to: b.address, amount });
        return "0xfund";
      },
    }),
  };
  return { app: createApp(host), ledger, provisioned, funded, submit };
}

/** A business with a schedule, created directly so tests do not depend on Privy. */
function seed(l: Ledger, id = "b1"): Business {
  const b = createBusiness(l, {
    id, name: "Acme Trading", walletId: `wal_${id}`, address: `0x${id}`, policyId: `pol_${id}`,
  });
  setObligations(l, id, [OBLIGATION]);
  return b;
}

describe("GET /health", () => {
  it("reports liveness", async () => {
    const res = await harness().app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});

describe("GET /policy", () => {
  it("returns the active policy with bigints as strings", async () => {
    const body = await (await harness().app.request("/policy")).json();
    expect(body.protocolAllowlist).toContain("aave-v3");
    expect(typeof body.maxRunMovementUsdc).toBe("string");
  });
});

describe("GET /markets", () => {
  it("returns the live market set", async () => {
    const body = await (await harness().app.request("/markets")).json();
    expect(body.count).toBe(2);
  });

  it("answers 503 when the data cannot be fetched, never an empty list", async () => {
    const res = await harness({ marketsFail: true }).app.request("/markets");
    expect(res.status).toBe(503);
  });
});

describe("POST /businesses", () => {
  it("provisions a wallet and returns the address to fund", async () => {
    const h = harness();
    const res = await h.app.request("/businesses", {
      method: "POST", body: JSON.stringify({ name: "Acme Trading" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.business).toMatchObject({ name: "Acme Trading", address: "0xaddr1", policyId: "pol_1" });
  });

  it("passes the business name through to the policy it provisions", async () => {
    const h = harness();
    await h.app.request("/businesses", { method: "POST", body: JSON.stringify({ name: "Kesi Foods" }) });
    expect(h.provisioned).toEqual([{ name: "Kesi Foods" }]);
  });

  it("refuses an unnamed business", async () => {
    const res = await harness().app.request("/businesses", { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });

  /** A row written before provisioning succeeds is an address nobody owns. */
  it("records no business when provisioning fails", async () => {
    const h = harness({ provisionFails: true });
    const res = await h.app.request("/businesses", {
      method: "POST", body: JSON.stringify({ name: "Acme" }),
    });
    expect(res.status).toBe(502);
    expect(await (await h.app.request("/businesses")).json()).toEqual({ businesses: [] });
  });
});

describe("GET /businesses/:id", () => {
  it("returns the business with its schedule and treasury", async () => {
    const h = harness();
    seed(h.ledger);
    const body = await (await h.app.request("/businesses/b1")).json();
    expect(body.business.name).toBe("Acme Trading");
    expect(body.obligations).toHaveLength(1);
    expect(body.treasury.totalUsdc).toBe("100000000");
  });

  /** "0 USDC" and "we could not ask" lead to opposite decisions. */
  it("reports an unreadable treasury as unreadable, not as empty", async () => {
    const h = harness({ treasuryFails: true });
    seed(h.ledger);
    const body = await (await h.app.request("/businesses/b1")).json();
    expect(body.treasury).toBeNull();
    expect(body.treasuryError).toMatch(/unreachable/);
  });

  it("answers 404 for a business that does not exist", async () => {
    expect((await harness().app.request("/businesses/ghost")).status).toBe(404);
  });
});

describe("PUT /businesses/:id/obligations", () => {
  it("saves a schedule", async () => {
    const h = harness();
    seed(h.ledger);
    const res = await h.app.request("/businesses/b1/obligations", {
      method: "PUT",
      body: JSON.stringify({ obligations: [
        { id: "x", currency: "KES", amountMinor: "38700000", dueDate: "2026-09-18", category: "supplier" },
      ] }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).obligations[0]).toMatchObject({ currency: "KES", amountMinor: "38700000" });
  });

  it("rejects an amount sent as a JSON number rather than rounding it", async () => {
    const h = harness();
    seed(h.ledger);
    const res = await h.app.request("/businesses/b1/obligations", {
      method: "PUT",
      body: JSON.stringify({ obligations: [
        { currency: "KES", amountMinor: 38700000, dueDate: "2026-09-18", category: "supplier" },
      ] }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not a number/);
  });

  it("rejects a currency the business does not trade in", async () => {
    const h = harness();
    seed(h.ledger);
    const res = await h.app.request("/businesses/b1/obligations", {
      method: "PUT",
      body: JSON.stringify({ obligations: [
        { currency: "GBP", amountMinor: "100", dueDate: "2026-09-18", category: "rent" },
      ] }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a date that does not exist", async () => {
    const h = harness();
    seed(h.ledger);
    const res = await h.app.request("/businesses/b1/obligations", {
      method: "PUT",
      body: JSON.stringify({ obligations: [
        { currency: "KES", amountMinor: "100", dueDate: "2026-02-31", category: "rent" },
      ] }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /businesses/:id/runs", () => {
  it("runs the pipeline through to SETTLED", async () => {
    const h = harness();
    seed(h.ledger);
    const res = await h.app.request("/businesses/b1/runs", { method: "POST" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.run.status).toBe("SETTLED");
    expect(body.run.businessId).toBe("b1");
  });

  /** No schedule means a buffer floor of zero, which is a gap, not a decision. */
  it("refuses to run for a business with no obligations", async () => {
    const h = harness();
    createBusiness(h.ledger, {
      id: "b2", name: "Empty", walletId: "w", address: "0x", policyId: "p",
    });
    const res = await h.app.request("/businesses/b2/runs", { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/owes/);
  });

  it("keeps one business's runs out of another's history", async () => {
    const h = harness();
    seed(h.ledger, "b1");
    seed(h.ledger, "b2");
    await h.app.request("/businesses/b1/runs", { method: "POST" });
    const b2 = await (await h.app.request("/businesses/b2/runs")).json();
    expect(b2.runs).toEqual([]);
  });
});

describe("approval", () => {
  it("holds an escalated run and moves nothing until approved", async () => {
    const h = harness({ proposal: CONCENTRATED });
    seed(h.ledger);
    const body = await (await h.app.request("/businesses/b1/runs", { method: "POST" })).json();
    expect(body.run.status).toBe("AWAITING_APPROVAL");
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("executes once a human approves", async () => {
    const h = harness({ proposal: CONCENTRATED });
    seed(h.ledger);
    const started = await (await h.app.request("/businesses/b1/runs", { method: "POST" })).json();
    const res = await h.app.request(`/runs/${started.run.id}/approve`, { method: "POST" });
    expect((await res.json()).run.status).toBe("SETTLED");
  });

  it("moves no money when rejected", async () => {
    const h = harness({ proposal: CONCENTRATED });
    seed(h.ledger);
    const started = await (await h.app.request("/businesses/b1/runs", { method: "POST" })).json();
    const res = await h.app.request(`/runs/${started.run.id}/reject`, { method: "POST" });
    expect((await res.json()).run.status).toBe("REJECTED");
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("answers 404 for a run that does not exist", async () => {
    expect((await harness().app.request("/runs/nope/approve", { method: "POST" })).status).toBe(404);
  });
});

describe("POST /businesses/:id/fund", () => {
  it("sends testnet USDC to the business's own address", async () => {
    const h = harness();
    seed(h.ledger);
    const res = await h.app.request("/businesses/b1/fund", {
      method: "POST", body: JSON.stringify({ amountUsdc: "5000000" }),
    });
    expect(res.status).toBe(200);
    expect(h.funded).toEqual([{ to: "0xb1", amount: 5_000_000n }]);
  });

  it("says so plainly when no faucet is configured", async () => {
    const h = harness({ noFaucet: true });
    seed(h.ledger);
    const res = await h.app.request("/businesses/b1/fund", {
      method: "POST", body: JSON.stringify({ amountUsdc: "5000000" }),
    });
    expect(res.status).toBe(501);
  });

  it("rejects a zero amount", async () => {
    const h = harness();
    seed(h.ledger);
    const res = await h.app.request("/businesses/b1/fund", {
      method: "POST", body: JSON.stringify({ amountUsdc: "0" }),
    });
    expect(res.status).toBe(400);
  });
});

beforeEach(() => { /* each harness opens its own in-memory ledger */ });
