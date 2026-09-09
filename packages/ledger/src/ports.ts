import type { Intent } from "./types.js";

export type TxStatus = "confirmed" | "failed" | "pending";

/**
 * The seam between the state machine and whatever actually moves money.
 *
 * Declared here so the ledger is complete and testable before Privy and Arc
 * credentials exist. The real adapters implement this interface on Friday and
 * nothing above them changes.
 */
export interface ExecutionPort {
  /** Broadcast the intent. Returns a transaction reference. */
  submit(intent: Intent): Promise<string>;
  /** Has this transaction landed? Must be safe to call repeatedly. */
  checkStatus(txRef: string): Promise<TxStatus>;
}
