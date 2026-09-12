/**
 * Replace a business's wallet policy with one that authorises Base.
 *
 * Wallets provisioned before D-026 carry a single rule: `eth_signTransaction`
 * where `chain_id == 5042002`. Privy's policy engine denies anything no rule
 * allows, so on Base that policy is not merely unhelpful — it is a closed door,
 * and a wallet holding real USDC cannot move it anywhere, including out.
 *
 * This creates the correct envelope and PATCHes the wallet onto it. The wallet,
 * its address and its balance are untouched; only the rules change.
 *
 *   tsx --env-file-if-exists=.env apps/api/src/repolicy.ts            # every business
 *   tsx --env-file-if-exists=.env apps/api/src/repolicy.ts biz_demo   # just one
 *
 * Idempotent in the only sense that matters: running it twice leaves the wallet
 * guarded by a correct policy. It does leave the superseded policy behind, since
 * Privy exposes no way to list or delete policies.
 */
import { earnPolicyRules, policyLabel } from "@idle/wallet";
import { getBusiness, listBusinesses, openLedger, setBusinessPolicy } from "@idle/ledger";

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") throw new Error(`${name} is not set`);
  return v;
}

const appId = required("PRIVY_APP_ID");
const appSecret = required("PRIVY_APP_SECRET");
const ceiling = BigInt(process.env.WALLET_TX_CEILING_USDC ?? "10000000");

const headers = {
  authorization: "Basic " + Buffer.from(`${appId}:${appSecret}`).toString("base64"),
  "privy-app-id": appId,
  "content-type": "application/json",
};

async function call(path: string, method: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.privy.io${path}`, {
    method, headers, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000),
  });
  const parsed = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    const detail = typeof parsed.error === "string" ? parsed.error : `HTTP ${res.status}`;
    throw new Error(`Privy ${method} ${path}: ${detail}`);
  }
  return parsed;
}

const ledger = openLedger(process.env.LEDGER_PATH ?? ".idle/ledger.db");
const only = process.argv[2];
const targets = only === undefined
  ? listBusinesses(ledger)
  : [getBusiness(ledger, only)].filter((b): b is NonNullable<typeof b> => b !== null);

if (targets.length === 0) {
  console.error(only === undefined ? "No businesses to repolicy" : `No business ${only}`);
  process.exit(1);
}

for (const b of targets) {
  console.log(`\n${b.name} (${b.id})`);
  console.log(`  wallet ${b.address}`);
  console.log(`  policy ${b.policyId} -> creating a Base envelope`);

  const policy = await call("/v1/policies", "POST", {
    version: "1.0",
    name: policyLabel(b.name, " Base envelope"),
    chain_type: "ethereum",
    rules: earnPolicyRules({
      perTxCeilingUsdcMinor: ceiling,
      vaultId: required("PRIVY_EARN_VAULT_ID"),
    }),
  });
  const policyId = policy.id;
  if (typeof policyId !== "string") throw new Error("Privy returned a policy without an id");

  // Replace rather than append. Leaving the Arc policy attached would leave a
  // rule set in force that denies by default on the chain we now use.
  await call(`/v1/wallets/${b.walletId}`, "PATCH", { policy_ids: [policyId] });
  setBusinessPolicy(ledger, b.id, policyId);
  console.log(`  policy ${policyId} attached, ledger updated`);
}

ledger.close();
console.log(`\nRepolicied ${targets.length} wallet(s).`);
