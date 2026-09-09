import type { Market } from "./market.js";

export type Position = {
  marketId: string;
  amountUsdc: bigint;
};

export type TreasuryState = {
  /**
   * The WHOLE treasury: liquid plus everything already parked. Allocations
   * are absolute targets, so conservation is checked against the total —
   * not against the liquid slice, which would make a rebalance look like it
   * conjured money.
   */
  totalUsdc: bigint;
  positions: Position[];
  /** The live market set fetched THIS run. K3 checks against it. */
  markets: Market[];
  /** From @idle/obligations, at the policy horizon. */
  bufferRequiredUsdc: bigint;
  /** Injected, never read from the clock — the kernel must be pure. */
  asOf: Date;
};
