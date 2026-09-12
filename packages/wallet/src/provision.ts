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
  /** Per-transaction ceiling, in USDC minor units (6dp) — the ledger's own unit. */
  perTxCeilingUsdcMinor: bigint;
  chainId: number;
  /** The ERC-4626 vault this wallet may move capital into, and nowhere else. */
  vaultAddress: Address;
  /** The USDC contract this wallet may approve, for at most the ceiling. */
  usdcAddress: Address;
  /**
   * Additional contracts the wallet may call.
   *
   * Exists because Privy performs the approval and the deposit itself, and if
   * it routes either through a helper contract rather than calling USDC and the
   * vault directly, a destination allowlist naming only those two would deny the
   * deposit outright — policies deny by default. Widening the list is then an
   * operator config change rather than a code change.
   */
  extraDestinations?: Address[];
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

/** ERC-20 `approve`. The one signature in this flow whose shape is certain. */
const APPROVE_ABI = [{
  name: "approve",
  type: "function",
  inputs: [
    { name: "spender", type: "address" },
    { name: "amount", type: "uint256" },
  ],
}] as const;

export type EarnPolicyArgs = {
  perTxCeilingUsdcMinor: bigint;
  chainId: number;
  vaultAddress: Address;
  usdcAddress: Address;
  extraDestinations: Address[];
};

/**
 * The wallet's spending envelope, as Privy policy rules.
 *
 * Privy's policy engine denies by default — "if no rules resolve, the policy
 * will default to DENY" — so this list is exhaustive: anything not described
 * here, the wallet cannot do. That is why the previous envelope, which allowed
 * only `eth_signTransaction` on chain 5042002, could not have authorised a
 * single Base operation.
 *
 * Two layers, because one is not enough:
 *
 * **Where** — one rule per permitted destination. The wallet may call the
 * vault and the USDC contract, and nothing else. A destination allowlist is
 * robust in a way an amount ceiling is not: it survives whatever calldata
 * Privy chooses to emit.
 *
 * **How much** — a ceiling on `approve`'s amount. This is the load-bearing
 * half, and it matters because of a gap the move off Arc opened up: on Arc,
 * USDC was the native gas token, so a transfer's amount sat in the
 * transaction's `value` field and `value <= ceiling` bound it. On Base, USDC is
 * an ERC-20, every deposit carries `value: 0`, and the amount lives in
 * calldata — so that old condition would have been vacuously true for any sum.
 * Capping `approve` restores the bound from the other end: a vault can only
 * pull what it was approved for.
 *
 * Note the unit. `approve`'s argument is in USDC's own six decimals, which is
 * exactly the ledger's minor unit, so the ceiling passes through unscaled. The
 * native-value rule below is the opposite case and scales to 18.
 */
export function earnPolicyRules(a: EarnPolicyArgs): unknown[] {
  const destinations = [a.vaultAddress, a.usdcAddress, ...a.extraDestinations];
  const onChain = {
    field_source: "ethereum_transaction", field: "chain_id",
    operator: "eq", value: String(a.chainId),
  };

  const rules: unknown[] = destinations.map((to, i) => ({
    name: `Call allowlisted contract ${i + 1}`,
    method: "eth_sendTransaction",
    conditions: [
      onChain,
      { field_source: "ethereum_transaction", field: "to", operator: "eq", value: to },
    ],
    action: "ALLOW",
  }));

  rules.push({
    name: "Approve no more than the ceiling",
    method: "eth_sendTransaction",
    conditions: [
      onChain,
      { field_source: "ethereum_transaction", field: "to", operator: "eq", value: a.usdcAddress },
      {
        field_source: "ethereum_calldata",
        field: "approve.amount",
        operator: "lte",
        value: `0x${a.perTxCeilingUsdcMinor.toString(16)}`,
        abi: APPROVE_ABI,
      },
    ],
    action: "ALLOW",
  });

  // Native value, scaled to 18 decimals. On Base this is ETH and should never
  // be used; it is kept so a gas top-up or a native settlement is expressible
  // without reprovisioning, and it is still bounded.
  rules.push({
    name: "Native transfers under ceiling",
    method: "eth_signTransaction",
    conditions: [
      onChain,
      {
        field_source: "ethereum_transaction", field: "value", operator: "lte",
        value: `0x${usdcMinorToWei(a.perTxCeilingUsdcMinor).toString(16)}`,
      },
    ],
    action: "ALLOW",
  });

  return rules;
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
    async provision(args) {
      const { name, perTxCeilingUsdcMinor, chainId, vaultAddress, usdcAddress } = args;
      if (name.trim().length === 0) throw new Error("A business needs a name");
      if (perTxCeilingUsdcMinor <= 0n) {
        throw new Error(`Ceiling must be positive, got ${perTxCeilingUsdcMinor}`);
      }

      const policy = await call("/v1/policies", {
        version: "1.0",
        name: policyLabel(name, " treasury envelope"),
        chain_type: "ethereum",
        rules: earnPolicyRules({
          perTxCeilingUsdcMinor, chainId, vaultAddress, usdcAddress,
          extraDestinations: args.extraDestinations ?? [],
        }),
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
