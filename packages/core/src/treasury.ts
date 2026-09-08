import type { Market } from "./market.js";

export type Position = {
  marketId: string;
  amountUsdc: bigint;
};

export type TreasuryState = {
  /** Liquid, unparked USDC. The pool a proposal allocates from. */
  availableUsdc: bigint;
  positions: Position[];
  /** The live market set fetched THIS run. K3 checks against it. */
  markets: Market[];
  /** From @idle/obligations, at the policy horizon. */
  bufferRequiredUsdc: bigint;
  /** Injected, never read from the clock — the kernel must be pure. */
  asOf: Date;
};
