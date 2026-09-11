import { Hono } from "hono";
import {
  createBusiness, getBusiness, getRun, listBusinesses, listIntents,
  listObligations, listRunsForBusiness, setObligations,
  type Business, type Ledger,
} from "@idle/ledger";
import type { Policy } from "@idle/core";
import type { PrivyProvisioner } from "@idle/wallet";
import { approveRun, rejectRun, startRun, type OrchestratorDeps } from "./orchestrator.js";
import { BadRequestError, parseBusinessName, parseFundAmount, parseObligations } from "./parse.js";
import type { MarketsPort } from "./ports.js";

/**
 * bigint has no JSON representation. Every amount crosses the wire as a
 * decimal string — the frontend parses it back, and nothing is silently
 * rounded through a double on the way.
 */
function jsonSafe<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v: unknown) =>
    typeof v === "bigint" ? v.toString() : v)) as unknown;
}

/**
 * Everything the HTTP layer needs that is not specific to one business.
 *
 * `depsFor` is the tenancy seam: the orchestrator is built per request against
 * one business's wallet and one business's schedule, so there is no path by
 * which a run reads a treasury it does not belong to.
 */
export type TenantHost = {
  ledger: Ledger;
  policy: Policy;
  markets: MarketsPort;
  provisioner: PrivyProvisioner;
  depsFor(business: Business): OrchestratorDeps;
  /** Testnet convenience: send USDC to a newly provisioned wallet. */
  fund?(business: Business, amountUsdcMinor: bigint): Promise<string>;
  chainId: number;
  perTxCeilingUsdcMinor: bigint;
  newId?(prefix: string): string;
};

function defaultId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function fail(e: unknown, fallback: string): { error: string; status: 400 | 500 } {
  if (e instanceof BadRequestError) return { error: e.message, status: 400 };
  return { error: e instanceof Error ? e.message : fallback, status: 500 };
}

export function createApp(host: TenantHost): Hono {
  const app = new Hono();
  const newId = host.newId ?? defaultId;

  /** Resolve `:id` to a business, or answer 404 once, here. */
  function business(id: string): Business {
    const b = getBusiness(host.ledger, id);
    if (b === null) throw new BadRequestError("business not found");
    return b;
  }

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/policy", (c) => c.json(jsonSafe(host.policy)));

  app.get("/markets", async (c) => {
    try {
      const markets = await host.markets.fetch();
      return c.json(jsonSafe({ markets, count: markets.length }));
    } catch (e) {
      // 503, not 200-with-empty. A treasury UI showing "no markets" when the
      // truth is "we could not ask" is worse than an honest error.
      return c.json({ error: e instanceof Error ? e.message : "market data unavailable" }, 503);
    }
  });

  // ── Businesses ───────────────────────────────────────────────────────────

  app.post("/businesses", async (c) => {
    let name: string;
    try {
      name = parseBusinessName(await c.req.json().catch(() => null));
    } catch (e) {
      const f = fail(e, "bad request");
      return c.json({ error: f.error }, f.status);
    }
    try {
      // Provision first, persist second. A row written before the wallet
      // exists is a funding address nobody owns.
      const wallet = await host.provisioner.provision({
        name,
        perTxCeilingUsdcMinor: host.perTxCeilingUsdcMinor,
        chainId: host.chainId,
      });
      const b = createBusiness(host.ledger, { id: newId("biz"), name, ...wallet });
      return c.json(jsonSafe({ business: b }), 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "could not onboard" }, 502);
    }
  });

  app.get("/businesses", (c) => c.json(jsonSafe({ businesses: listBusinesses(host.ledger) })));

  app.get("/businesses/:id", async (c) => {
    let b: Business;
    try { b = business(c.req.param("id")); } catch { return c.json({ error: "business not found" }, 404); }

    const obligations = listObligations(host.ledger, b.id);
    const runs = listRunsForBusiness(host.ledger, b.id);
    let treasury: unknown = null;
    let treasuryError: string | null = null;
    try {
      treasury = await host.depsFor(b).treasury.snapshot();
    } catch (e) {
      // A wallet that cannot be read is reported as unreadable, never as empty.
      // "0 USDC" and "we could not ask" lead to opposite decisions.
      treasuryError = e instanceof Error ? e.message : "treasury unavailable";
    }
    return c.json(jsonSafe({ business: b, treasury, treasuryError, obligations, runs }));
  });

  app.put("/businesses/:id/obligations", async (c) => {
    let b: Business;
    try { b = business(c.req.param("id")); } catch { return c.json({ error: "business not found" }, 404); }
    try {
      const obligations = parseObligations(await c.req.json().catch(() => null));
      return c.json(jsonSafe({ obligations: setObligations(host.ledger, b.id, obligations) }));
    } catch (e) {
      const f = fail(e, "could not save the schedule");
      return c.json({ error: f.error }, f.status);
    }
  });

  app.post("/businesses/:id/fund", async (c) => {
    let b: Business;
    try { b = business(c.req.param("id")); } catch { return c.json({ error: "business not found" }, 404); }
    if (host.fund === undefined) {
      return c.json({ error: "this deployment has no faucet configured" }, 501);
    }
    try {
      const amountUsdc = parseFundAmount(await c.req.json().catch(() => null));
      return c.json({ txRef: await host.fund(b, amountUsdc) });
    } catch (e) {
      const f = fail(e, "could not fund");
      return c.json({ error: f.error }, f.status);
    }
  });

  // ── Runs, always under a business ────────────────────────────────────────

  app.post("/businesses/:id/runs", async (c) => {
    let b: Business;
    try { b = business(c.req.param("id")); } catch { return c.json({ error: "business not found" }, 404); }
    if (listObligations(host.ledger, b.id).length === 0) {
      // Without a schedule the buffer floor is zero and the agent would be
      // invited to park everything. That is not a decision, it is a gap.
      return c.json({ error: "add what this business owes before running the agent" }, 409);
    }
    const runId = newId("run");
    const run = await startRun(host.depsFor(b), runId, b.id);
    return c.json(jsonSafe({ run, intents: listIntents(host.ledger, runId) }), 201);
  });

  app.get("/businesses/:id/runs", (c) => {
    try {
      const b = business(c.req.param("id"));
      return c.json(jsonSafe({ runs: listRunsForBusiness(host.ledger, b.id) }));
    } catch { return c.json({ error: "business not found" }, 404); }
  });

  app.get("/runs/:id", (c) => {
    const run = getRun(host.ledger, c.req.param("id"));
    if (run === null) return c.json({ error: "run not found" }, 404);
    return c.json(jsonSafe({ run, intents: listIntents(host.ledger, run.id) }));
  });

  /** A run carries its business, so approval resolves the right wallet. */
  function depsForRun(runId: string): { deps: OrchestratorDeps } | { error: string; status: 404 | 409 } {
    const run = getRun(host.ledger, runId);
    if (run === null) return { error: "run not found", status: 404 };
    if (run.businessId === null) return { error: "run predates tenancy and cannot be acted on", status: 409 };
    const b = getBusiness(host.ledger, run.businessId);
    if (b === null) return { error: "the business for this run no longer exists", status: 409 };
    return { deps: host.depsFor(b) };
  }

  app.post("/runs/:id/approve", async (c) => {
    const id = c.req.param("id");
    const resolved = depsForRun(id);
    if ("error" in resolved) return c.json({ error: resolved.error }, resolved.status);
    try {
      const run = await approveRun(resolved.deps, id);
      return c.json(jsonSafe({ run, intents: listIntents(host.ledger, id) }));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "cannot approve" }, 409);
    }
  });

  app.post("/runs/:id/reject", (c) => {
    const id = c.req.param("id");
    const resolved = depsForRun(id);
    if ("error" in resolved) return c.json({ error: resolved.error }, resolved.status);
    try {
      return c.json(jsonSafe({ run: rejectRun(host.ledger, id) }));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "cannot reject" }, 409);
    }
  });

  return app;
}
