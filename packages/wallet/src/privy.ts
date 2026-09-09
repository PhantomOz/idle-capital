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

export type PrivyClient = {
  signTransaction(tx: ArcTransaction): Promise<Hex>;
  getWallet(): Promise<unknown>;
  earnPosition(vaultId: string): Promise<EarnPosition>;
  earnVault(vaultId: string): Promise<{ id: string; name: string; userApyBps: number; availableLiquidityUsd: number }>;
  earnDeposit(vaultId: string, amountUsdcMinor: bigint, referenceId: string): Promise<unknown>;
  earnWithdraw(vaultId: string, amountUsdcMinor: bigint, referenceId: string): Promise<unknown>;
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

    earnDeposit: (vaultId, amountUsdcMinor, referenceId) =>
      call(`/v1/wallets/${opts.walletId}/earn/ethereum/deposit`, "POST",
           { vault_id: vaultId, raw_amount: amountUsdcMinor.toString(), reference_id: referenceId }),

    earnWithdraw: (vaultId, amountUsdcMinor, referenceId) =>
      call(`/v1/wallets/${opts.walletId}/earn/ethereum/withdraw`, "POST",
           { vault_id: vaultId, raw_amount: amountUsdcMinor.toString(), reference_id: referenceId }),
  };
}

/**
 * The treasury snapshot.
 *
 * `totalUsdc` is liquid plus parked, because allocations are absolute targets
 * (D-011) and conservation is checked against the whole treasury.
 */
export function createPrivyTreasury(deps: {
  arc: ArcClient;
  address: Address;
  listPositions: () => Promise<Position[]>;
}) {
  return {
    async snapshot() {
      const [liquid, positions] = await Promise.all([
        deps.arc.getBalanceUsdcMinor(deps.address),
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
