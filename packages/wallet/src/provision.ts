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
  /** The Privy Earn vault id this wallet may deposit into, and no other. */
  vaultId: string;
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

export type EarnPolicyArgs = {
  perTxCeilingUsdcMinor: bigint;
  /** The Privy Earn vault id, which is what the policy binds. */
  vaultId: string;
};

/**
 * The wallet's spending envelope, as Privy policy rules.
 *
 * Privy's policy engine denies by default — "if no rules resolve, the policy
 * will default to DENY" — so this list is exhaustive: anything not described
 * here, the wallet cannot do. The envelope that shipped before this one allowed
 * `eth_signTransaction` on chain 5042002 and could not have authorised a single
 * Base operation.
 *
 * Two rules, and they are written against the *action* rather than the
 * transaction. That is not a stylistic choice — it is the only level at which
 * this flow can be governed, and it took a rejected deposit to establish why.
 *
 * Privy fulfils an Earn deposit with an **EIP-7702** transaction (type `0x04`)
 * sent to the wallet's *own address*, whose calldata is an `execute` batch
 * wrapping `approve(vault, amount)` and `deposit(amount, receiver)`. So a
 * transaction-level rule conditioned on `to == vault`, or decoding
 * `approve.amount` from the outer calldata, can never match: the outer `to` is
 * the wallet and the outer selector is `execute`. An earlier version of this
 * function carried exactly those rules. They were not merely useless — they
 * read like controls, which is worse, and the deposit they appeared to bound
 * was authorised by the action rule alone.
 *
 * `action_request_body` is "the request body sent to the API before Privy
 * prepares the underlying transactions", so `vault_id` and `raw_amount` are
 * checked against what we actually asked for. `raw_amount` is in USDC's six
 * decimals, which is the ledger's own minor unit — the ceiling passes through
 * unscaled, where the Arc policy it replaces had to scale to eighteen.
 *
 * **Withdrawals are deliberately uncapped.** A ceiling on the way out is a trap,
 * not a control: the failure it creates is capital that cannot be retrieved in
 * one operation. Deposits are bounded because committing capital is the risk;
 * withdrawing is how risk is undone.
 */
export function earnPolicyRules(a: EarnPolicyArgs): unknown[] {
  const vaultIs = {
    field_source: "action_request_body", field: "vault_id",
    operator: "eq", value: a.vaultId,
  };

  return [
    {
      name: "Deposit into the one allowlisted vault",
      method: "earn_deposit",
      conditions: [
        vaultIs,
        {
          field_source: "action_request_body", field: "raw_amount",
          operator: "lte", value: a.perTxCeilingUsdcMinor.toString(),
        },
      ],
      action: "ALLOW",
    },
    {
      name: "Withdraw from that vault, any amount",
      method: "earn_withdraw",
      conditions: [vaultIs],
      action: "ALLOW",
    },
  ];
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
      const { name, perTxCeilingUsdcMinor, vaultId } = args;
      if (name.trim().length === 0) throw new Error("A business needs a name");
      if (perTxCeilingUsdcMinor <= 0n) {
        throw new Error(`Ceiling must be positive, got ${perTxCeilingUsdcMinor}`);
      }

      const policy = await call("/v1/policies", {
        version: "1.0",
        name: policyLabel(name, " treasury envelope"),
        chain_type: "ethereum",
        rules: earnPolicyRules({ perTxCeilingUsdcMinor, vaultId }),
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
