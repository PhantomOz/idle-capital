import { applyBpsCeil } from "@idle/core";
import type { Breach, Policy, Proposal, TreasuryState } from "@idle/core";

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
 * Every unit of the treasury is either held liquid or targeted at a venue.
 * Checked against the WHOLE treasury because allocations are absolute
 * targets: a rebalance that moves nothing still has to account for
 * everything.
 */
export function k2Conservation(p: Proposal, s: TreasuryState): Breach | null {
  const targeted = p.allocations.reduce((sum, a) => sum + a.amountUsdc, 0n);
  const total = p.hold + targeted;
  if (total !== s.totalUsdc) {
    return breach(
      "K2",
      "hold plus targets does not equal the treasury total",
      `${total} (hold ${p.hold} + targeted ${targeted})`,
      s.totalUsdc.toString(),
    );
  }
  return null;
}

/**
 * K1 — buffer coverage. VETO.
 *
 * The retained liquid balance must cover obligations at the policy horizon,
 * scaled by the safety factor. This is the invariant the whole product exists
 * to hold: park the surplus, never the payroll.
 */
export function k1BufferCoverage(p: Proposal, s: TreasuryState, pol: Policy): Breach | null {
  const required = applyBpsCeil(s.bufferRequiredUsdc, pol.bufferMultiplierBps);
  if (p.hold < required) {
    return breach(
      "K1",
      `retained balance does not cover obligations over ${pol.bufferHorizonDays} days`,
      p.hold.toString(),
      `${required} (buffer ${s.bufferRequiredUsdc} x ${pol.bufferMultiplierBps}bps)`,
    );
  }
  return null;
}

/**
 * K3 — market existence. VETO.
 *
 * Checked against the market set fetched THIS run, not a cached list. An
 * agent that names a market which no longer exists is proposing a transfer
 * into nothing.
 */
export function k3MarketExists(p: Proposal, s: TreasuryState): Breach | null {
  const live = new Set(s.markets.map((m) => m.id));
  for (const a of p.allocations) {
    if (!live.has(a.marketId)) {
      return breach(
        "K3",
        `market ${a.marketId} is not in this run's live market set`,
        a.marketId,
        `one of ${[...live].join(", ")}`,
      );
    }
  }
  return null;
}

/**
 * K4 — protocol allowlist. VETO.
 *
 * A market can be real, liquid and high-yielding and still sit on a protocol
 * the operator has not agreed to hold funds in. Checked at protocol level:
 * that is the unit an operator reasons in, and it does not need re-editing
 * when an allowlisted protocol lists a new asset.
 *
 * A market absent from the live set is K3's to report, not K4's — flagging it
 * twice would tell the reader there are two problems when there is one.
 */
export function k4Allowlist(p: Proposal, s: TreasuryState, pol: Policy): Breach | null {
  const byId = new Map(s.markets.map((m) => [m.id, m]));
  const allowed = new Set(pol.protocolAllowlist);
  for (const a of p.allocations) {
    const m = byId.get(a.marketId);
    if (m === undefined) continue; // K3 owns the missing-market case
    if (!allowed.has(m.protocol)) {
      return breach(
        "K4",
        `market ${a.marketId} sits on protocol ${m.protocol}, which is not allowlisted`,
        m.protocol,
        pol.protocolAllowlist.join(", "),
      );
    }
  }
  return null;
}

/**
 * K5 — venue concentration. ESCALATE.
 *
 * Reads the targets directly. They already describe the end state, so there
 * is nothing to add — and the split-across-runs evasion that an incremental
 * shape would allow is impossible here by construction rather than by check.
 */
export function k5Concentration(p: Proposal, _s: TreasuryState, pol: Policy): Breach | null {
  let totalParked = 0n;
  for (const a of p.allocations) totalParked += a.amountUsdc;
  if (totalParked === 0n) return null;

  const cap = applyBpsCeil(totalParked, pol.maxVenueConcentrationBps);
  for (const a of p.allocations) {
    if (a.amountUsdc > cap) {
      return breach(
        "K5",
        `market ${a.marketId} would hold more than the permitted share of parked capital`,
        `${a.marketId} at ${a.amountUsdc} of ${totalParked}`,
        `${cap} (${pol.maxVenueConcentrationBps}bps)`,
      );
    }
  }
  return null;
}

/**
 * K6 — per-run movement ceiling. ESCALATE.
 *
 * Measures CHURN — the sum of absolute differences between target and
 * current — not the size of the targets. Under target semantics a proposal
 * that changes nothing still names the full position, and charging that
 * against the movement cap would block every no-op rebalance.
 *
 * Bounds the blast radius of any single bad decision, whoever made it.
 */
export function k6RunMovement(p: Proposal, s: TreasuryState, pol: Policy): Breach | null {
  const current = new Map<string, bigint>();
  for (const pos of s.positions) {
    current.set(pos.marketId, (current.get(pos.marketId) ?? 0n) + pos.amountUsdc);
  }
  let moved = 0n;
  const seen = new Set<string>();
  for (const a of p.allocations) {
    seen.add(a.marketId);
    const now = current.get(a.marketId) ?? 0n;
    moved += a.amountUsdc > now ? a.amountUsdc - now : now - a.amountUsdc;
  }
  // Venues the proposal drops entirely are full withdrawals.
  for (const [marketId, amount] of current) {
    if (!seen.has(marketId)) moved += amount;
  }

  if (moved > pol.maxRunMovementUsdc) {
    return breach("K6", "this run moves more than the per-run ceiling",
                  moved.toString(), pol.maxRunMovementUsdc.toString());
  }
  return null;
}

/**
 * K7 — venue liquidity floor. ESCALATE.
 *
 * Yield on capital that cannot be withdrawn is not yield. Only venues the
 * proposal actually targets are checked.
 */
export function k7Liquidity(p: Proposal, s: TreasuryState, pol: Policy): Breach | null {
  const byId = new Map(s.markets.map((m) => [m.id, m]));
  for (const a of p.allocations) {
    const m = byId.get(a.marketId);
    if (m === undefined) continue; // K3 owns the missing-market case
    if (m.liquidityUsd < pol.minVenueLiquidityUsd) {
      return breach(
        "K7",
        `market ${a.marketId} is below the liquidity floor and may not be exitable`,
        `${m.liquidityUsd}`,
        `${pol.minVenueLiquidityUsd}`,
      );
    }
  }
  return null;
}
