import type { Breach, Proposal, TreasuryState } from "@idle/core";

function breach(
  invariant: Breach["invariant"], message: string, observed: string, limit: string,
): Breach {
  return { invariant, message, observed, limit };
}

function isBigInt(v: unknown): v is bigint {
  return typeof v === "bigint";
}

/**
 * K8 — structural well-formedness. VETO.
 *
 * Runs first and takes `unknown`, because everything downstream assumes a
 * typed Proposal and the agent is not trusted to produce one. TypeScript
 * types are erased at runtime; this is the only thing standing between a
 * hallucinated shape and the money-moving path.
 */
export function k8WellFormed(proposal: unknown): Breach | null {
  if (typeof proposal !== "object" || proposal === null || Array.isArray(proposal)) {
    return breach("K8", "Proposal is not an object", String(proposal), "object");
  }
  const p = proposal as Record<string, unknown>;

  if (!isBigInt(p.hold)) {
    return breach("K8", "hold is not a bigint", typeof p.hold, "bigint");
  }
  if (p.hold < 0n) {
    return breach("K8", "hold is negative", p.hold.toString(), ">= 0");
  }
  if (typeof p.rationale !== "string") {
    return breach("K8", "rationale is not a string", typeof p.rationale, "string");
  }
  if (!Array.isArray(p.allocations)) {
    return breach("K8", "allocations is not an array", typeof p.allocations, "array");
  }

  const seen = new Set<string>();
  for (const raw of p.allocations) {
    if (typeof raw !== "object" || raw === null) {
      return breach("K8", "allocation is not an object", String(raw), "object");
    }
    const a = raw as Record<string, unknown>;
    if (typeof a.marketId !== "string" || a.marketId.length === 0) {
      return breach("K8", "allocation marketId is not a non-empty string", String(a.marketId), "string");
    }
    if (!isBigInt(a.amountUsdc)) {
      return breach("K8", `allocation ${a.marketId} amountUsdc is not a bigint`, typeof a.amountUsdc, "bigint");
    }
    if (a.amountUsdc <= 0n) {
      return breach("K8", `allocation ${a.marketId} is not positive`, a.amountUsdc.toString(), "> 0");
    }
    if (seen.has(a.marketId)) {
      return breach("K8", `duplicate allocation to market ${a.marketId}`, a.marketId, "unique market ids");
    }
    seen.add(a.marketId);
  }
  return null;
}

/**
 * K2 — conservation. VETO.
 *
 * Every available unit is either held or allocated. A proposal that does not
 * balance is either conjuring USDC or silently stranding it, and neither is
 * something a human should be asked to approve.
 */
export function k2Conservation(p: Proposal, s: TreasuryState): Breach | null {
  const allocated = p.allocations.reduce((sum, a) => sum + a.amountUsdc, 0n);
  const total = p.hold + allocated;
  if (total !== s.availableUsdc) {
    return breach(
      "K2",
      "hold plus allocations does not equal the available balance",
      `${total} (hold ${p.hold} + allocated ${allocated})`,
      s.availableUsdc.toString(),
    );
  }
  return null;
}
