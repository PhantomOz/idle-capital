import type { Obligation, Policy } from "@idle/core";
import { validate } from "@idle/kernel";
import { bufferRequirementUsdc, scheduleByCurrency } from "@idle/obligations";
import {
  attachProposal, createRun, getRun, listIntents, markConfirmed, markFailed,
  markSubmitted, materialiseIntents, transitionRun,
  type ExecutionPort, type Ledger, type Run,
} from "@idle/ledger";
import { deriveIntents } from "./derive.js";
import type { MarketsPort, ProposerPort, TreasuryPort } from "./ports.js";

export type OrchestratorDeps = {
  ledger: Ledger;
  markets: MarketsPort;
  treasury: TreasuryPort;
  proposer: ProposerPort;
  execution: ExecutionPort;
  policy: Policy;
  obligations: Obligation[];
  now: () => Date;
};

/**
 * One run, start to finish. Spec §7.
 *
 * The order is load-bearing. Market data is fetched before anything else so a
 * Graph failure costs nothing and asks the agent nothing. The kernel sits
 * between the proposal and any intent, so no money-moving record can exist
 * that the kernel did not approve — a vetoed run creates zero intents rather
 * than intents nobody executes.
 */
export async function startRun(deps: OrchestratorDeps, runId: string): Promise<Run> {
  const { ledger, policy, obligations } = deps;
  const asOf = deps.now();

  // Created before the proposal exists so a failure here is still recorded.
  createRun(ledger, runId, null);

  let markets;
  let snapshot;
  try {
    [markets, snapshot] = await Promise.all([deps.markets.fetch(), deps.treasury.snapshot()]);
  } catch {
    return transitionRun(ledger, runId, "FAILED");
  }

  const bufferRequiredUsdc = bufferRequirementUsdc(obligations, policy.bufferHorizonDays, asOf);
  const state = {
    totalUsdc: snapshot.totalUsdc,
    positions: snapshot.positions,
    markets,
    bufferRequiredUsdc,
    asOf,
  };

  let proposal;
  try {
    proposal = await deps.proposer.propose({
      markets,
      positions: snapshot.positions,
      totalUsdc: snapshot.totalUsdc,
      bufferRequiredUsdc,
      scheduleByCurrency: scheduleByCurrency(obligations, policy.bufferHorizonDays, asOf),
      obligations,
      policy,
      asOf,
    });
  } catch {
    return transitionRun(ledger, runId, "FAILED");
  }
  attachProposal(ledger, runId, proposal);

  const verdict = validate(proposal, state, policy);
  if (verdict.kind === "vetoed") {
    return transitionRun(ledger, runId, "FAILED", { verdict });
  }
  if (verdict.kind === "escalated") {
    return transitionRun(ledger, runId, "AWAITING_APPROVAL", { verdict });
  }

  transitionRun(ledger, runId, "VALIDATED", { verdict });
  return execute(deps, runId);
}

/** Approve an escalated run. The human is the second gate, never the first. */
export async function approveRun(deps: OrchestratorDeps, runId: string): Promise<Run> {
  const run = getRun(deps.ledger, runId);
  if (run === null) throw new Error(`Run ${runId} not found`);
  if (run.status !== "AWAITING_APPROVAL") {
    throw new Error(`Run ${runId}: cannot approve from ${run.status}`);
  }
  return execute(deps, runId);
}

export function rejectRun(ledger: Ledger, runId: string): Run {
  return transitionRun(ledger, runId, "REJECTED");
}

/**
 * Materialise and submit the intents for an approved run.
 *
 * Intents are derived from the stored proposal, not from anything held in
 * memory, so this path is identical whether it runs straight after validation
 * or hours later when a human clicks approve.
 */
async function execute(deps: OrchestratorDeps, runId: string): Promise<Run> {
  const { ledger } = deps;
  const run = getRun(ledger, runId);
  if (run === null || run.proposal === null) throw new Error(`Run ${runId} has no proposal`);

  const snapshot = await deps.treasury.snapshot();
  const specs = deriveIntents(run.proposal, snapshot.positions);

  transitionRun(ledger, runId, "EXECUTING");
  materialiseIntents(ledger, runId, specs);

  for (const intent of listIntents(ledger, runId)) {
    if (intent.status !== "pending") continue; // already in flight from an earlier attempt
    try {
      const txRef = await deps.execution.submit(intent);
      markSubmitted(ledger, intent.id, txRef);
    } catch (e) {
      markFailed(ledger, intent.id, e instanceof Error ? e.message : String(e));
      return transitionRun(ledger, runId, "FAILED");
    }
  }

  // Confirm what we just submitted. Anything still pending is picked up by the
  // startup reconciliation sweep instead.
  for (const intent of listIntents(ledger, runId)) {
    if (intent.status !== "submitted" || intent.txRef === null) continue;
    try {
      const status = await deps.execution.checkStatus(intent.txRef);
      if (status === "confirmed") {
        markConfirmed(ledger, intent.id);
      } else if (status === "failed") {
        markFailed(ledger, intent.id, "transaction failed");
      }
    } catch { /* leave in flight for reconcile() */ }
  }

  const finalIntents = listIntents(ledger, runId);
  if (finalIntents.some((i) => i.status === "failed")) {
    return transitionRun(ledger, runId, "FAILED");
  }
  if (finalIntents.every((i) => i.status === "confirmed")) {
    return transitionRun(ledger, runId, "SETTLED");
  }
  return getRun(ledger, runId)!;
}
