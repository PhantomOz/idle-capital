import { applyBpsCeil, type Obligation, type Policy } from "@idle/core";
import { FIXED_FX, bufferRequirementUsdc, toUsdcMinor, withinHorizon } from "@idle/obligations";

export type ScheduledObligation = Obligation & {
  /** The same amount in USDC minor units, at the disclosed fixed rate. */
  usdcMinor: bigint;
  /** Does it fall inside the policy's horizon, and so bind the buffer? */
  withinHorizon: boolean;
};

export type Schedule = {
  obligations: ScheduledObligation[];
  /** Everything owed inside the horizon, converted. */
  totalUsdc: bigint;
  /** That total with the safety multiplier applied — the hard floor. */
  minimumHoldUsdc: bigint;
  /** What is left to earn on, given the treasury. Never negative. */
  deployableUsdc: bigint;
  horizonDays: number;
  multiplierBps: number;
  fx: { asOf: string; source: string };
};

/**
 * Everything the UI needs to explain the decision, computed once, on this side.
 *
 * The frontend never converts a currency or applies a multiplier. Both are
 * money arithmetic, both round in a direction that matters, and a second
 * implementation in JavaScript floats is a second answer waiting to disagree
 * with the kernel. Ceiling division here uses the same `applyBpsCeil` K1
 * validates with.
 */
export function buildSchedule(
  obligations: Obligation[],
  policy: Policy,
  totalUsdc: bigint,
  asOf: Date,
): Schedule {
  const totalUsdcOwed = bufferRequirementUsdc(obligations, policy.bufferHorizonDays, asOf);
  const minimumHoldUsdc = applyBpsCeil(totalUsdcOwed, policy.bufferMultiplierBps);
  return {
    obligations: obligations.map((o) => ({
      ...o,
      usdcMinor: toUsdcMinor(o.amountMinor, o.currency),
      withinHorizon: withinHorizon(o, policy.bufferHorizonDays, asOf),
    })),
    totalUsdc: totalUsdcOwed,
    minimumHoldUsdc,
    deployableUsdc: totalUsdc > minimumHoldUsdc ? totalUsdc - minimumHoldUsdc : 0n,
    horizonDays: policy.bufferHorizonDays,
    multiplierBps: policy.bufferMultiplierBps,
    fx: { asOf: FIXED_FX.asOf, source: FIXED_FX.source },
  };
}
