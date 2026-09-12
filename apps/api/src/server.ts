import { serve } from "@hono/node-server";
import { getLendingMarkets } from "@idle/yields";
import {
  createBusiness, listBusinesses, listObligations, openLedger, reconcile,
  setObligations, settledPositions, type Business,
} from "@idle/ledger";
import { createProposer } from "@idle/agent";
import { BASE_MAINNET, BASE_USDC, createBaseUsdcClient } from "@idle/chain";
import {
  createPrivyClient, createPrivyEarnExecutor, createPrivyProvisioner, createPrivyTreasury,
} from "@idle/wallet";
import type { Address } from "viem";
import type { Market, Position } from "@idle/core";
import { createApp, type TenantHost } from "./app.js";
import { loadPolicy } from "./config.js";
import { createStatusOnlyEarnExecutor } from "./reconciler.js";
import { loadObligations } from "./obligations-fixture.js";
import type { MarketsPort, OrchestratorDeps } from "./index.js";

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") throw new Error(`${name} is not set`);
  return v;
}
function optional(name: string): string | null {
  const v = process.env[name];
  return v === undefined || v === "" ? null : v;
}

const policy = loadPolicy(process.env);
const ledger = openLedger(process.env.LEDGER_PATH ?? ".idle/ledger.db");

const appId = required("PRIVY_APP_ID");
const appSecret = required("PRIVY_APP_SECRET");
const base = createBaseUsdcClient(required("BASE_RPC_URL"), BASE_USDC);

/**
 * The one venue this deployment can actually execute against.
 *
 * Required, not optional. It used to be optional, and with it unset the agent
 * still produced allocations and the executor still "settled" them — as plain
 * transfers to an address we owned. A deployment with no reachable venue should
 * refuse to start, not invent one. D-024.
 */
const vaultId = required("PRIVY_EARN_VAULT_ID");
const proposer = createProposer({ apiKey: required("ANTHROPIC_API_KEY") });
const provisioner = createPrivyProvisioner({ appId, appSecret });

/**
 * The venues the agent compares, shared across every business.
 *
 * Market data is not tenant-specific — the rate Aave pays is the rate Aave
 * pays. What differs per business is the treasury reading against it, and that
 * lives in `depsFor`.
 */
const markets: MarketsPort = {
  async fetch() {
    const res = await getLendingMarkets({
      apiKey: required("GRAPH_API_KEY"),
      assetSymbols: ["USDC", "USDT", "DAI"],
    });
    const out: Market[] = [...res.markets];
    {
      try {
        const v = await sharedPrivy.earnVault(vaultId);
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

/** Any wallet can read the vault's public shape; positions are read per tenant. */
const sharedPrivy = createPrivyClient({ appId, appSecret, walletId: optional("PRIVY_WALLET_ID") ?? "" });

/**
 * Build the orchestrator for exactly one business.
 *
 * Every port here is bound to that business's wallet: the balance read, the
 * Earn position, the signer and the settlement all resolve through
 * `business.walletId`. There is no ambient treasury for a run to reach.
 */
function depsFor(business: Business): OrchestratorDeps {
  const privy = createPrivyClient({ appId, appSecret, walletId: business.walletId });
  const address = business.address as Address;

  /**
   * Where this business's parked capital is, from its own books.
   *
   * The settlement leg moves USDC out of the wallet on Arc, so the balance
   * alone would show a business as poorer after every approved run and the
   * kernel's conservation check (K2) would never balance. The ledger records
   * what left under an approved decision, and that is the position.
   *
   * When the Earn vault reports a real deposit for this wallet, that is the
   * better source and takes precedence — it is the venue's own answer rather
   * than ours. On testnet it reports nothing, and we fall back to the books.
   */
  async function listPositions(): Promise<Position[]> {
    try {
      const p = await privy.earnPosition(vaultId);
      if (p.assetsInVault > 0n) {
        return [{ marketId: `privy-earn:${vaultId}`, amountUsdc: p.assetsInVault }];
      }
      // A readable vault reporting nothing means nothing is parked. Believe it.
      return [];
    } catch {
      // Only an UNREADABLE vault falls back to our own books, and only so a
      // Privy outage does not make a business look like it lost its position.
      return settledPositions(ledger, business.id);
    }
  }

  return {
    ledger,
    markets,
    treasury: createPrivyTreasury({ balances: base, address, listPositions }),
    proposer,
    execution: createPrivyEarnExecutor({ privy, vaultId }),
    policy,
    obligations: listObligations(ledger, business.id),
    now: () => new Date(),
  };
}

/**
 * There is no faucet.
 *
 * The treasury now holds real USDC on Base mainnet, and mainnet has no tap.
 * `POST /businesses/:id/fund` answers 501 with the address to send to, which is
 * the honest answer: funding a treasury is an operator action. The Arc faucet
 * that used to live here only ever moved testnet balances between two accounts
 * we controlled.
 */

/**
 * Seed the wallet provisioned by hand during the spikes as a business, once.
 *
 * It already holds testnet USDC, so a reviewer has a funded tenant to run
 * immediately rather than creating one and discovering the faucet is the only
 * way forward. Onboarding a second business exercises the real path.
 */
function seedFirstBusiness(): void {
  if (listBusinesses(ledger).length > 0) return;
  const walletId = optional("PRIVY_WALLET_ID");
  const address = optional("PRIVY_WALLET_ADDRESS");
  if (walletId === null || address === null) return;

  const b = createBusiness(ledger, {
    id: "biz_demo",
    name: process.env.SEED_BUSINESS_NAME ?? "Kesi Foods",
    walletId,
    address,
    policyId: optional("PRIVY_POLICY_ID") ?? "provisioned-by-hand",
  });
  setObligations(ledger, b.id, loadObligations(process.env));
  console.log(`seeded business ${b.name} (${b.id}) at ${b.address}`);
}

const host: TenantHost = {
  ledger, policy, markets, provisioner, depsFor,
  chainId: BASE_MAINNET.id,
  perTxCeilingUsdcMinor: BigInt(process.env.WALLET_TX_CEILING_USDC ?? "10000000"), // 10 USDC
  vaultAddress: required("PRIVY_EARN_VAULT_ADDRESS") as Address,
  usdcAddress: BASE_USDC,
};

seedFirstBusiness();

// Reconcile anything left in flight BEFORE accepting new work. D-003.
// Status-only: a sweep across every business's intents needs the chain, not a
// wallet, and must not be able to broadcast.
const report = await reconcile(ledger, createStatusOnlyEarnExecutor({
  ledger,
  clientFor: (walletId) => createPrivyClient({ appId, appSecret, walletId }),
}));
if (report.checked > 0) console.log("reconciled on startup:", report);

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: createApp(host).fetch, port });
console.log(`idle-capital api on :${port}  ${listBusinesses(ledger).length} business(es)`);
