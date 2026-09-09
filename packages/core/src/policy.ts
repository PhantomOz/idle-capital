/**
 * Operator-supplied configuration. Unlike an agent proposal, the policy is
 * TRUSTED — it is written by a human and reviewed, not generated.
 */
export type Policy = {
  /** Obligations falling due within this window must stay covered. */
  bufferHorizonDays: number;
  /** Safety factor on the buffer, in basis points. 11500 = 1.15x. */
  bufferMultiplierBps: number;
  /**
   * Protocol identifiers the agent may allocate into, matching
   * `Market.protocol` (e.g. "aave-v3"). Protocol-level rather than
   * market-level because that is how an operator actually reasons about
   * counterparty risk — and it does not need re-editing every time an
   * allowlisted protocol lists a new asset.
   */
  protocolAllowlist: string[];
  /** Max share of post-run parked capital in any one market. 5000 = 50%. */
  maxVenueConcentrationBps: number;
  /** Ceiling on total USDC moved in a single run. */
  maxRunMovementUsdc: bigint;
  /** A venue below this liquidity is not safely exitable. */
  minVenueLiquidityUsd: number;
};
