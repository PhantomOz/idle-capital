import type { ArcClient } from "@idle/chain";
import type { Hex } from "viem";

/**
 * The execution port used for startup reconciliation, and nothing else.
 *
 * Reconciliation asks the chain what already happened; it never broadcasts.
 * That is a documented invariant (D-003), so it is worth making a type rather
 * than a promise: `submit` throws, and a reconciler that ever tried to resubmit
 * would fail loudly in the one place a silent double-spend could originate.
 *
 * It also makes tenancy tractable. A status check needs a transaction hash and
 * a chain — not a wallet — so one of these reconciles every business's intents
 * without standing in for any business's treasury.
 */
export function createStatusOnlyExecutor(arc: ArcClient) {
  return {
    async submit(): Promise<string> {
      throw new Error(
        "Reconciliation must never broadcast: the transaction may have landed while we were down",
      );
    },

    async checkStatus(txRef: string): Promise<"confirmed" | "failed" | "pending"> {
      try {
        const r = await arc.waitForReceipt(txRef as Hex);
        return r.status === "success" ? "confirmed" : "failed";
      } catch {
        // Not knowing is better than guessing in either direction.
        return "pending";
      }
    },
  };
}
