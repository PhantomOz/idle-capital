import { Hono } from "hono";
import { getRun, listIntents, listRuns } from "@idle/ledger";
import { approveRun, rejectRun, startRun, type OrchestratorDeps } from "./orchestrator.js";

/**
 * bigint has no JSON representation. Every amount crosses the wire as a
 * decimal string — the frontend parses it back, and nothing is silently
 * rounded through a double on the way.
 */
function jsonSafe<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v: unknown) =>
    typeof v === "bigint" ? v.toString() : v)) as unknown;
}

export function createApp(deps: OrchestratorDeps): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/policy", (c) => c.json(jsonSafe(deps.policy)));

  app.get("/markets", async (c) => {
    try {
      const markets = await deps.markets.fetch();
      return c.json(jsonSafe({ markets, count: markets.length }));
    } catch (e) {
      // 503, not 200-with-empty. A treasury UI showing "no markets" when the
      // truth is "we could not ask" is worse than an honest error.
      return c.json({ error: e instanceof Error ? e.message : "market data unavailable" }, 503);
    }
  });

  app.post("/runs", async (c) => {
    const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const run = await startRun(deps, runId);
    return c.json(jsonSafe({ run, intents: listIntents(deps.ledger, runId) }), 201);
  });

  app.get("/runs", (c) => c.json(jsonSafe({ runs: listRuns(deps.ledger) })));

  app.get("/runs/:id", (c) => {
    const run = getRun(deps.ledger, c.req.param("id"));
    if (run === null) return c.json({ error: "run not found" }, 404);
    return c.json(jsonSafe({ run, intents: listIntents(deps.ledger, run.id) }));
  });

  app.post("/runs/:id/approve", async (c) => {
    const id = c.req.param("id");
    if (getRun(deps.ledger, id) === null) return c.json({ error: "run not found" }, 404);
    try {
      const run = await approveRun(deps, id);
      return c.json(jsonSafe({ run, intents: listIntents(deps.ledger, id) }));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "cannot approve" }, 409);
    }
  });

  app.post("/runs/:id/reject", (c) => {
    const id = c.req.param("id");
    if (getRun(deps.ledger, id) === null) return c.json({ error: "run not found" }, 404);
    try {
      return c.json(jsonSafe({ run: rejectRun(deps.ledger, id) }));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "cannot reject" }, 409);
    }
  });

  return app;
}
