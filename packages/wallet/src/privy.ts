import type { Address, Hex } from "viem";
import type { ArcClient, ArcTransaction } from "@idle/chain";
import type { Position } from "@idle/core";

const API = "https://api.privy.io";

export type PrivyOptions = {
  appId: string;
  appSecret: string;
  walletId: string;
  fetchImpl?: typeof fetch;
};

/**
 * Raised when the wallet policy refuses a signature.
 *
 * Not a fault in the system — the control doing its job. The orchestrator
 * escalates on this rather than retrying, because retrying a refusal is how
 * a guardrail becomes a speed bump.
 */
export class PolicyViolationError extends Error {
  constructor(detail: string) {
    super(`Privy policy refused the transaction: ${detail}`);
    this.name = "PolicyViolationError";
  }
}

export type EarnPosition = {
  assetsInVault: bigint;
  sharesInVault: bigint;
  totalDeposited: bigint;
  totalWithdrawn: bigint;
};

/**
 * Privy's four terminal-or-not states for a wallet action, plus our own
 * `unknown`.
 *
 * `unknown` exists because the alternative is worse: mapping an unrecognised
 * status onto "succeeded" would mark money as landed on the strength of a
 * string we did not expect. Anything we cannot read is treated as still in
 * flight and left to the reconciliation sweep.
 */
export type EarnActionStatus = "pending" | "succeeded" | "rejected" | "failed" | "unknown";

export type EarnAction = {
  /** Privy's wallet-action id, a UUID. This becomes the intent's txRef. */
  id: string;
  status: EarnActionStatus;
  /** Vault shares received. Null while the action is still pending. */
  shareAmount: bigint | null;
};

export type PrivyClient = {
  signTransaction(tx: ArcTransaction): Promise<Hex>;
  getWallet(): Promise<unknown>;
  earnPosition(vaultId: string): Promise<EarnPosition>;
  earnVault(vaultId: string): Promise<{ id: string; name: string; userApyBps: number; availableLiquidityUsd: number }>;
  earnDeposit(vaultId: string, amountUsdcMinor: bigint, referenceId: string): Promise<EarnAction>;
  earnWithdraw(vaultId: string, amountUsdcMinor: bigint, referenceId: string): Promise<EarnAction>;
  /** Read a previously submitted wallet action back, by its UUID. */
  walletAction(actionId: string): Promise<EarnAction>;
};

export function createPrivyClient(opts: PrivyOptions): PrivyClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers = {
    // Basic auth in a header, never a query string — a secret in a URL ends up
    // in logs, proxies and referrers.
    authorization: "Basic " + Buffer.from(`${opts.appId}:${opts.appSecret}`).toString("base64"),
    "privy-app-id": opts.appId,
    "content-type": "application/json",
  };

  async function call(path: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
    const res = await fetchImpl(`${API}${path}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(45_000),
    });
    const parsed = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) {
      const detail = typeof parsed.error === "string" ? parsed.error : `HTTP ${res.status}`;
      if (parsed.code === "policy_violation" || /policy/i.test(detail)) {
        throw new PolicyViolationError(detail);
      }
      throw new Error(`Privy ${method} ${path}: ${detail}`);
    }
    return parsed;
  }

  function bi(v: unknown): bigint {
    return typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : 0n;
  }

  return {
    async signTransaction(transaction) {
      const out = await call(`/v1/wallets/${opts.walletId}/rpc`, "POST", {
        method: "eth_signTransaction",
        chain_type: "ethereum",
        params: { transaction },
      });
      const data = out.data as { signed_transaction?: string } | undefined;
      const signed = data?.signed_transaction;
      if (typeof signed !== "string") throw new Error("Privy returned no signed transaction");
      return signed as Hex;
    },

    getWallet: () => call(`/v1/wallets/${opts.walletId}`, "GET"),

    async earnPosition(vaultId) {
      const out = await call(
        `/v1/wallets/${opts.walletId}/earn/ethereum/vaults?vault_id=${vaultId}`, "GET");
      return {
        assetsInVault: bi(out.assets_in_vault),
        sharesInVault: bi(out.shares_in_vault),
        totalDeposited: bi(out.total_deposited),
        totalWithdrawn: bi(out.total_withdrawn),
      };
    },

    async earnVault(vaultId) {
      const out = await call(`/v1/earn/ethereum/vaults/${vaultId}`, "GET");
      return {
        id: String(out.id),
        name: String(out.name),
        userApyBps: Number(out.user_apy ?? 0),
        availableLiquidityUsd: Number(out.available_liquidity_usd ?? 0),
      };
    },

    async earnDeposit(vaultId, amountUsdcMinor, referenceId) {
      return earnAction(await call(
        `/v1/wallets/${opts.walletId}/earn/ethereum/deposit`, "POST",
        { vault_id: vaultId, raw_amount: amountUsdcMinor.toString(), reference_id: referenceId }));
    },

    async earnWithdraw(vaultId, amountUsdcMinor, referenceId) {
      return earnAction(await call(
        `/v1/wallets/${opts.walletId}/earn/ethereum/withdraw`, "POST",
        { vault_id: vaultId, raw_amount: amountUsdcMinor.toString(), reference_id: referenceId }));
    },

    async walletAction(actionId) {
      return earnAction(await call(`/v1/wallets/${opts.walletId}/actions/${actionId}`, "GET"));
    },
  };
}

/** Privy's documented status values, and nothing else. */
const EARN_STATUSES = new Set(["pending", "succeeded", "rejected", "failed"]);

export function parseEarnStatus(v: unknown): EarnActionStatus {
  return typeof v === "string" && EARN_STATUSES.has(v) ? v as EarnActionStatus : "unknown";
}

/**
 * Read Privy's wallet-action envelope.
 *
 * Exported so the executor's tests can build a response the same way the
 * client parses one, rather than each having its own idea of the shape.
 */
export function earnAction(out: Record<string, unknown>): EarnAction {
  const raw = out.share_amount;
  return {
    id: typeof out.id === "string" ? out.id : "",
    status: parseEarnStatus(out.status),
    shareAmount: typeof raw === "string" && /^\d+$/.test(raw) ? BigInt(raw) : null,
  };
}

/**
 * Anything that can report an address's liquid USDC in minor units.
 *
 * Declared structurally rather than as a named chain client so the treasury
 * does not know which chain it is reading. Both `@idle/chain`'s Arc client and
 * its Base USDC client satisfy it, and each already owns its own unit
 * conversion — Arc scales 18-decimal native USDC down, Base scales nothing.
 * Keeping that knowledge behind this seam is what stopped the move to Base
 * from becoming a decimals bug in the balance path (D-024).
 */
export type LiquidBalanceReader = {
  getBalanceUsdcMinor(address: Address): Promise<bigint>;
};

/**
 * The treasury snapshot.
 *
 * `totalUsdc` is liquid plus parked, because allocations are absolute targets
 * (D-011) and conservation is checked against the whole treasury.
 */
export function createPrivyTreasury(deps: {
  balances: LiquidBalanceReader;
  address: Address;
  listPositions: () => Promise<Position[]>;
}) {
  return {
    async snapshot() {
      const [liquid, positions] = await Promise.all([
        deps.balances.getBalanceUsdcMinor(deps.address),
        deps.listPositions(),
      ]);
      const parked = positions.reduce((sum, p) => sum + p.amountUsdc, 0n);
      return { totalUsdc: liquid + parked, positions };
    },
  };
}

/**
 * Executes intents on Arc, signed by the Privy wallet.
 *
 * Signing happens BEFORE broadcasting, so a policy refusal costs nothing: the
 * transaction never reaches the chain. That ordering is the whole reason the
 * policy is a real control rather than an audit trail.
 */
export function createPrivyArcExecutor(deps: {
  arc: ArcClient;
  privy: Pick<PrivyClient, "signTransaction">;
  address: Address;
  settlementAddress: Address;
}) {
  return {
    async submit(intent: { amountUsdc: bigint }): Promise<string> {
      const tx = await deps.arc.buildTransfer({
        from: deps.address,
        to: deps.settlementAddress,
        amountUsdcMinor: intent.amountUsdc,
      });
      const signed = await deps.privy.signTransaction(tx);
      return deps.arc.broadcast(signed);
    },

    async checkStatus(txRef: string): Promise<"confirmed" | "failed" | "pending"> {
      try {
        const r = await deps.arc.waitForReceipt(txRef as Hex);
        return r.status === "success" ? "confirmed" : "failed";
      } catch {
        // Not knowing is better than guessing in either direction.
        return "pending";
      }
    },
  };
}
