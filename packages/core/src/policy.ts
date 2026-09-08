/**
 * Operator-supplied configuration. Unlike an agent proposal, the policy is
 * TRUSTED — it is written by a human and reviewed, not generated.
 */
export type Policy = {
  /** Obligations falling due within this window must stay covered. */
  bufferHorizonDays: number;
  /** Safety factor on the buffer, in basis points. 11500 = 1.15x. */
  bufferMultiplierBps: number;
  /** Market ids the agent may allocate to. */
  venueAllowlist: string[];
  /** Max share of post-run parked capital in any one market. 5000 = 50%. */
  maxVenueConcentrationBps: number;
  /** Ceiling on total USDC moved in a single run. */
  maxRunMovementUsdc: bigint;
  /** A venue below this liquidity is not safely exitable. */
  minVenueLiquidityUsd: number;
};
