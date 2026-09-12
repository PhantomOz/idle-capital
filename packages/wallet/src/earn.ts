import type { EarnAction, PrivyClient } from "./privy.js";

/**
 * The subset of an intent this executor acts on.
 *
 * Typed structurally rather than imported from `@idle/ledger` so the wallet
 * package stays a leaf: it knows how to move money, not how the run state
 * machine records it.
 */
export type EarnIntent = {
  kind: string;
  amountUsdc: bigint;
  marketId: string | null;
  /** `${runId}:${seq}` — stable across retries by construction. */
  idempotencyKey: string;
};

export type TxStatus = "confirmed" | "failed" | "pending";

/**
 * Privy's action status, as the run state machine sees it.
 *
 * Shared with the reconciler so there is exactly one place where "succeeded"
 * becomes "confirmed". Two copies of this mapping is how a sweep and a live run
 * end up disagreeing about whether money moved.
 */
export function earnStatusToTx(status: EarnAction["status"]): TxStatus {
  switch (status) {
    case "succeeded": return "confirmed";
    case "failed":
    case "rejected": return "failed";
    default: return "pending";
  }
}

/** The market id this executor answers to, derived from the vault it holds. */
export function earnMarketId(vaultId: string): string {
  return `privy-earn:${vaultId}`;
}

export class UnreachableVenueError extends Error {
  constructor(marketId: string, reachable: string) {
    super(
      `Refusing to execute against ${marketId}: this executor can only reach ${reachable}. ` +
      `An intent naming a venue the executor cannot reach must fail loudly here, ` +
      `because the alternative is doing something else with the money and ` +
      `reporting it as that venue.`,
    );
    this.name = "UnreachableVenueError";
  }
}

/**
 * Executes earn intents against a Privy Earn vault.
 *
 * Replaces the Arc executor, which implemented every intent — deposit and
 * withdrawal alike — as a plain value transfer to an address we controlled,
 * then let the UI call it "moved into the earn account". See D-024.
 *
 * Three properties worth naming:
 *
 * **The venue check is a real guard, not a formality.** The previous executor
 * ignored `marketId` entirely, which is exactly how a deposit into a Base
 * vault became a transfer to our own faucet on Arc. If an intent names a venue
 * this executor cannot reach, it fails instead of substituting one it can.
 *
 * **Idempotency is ours, not Privy's.** `reference_id` carries our
 * `${runId}:${seq}` key so an operator can correlate a Privy action with a
 * ledger intent, but Privy does not document it as a deduplication key, so we
 * do not lean on it as one. The protection that actually holds is the ledger's:
 * a submitted intent is never resubmitted, and `reconcile()` only ever reads.
 *
 * **An unreadable status is "pending", never "confirmed".** Privy performs the
 * ERC-20 approval and the deposit in a single managed call, so there is no
 * partial state for us to stitch together — but there is a window where the
 * action is accepted and not yet settled, and guessing through it would mark
 * money as landed on no evidence.
 */
export function createPrivyEarnExecutor(deps: {
  privy: Pick<PrivyClient, "earnDeposit" | "earnWithdraw" | "walletAction">;
  vaultId: string;
}) {
  const reachable = earnMarketId(deps.vaultId);

  function assertReachable(intent: EarnIntent): void {
    if (intent.marketId !== null && intent.marketId !== reachable) {
      throw new UnreachableVenueError(intent.marketId, reachable);
    }
  }

  function txRefOf(action: EarnAction, kind: string): string {
    if (action.id === "") {
      throw new Error(
        `Privy accepted the ${kind} but returned no action id, so there is ` +
        `nothing to reconcile against. Treating this as a failure rather than ` +
        `recording an intent we can never confirm.`,
      );
    }
    return action.id;
  }

  return {
    async submit(intent: EarnIntent): Promise<string> {
      assertReachable(intent);
      switch (intent.kind) {
        case "earn_deposit": {
          const a = await deps.privy.earnDeposit(
            deps.vaultId, intent.amountUsdc, intent.idempotencyKey);
          return txRefOf(a, "deposit");
        }
        case "earn_withdraw": {
          const a = await deps.privy.earnWithdraw(
            deps.vaultId, intent.amountUsdc, intent.idempotencyKey);
          return txRefOf(a, "withdrawal");
        }
        default:
          // settle_usdc pays a counterparty; that is a transfer, not an Earn
          // action, and routing it here would repeat the original mistake of
          // executing one kind of movement as another.
          throw new Error(
            `The Earn executor cannot perform "${intent.kind}" — it only ` +
            `deposits into and withdraws from ${reachable}.`,
          );
      }
    },

    async checkStatus(txRef: string): Promise<TxStatus> {
      let action: EarnAction;
      try {
        action = await deps.privy.walletAction(txRef);
      } catch {
        // Not knowing is better than guessing in either direction: a wrong
        // "failed" invites a duplicate, a wrong "confirmed" loses the money.
        return "pending";
      }
      return earnStatusToTx(action.status);
    },
  };
}
