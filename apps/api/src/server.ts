import { serve } from "@hono/node-server";
import { getLendingMarkets } from "@idle/yields";
import { openLedger, reconcile } from "@idle/ledger";
import { createProposer } from "@idle/agent";
import { createArcClient } from "@idle/chain";
import { createPrivyArcExecutor, createPrivyClient, createPrivyTreasury } from "@idle/wallet";
import type { Address } from "viem";
import type { Market, Position } from "@idle/core";
import { createApp } from "./app.js";
import { loadPolicy } from "./config.js";
import { DEMO_OBLIGATIONS } from "./obligations-fixture.js";
import type { MarketsPort, OrchestratorDeps } from "./index.js";

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") throw new Error(`${name} is not set`);
  return v;
}

const policy = loadPolicy(process.env);
const ledger = openLedger(process.env.LEDGER_PATH ?? ".idle/ledger.db");

const arc = createArcClient(required("ARC_RPC_URL"));
const address = required("PRIVY_WALLET_ADDRESS") as Address;
const vaultId = process.env.PRIVY_EARN_VAULT_ID ?? "";

const privy = createPrivyClient({
  appId: required("PRIVY_APP_ID"),
  appSecret: required("PRIVY_APP_SECRET"),
  walletId: required("PRIVY_WALLET_ID"),
});

/**
 * The market set the agent reasons over.
 *
 * The Graph supplies breadth — every standardized lending market across 25
 * protocols, which is what makes the comparison meaningful. The Privy Earn
 * vault is appended because it is the one venue this treasury can actually
 * execute against, and a comparison that omits the executable option is not a
 * comparison.
 */
const markets: MarketsPort = {
  async fetch() {
    const res = await getLendingMarkets({
      apiKey: required("GRAPH_API_KEY"),
      assetSymbols: ["USDC", "USDT", "DAI"],
    });
    const out: Market[] = [...res.markets];
    if (vaultId !== "") {
      try {
        const v = await privy.earnVault(vaultId);
        out.push({
          id: `privy-earn:${v.id}`,
          protocol: "privy-earn",
          chain: "base",
          asset: { symbol: "USDC", decimals: 6, address: "" },
          supplyApy: v.userApyBps / 10_000,
          totalSuppliedUsd: v.availableLiquidityUsd,
          totalBorrowedUsd: 0,
          liquidityUsd: v.availableLiquidityUsd,
        });
      } catch { /* a vault we cannot read is simply not offered this run */ }
    }
    return out;
  },
};

/** Parked capital lives in the Earn vault. Nothing else parks anything. */
async function listPositions(): Promise<Position[]> {
  if (vaultId === "") return [];
  try {
    const p = await privy.earnPosition(vaultId);
    return p.assetsInVault > 0n
      ? [{ marketId: `privy-earn:${vaultId}`, amountUsdc: p.assetsInVault }]
      : [];
  } catch { return []; }
}

const treasury = createPrivyTreasury({ arc, address, listPositions });

const execution = createPrivyArcExecutor({
  arc, privy, address,
  settlementAddress: (process.env.SETTLEMENT_ADDRESS ?? address) as Address,
});

const deps: OrchestratorDeps = {
  ledger, markets, treasury,
  proposer: createProposer({ apiKey: required("ANTHROPIC_API_KEY") }),
  execution, policy,
  obligations: DEMO_OBLIGATIONS,
  now: () => new Date(),
};

// Reconcile anything left in flight BEFORE accepting new work. D-003.
const report = await reconcile(ledger, execution);
if (report.checked > 0) console.log("reconciled on startup:", report);

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: createApp(deps).fetch, port });
console.log(`idle-capital api on :${port}  wallet ${address}`);
