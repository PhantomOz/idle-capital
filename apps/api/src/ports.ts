import type { Market, Obligation, Policy, Position, Proposal } from "@idle/core";

/** Everything the proposer is given to reason over. */
export type ProposalContext = {
  markets: Market[];
  positions: Position[];
  totalUsdc: bigint;
  bufferRequiredUsdc: bigint;
  scheduleByCurrency: Record<string, bigint>;
  obligations: Obligation[];
  policy: Policy;
  asOf: Date;
};

/**
 * The agent seam. An LLM implements this; so could a deterministic optimiser.
 * The kernel does not care and does not trust either.
 */
export interface ProposerPort {
  propose(ctx: ProposalContext): Promise<Proposal>;
}

/** Where the treasury's current shape comes from. Privy implements this. */
export interface TreasuryPort {
  snapshot(): Promise<{ totalUsdc: bigint; positions: Position[] }>;
}

/** The live market set. @idle/yields implements this. */
export interface MarketsPort {
  fetch(): Promise<Market[]>;
}
