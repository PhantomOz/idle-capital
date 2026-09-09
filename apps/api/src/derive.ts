import type { Position, Proposal } from "@idle/core";
import type { IntentSpec } from "@idle/ledger";

/**
 * Turn an approved target state into the ordered moves that reach it.
 *
 * Withdrawals are emitted before deposits, always. Capital has to be freed
 * before it can be deployed, and a deposit that runs ahead of its funding
 * withdrawal fails at the venue rather than in our code, where it is much
 * harder to reason about.
 *
 * Deterministic: the same proposal and positions always derive the same
 * sequence. That is what makes the ledger's idempotency keys stable across a
 * crash — a retry must recompute exactly the same intents in exactly the
 * same order, or the keys stop lining up.
 */
export function deriveIntents(proposal: Proposal, positions: Position[]): IntentSpec[] {
  const current = new Map<string, bigint>();
  for (const p of positions) {
    current.set(p.marketId, (current.get(p.marketId) ?? 0n) + p.amountUsdc);
  }
  const target = new Map<string, bigint>();
  for (const a of proposal.allocations) {
    target.set(a.marketId, (target.get(a.marketId) ?? 0n) + a.amountUsdc);
  }

  const marketIds = [...new Set([...current.keys(), ...target.keys()])].sort();

  const withdrawals: IntentSpec[] = [];
  const deposits: IntentSpec[] = [];
  for (const marketId of marketIds) {
    const now = current.get(marketId) ?? 0n;
    const want = target.get(marketId) ?? 0n;
    if (want > now) {
      deposits.push({ kind: "earn_deposit", amountUsdc: want - now, marketId });
    } else if (want < now) {
      withdrawals.push({ kind: "earn_withdraw", amountUsdc: now - want, marketId });
    }
  }
  return [...withdrawals, ...deposits];
}
