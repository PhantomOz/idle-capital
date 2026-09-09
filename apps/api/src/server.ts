import { serve } from "@hono/node-server";
import { getLendingMarkets } from "@idle/yields";
import { openLedger, reconcile, type ExecutionPort } from "@idle/ledger";
import { createApp } from "./app.js";
import { loadPolicy } from "./config.js";
import type { MarketsPort, OrchestratorDeps, ProposerPort, TreasuryPort } from "./index.js";

const policy = loadPolicy(process.env);
const ledger = openLedger(process.env.LEDGER_PATH ?? ".idle/ledger.db");

const markets: MarketsPort = {
  async fetch() {
    const key = process.env.GRAPH_API_KEY;
    if (key === undefined || key === "") throw new Error("GRAPH_API_KEY is not set");
    const res = await getLendingMarkets({ apiKey: key, assetSymbols: ["USDC", "USDT", "DAI"] });
    return res.markets;
  },
};

// Placeholder adapters. Replaced by the Privy and Anthropic implementations;
// the interfaces do not change when they are.
const treasury: TreasuryPort = {
  async snapshot() {
    throw new Error("TreasuryPort not wired yet — Privy adapter pending");
  },
};
const proposer: ProposerPort = {
  async propose() {
    throw new Error("ProposerPort not wired yet — agent pending");
  },
};
const execution: ExecutionPort = {
  async submit() { throw new Error("ExecutionPort not wired yet — Privy/Arc adapters pending"); },
  async checkStatus() { throw new Error("ExecutionPort not wired yet"); },
};

const deps: OrchestratorDeps = {
  ledger, markets, treasury, proposer, execution, policy,
  obligations: [], now: () => new Date(),
};

// Reconcile anything left in flight BEFORE accepting new work. D-003.
await reconcile(ledger, execution).catch(() => { /* nothing in flight on a cold start */ });

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: createApp(deps).fetch, port });
console.log(`idle-capital api on :${port}`);
