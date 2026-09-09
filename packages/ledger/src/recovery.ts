import type { Ledger } from "./db.js";
import { findInFlight, listIntents, markConfirmed, markFailed } from "./intents.js";
import type { ExecutionPort, TxStatus } from "./ports.js";
import { getRun, transitionRun } from "./runs.js";

export type ReconcileReport = {
  checked: number;
  confirmed: number;
  failed: number;
  stillPending: number;
};

/**
 * Reconcile every intent left in flight, then settle the runs they belong to.
 *
 * Run at startup, before any new work is issued. This is the answer to "money
 * in limbo" (D-003): a process that died between broadcasting a transfer and
 * recording its outcome comes back, asks the chain what actually happened,
 * and records it.
 *
 * It NEVER resubmits. Resubmission is how a crash becomes a double-spend —
 * the transaction may well have landed while we were down, which is exactly
 * the case this function exists to discover.
 *
 * A port that throws leaves the intent in flight. Not knowing is a strictly
 * better state than guessing wrong in either direction.
 */
export async function reconcile(l: Ledger, port: ExecutionPort): Promise<ReconcileReport> {
  const inFlight = findInFlight(l);
  const report: ReconcileReport = {
    checked: inFlight.length, confirmed: 0, failed: 0, stillPending: 0,
  };
  const touchedRuns = new Set<string>();

  for (const intent of inFlight) {
    touchedRuns.add(intent.runId);
    if (intent.txRef === null) { report.stillPending += 1; continue; }
    let status: TxStatus;
    try {
      status = await port.checkStatus(intent.txRef);
    } catch {
      report.stillPending += 1;
      continue;
    }
    if (status === "confirmed") { markConfirmed(l, intent.id); report.confirmed += 1; }
    else if (status === "failed") { markFailed(l, intent.id, "reconciled: transaction failed"); report.failed += 1; }
    else { report.stillPending += 1; }
  }

  for (const runId of touchedRuns) {
    const run = getRun(l, runId);
    if (run === null || run.status !== "EXECUTING") continue;
    const intents = listIntents(l, runId);
    if (intents.some((i) => i.status === "failed")) {
      transitionRun(l, runId, "FAILED");
    } else if (intents.every((i) => i.status === "confirmed")) {
      transitionRun(l, runId, "SETTLED");
    }
    // Otherwise something is still in flight — leave it EXECUTING and try
    // again on the next sweep.
  }

  return report;
}
