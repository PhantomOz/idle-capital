import { walletForTxRef, type Ledger } from "@idle/ledger";
import { earnStatusToTx, type PrivyClient } from "@idle/wallet";

export type TxStatus = "confirmed" | "failed" | "pending";

/**
 * The execution port used for startup reconciliation, and nothing else.
 *
 * Reconciliation asks the venue what already happened; it never submits. That is
 * a documented invariant (D-003), so it is worth making a type rather than a
 * promise: `submit` throws, and a reconciler that ever tried to resubmit would
 * fail loudly in the one place a silent double-spend could originate.
 *
 * Tenancy is handled by lookup rather than by ambient state. `reconcile()` hands
 * over a transaction reference and nothing more, but reading a Privy wallet
 * action back is wallet-scoped — so the txRef is resolved through the ledger to
 * the business that owns it, and a client is built for that business's wallet
 * alone. No sweep ever holds a treasury that is not the one it is asking about.
 */
export function createStatusOnlyEarnExecutor(deps: {
  ledger: Ledger;
  clientFor(walletId: string): Pick<PrivyClient, "walletAction">;
}) {
  return {
    async submit(): Promise<string> {
      throw new Error(
        "Reconciliation must never submit: the action may have landed while we were down",
      );
    },

    async checkStatus(txRef: string): Promise<TxStatus> {
      const walletId = walletForTxRef(deps.ledger, txRef);
      // A reference we cannot attribute to a wallet is one we cannot ask about.
      // That is "pending" — unknown — and never "failed", which would invite a
      // retry of something that may well have succeeded.
      if (walletId === null) return "pending";
      try {
        const action = await deps.clientFor(walletId).walletAction(txRef);
        return earnStatusToTx(action.status);
      } catch {
        return "pending";
      }
    },
  };
}
