import type { Breach, Policy, Proposal, TreasuryState, Verdict } from "@idle/core";
import {
  k1BufferCoverage, k2Conservation, k3MarketExists, k4Allowlist,
  k5Concentration, k6RunMovement, k7Liquidity, k8WellFormed,
} from "./invariants.js";

function present(breaches: (Breach | null)[]): Breach[] {
  return breaches.filter((b): b is Breach => b !== null);
}

/**
 * Validate an untrusted agent proposal against treasury state and operator
 * policy.
 *
 * Precedence is deliberate. VETO invariants are evaluated first and win
 * outright: a structurally invalid proposal must never reach a human for
 * approval, because asking someone to rubber-stamp nonsense trains them to
 * rubber-stamp. Only a proposal that is coherent in every respect can be
 * escalated for a judgment call.
 *
 * This function is total. It never throws for any input — malformed proposal,
 * malformed state, anything. A validator that can throw is a validator that
 * can be bypassed by crashing it.
 */
export function validate(proposal: unknown, state: TreasuryState, policy: Policy): Verdict {
  try {
    const malformed = k8WellFormed(proposal);
    if (malformed !== null) return { kind: "vetoed", breaches: [malformed] };

    const p = proposal as Proposal;

    const vetoes = present([
      k2Conservation(p, state),
      k1BufferCoverage(p, state, policy),
      k3MarketExists(p, state),
      k4Allowlist(p, state, policy),
    ]);
    if (vetoes.length > 0) return { kind: "vetoed", breaches: vetoes };

    const escalations = present([
      k5Concentration(p, state, policy),
      k6RunMovement(p, policy),
      k7Liquidity(p, state, policy),
    ]);
    if (escalations.length > 0) return { kind: "escalated", breaches: escalations };

    return { kind: "approved" };
  } catch (error) {
    return {
      kind: "vetoed",
      breaches: [{
        invariant: "K8",
        message: "validation threw; treating as structurally invalid",
        observed: error instanceof Error ? error.message : String(error),
        limit: "no exception",
      }],
    };
  }
}
