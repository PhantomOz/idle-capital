import type { Proposal, Verdict } from "@idle/core";

/** See spec §6. Terminal states have no outgoing transitions. */
export type RunStatus =
  | "PROPOSED"
  | "VALIDATED"
  | "AWAITING_APPROVAL"
  | "EXECUTING"
  | "SETTLED"
  | "REJECTED"
  | "FAILED";

export type IntentStatus = "pending" | "submitted" | "confirmed" | "failed";

export type IntentKind = "earn_deposit" | "earn_withdraw" | "settle_usdc";

export type Run = {
  id: string;
  status: RunStatus;
  proposal: Proposal | null;
  verdict: Verdict | null;
  createdAt: string;
  updatedAt: string;
};

export type Intent = {
  id: string;
  runId: string;
  /** Order within the run. Part of the idempotency key. */
  seq: number;
  kind: IntentKind;
  amountUsdc: bigint;
  marketId: string | null;
  /** Stable across retries. The reason double-spending is impossible. */
  idempotencyKey: string;
  status: IntentStatus;
  txRef: string | null;
  error: string | null;
};
