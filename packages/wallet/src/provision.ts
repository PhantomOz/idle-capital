import { usdcMinorToWei } from "@idle/chain";
import type { Address } from "viem";

const API = "https://api.privy.io";

/** Privy rejects names longer than this on both policies and rules. */
const MAX_NAME = 50;

export type ProvisionedWallet = {
  walletId: string;
  address: Address;
  policyId: string;
};

export type ProvisionArgs = {
  /** The business's name. Used to label the policy so it is findable later. */
  name: string;
  /** Per-transaction ceiling, in USDC minor units. Converted to the chain's 18. */
  perTxCeilingUsdcMinor: bigint;
  chainId: number;
};

export type PrivyProvisioner = {
  provision(args: ProvisionArgs): Promise<ProvisionedWallet>;
};

/**
 * Trim a label to something Privy will accept, without truncating mid-word
 * into nonsense when we can avoid it.
 */
export function policyLabel(name: string, suffix: string): string {
  const room = MAX_NAME - suffix.length;
  const trimmed = name.length <= room ? name : `${name.slice(0, room - 1).trimEnd()}…`;
  return `${trimmed}${suffix}`;
}

/**
 * Onboards a business: its own wallet, its own enforced spending envelope.
 *
 * The policy is created FIRST and passed to wallet creation, so the wallet is
 * born guarded. Creating the wallet first and attaching a policy afterwards
 * leaves a window — however short — in which a funded tenant wallet will sign
 * anything, and onboarding is exactly when someone is watching an address.
 *
 * The ceiling is the outer bound of the two (D-015): the kernel's per-run
 * limit is tighter and does the everyday work, while this one still holds if
 * the kernel never runs at all.
 */
export function createPrivyProvisioner(opts: {
  appId: string;
  appSecret: string;
  fetchImpl?: typeof fetch;
}): PrivyProvisioner {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers = {
    authorization: "Basic " + Buffer.from(`${opts.appId}:${opts.appSecret}`).toString("base64"),
    "privy-app-id": opts.appId,
    "content-type": "application/json",
  };

  async function call(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetchImpl(`${API}${path}`, {
      method: "POST", headers, body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    const parsed = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) {
      const detail = typeof parsed.error === "string" ? parsed.error : `HTTP ${res.status}`;
      throw new Error(`Privy POST ${path}: ${detail}`);
    }
    return parsed;
  }

  return {
    async provision({ name, perTxCeilingUsdcMinor, chainId }) {
      if (name.trim().length === 0) throw new Error("A business needs a name");
      if (perTxCeilingUsdcMinor <= 0n) {
        throw new Error(`Ceiling must be positive, got ${perTxCeilingUsdcMinor}`);
      }

      // Conditions are evaluated against the chain's native units, which on Arc
      // is 18 decimals for a token the ledger counts in 6. Converting here is
      // the difference between a 10 USDC ceiling and a 0.00000000001 one.
      const ceilingWei = usdcMinorToWei(perTxCeilingUsdcMinor);

      const policy = await call("/v1/policies", {
        version: "1.0",
        name: policyLabel(name, " treasury envelope"),
        chain_type: "ethereum",
        rules: [{
          name: "Transfers under ceiling",
          method: "eth_signTransaction",
          conditions: [
            { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: String(chainId) },
            { field_source: "ethereum_transaction", field: "value", operator: "lte", value: `0x${ceilingWei.toString(16)}` },
          ],
          action: "ALLOW",
        }],
      });
      const policyId = policy.id;
      if (typeof policyId !== "string") {
        throw new Error(`Privy returned a policy without an id: ${JSON.stringify(policy).slice(0, 200)}`);
      }

      const wallet = await call("/v1/wallets", {
        chain_type: "ethereum",
        policy_ids: [policyId],
      });
      const walletId = wallet.id;
      const address = wallet.address;
      if (typeof walletId !== "string" || typeof address !== "string") {
        throw new Error(`Privy returned an unusable wallet: ${JSON.stringify(wallet).slice(0, 200)}`);
      }

      return { walletId, address: address as Address, policyId };
    },
  };
}
