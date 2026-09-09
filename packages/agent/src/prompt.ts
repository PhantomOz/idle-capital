import type { Market, Obligation, Policy, Position } from "@idle/core";

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
 * The tool the model must call. Forcing it removes "answered in prose" as a
 * failure mode entirely.
 */
export const ALLOCATION_TOOL = {
  name: "submit_allocation",
  description: "Submit the treasury's target allocation and the reasoning behind it.",
  input_schema: {
    type: "object" as const,
    properties: {
      hold: {
        type: "string",
        description: "USDC minor units to keep liquid. A decimal integer string, no decimal point.",
      },
      allocations: {
        type: "array",
        description: "Target holding per market AFTER this run — absolute, not a change.",
        items: {
          type: "object",
          properties: {
            marketId: { type: "string" },
            amountUsdc: { type: "string", description: "USDC minor units, decimal integer string." },
          },
          required: ["marketId", "amountUsdc"],
        },
      },
      rationale: {
        type: "string",
        description:
          "Two or three sentences a business owner would understand, naming the obligation " +
          "that drove the decision. No jargon, no restating the numbers.",
      },
    },
    required: ["hold", "allocations", "rationale"],
  },
};

function pct(bps: number): string {
  return `${bps / 100}%`;
}

/**
 * The whole decision, stated once.
 *
 * The market list deliberately includes venues the policy forbids. An agent
 * that never sees rari-fuse at 12,000,000% has not avoided it, and the point
 * of the reasoning layer is that it avoids it knowingly — with the kernel as
 * the backstop rather than the only defence.
 */
export function buildPrompt(ctx: ProposalContext): string {
  const markets = [...ctx.markets]
    .sort((a, b) => b.supplyApy - a.supplyApy)
    .slice(0, 25)
    .map((m) => {
      const allowed = ctx.policy.protocolAllowlist.includes(m.protocol);
      return `  ${m.id} | ${m.protocol} | ${m.asset.symbol} | apy ${(m.supplyApy * 100).toFixed(2)}% ` +
             `| liquidity $${Math.round(m.liquidityUsd).toLocaleString("en-US")} ` +
             `| ${allowed ? "ALLOWED" : "NOT ALLOWED"}`;
    }).join("\n");

  const positions = ctx.positions.length === 0
    ? "  (nothing parked yet)"
    : ctx.positions.map((p) => `  ${p.marketId} | ${p.amountUsdc} USDC minor`).join("\n");

  const obligations = ctx.obligations.length === 0
    ? "  (none scheduled)"
    : ctx.obligations.map((o) =>
        `  ${o.dueDate} | ${o.currency} ${o.amountMinor} minor | ${o.category} | confidence ${o.confidence}`,
      ).join("\n");

  return `You are the treasury function for a twenty-person business trading across
Nigeria, Kenya, Ghana and Tanzania. You decide how much working capital stays
liquid against obligations that fall due, and where the surplus is parked.

Today is ${ctx.asOf.toISOString().slice(0, 10)}.

TREASURY
  total: ${ctx.totalUsdc} USDC minor units (6 decimals; 1000000 = 1 USDC)
  this is liquid plus everything already parked

CURRENTLY PARKED
${positions}

OBLIGATIONS DUE WITHIN ${ctx.policy.bufferHorizonDays} DAYS
${obligations}
  converted and totalled: ${ctx.bufferRequiredUsdc} USDC minor
  you must hold at least ${ctx.bufferRequiredUsdc} x ${pct(ctx.policy.bufferMultiplierBps)} of that

LENDING MARKETS, best rate first
${markets}

POLICY, enforced whatever you propose
  funds may only enter: ${ctx.policy.protocolAllowlist.join(", ")}
  no venue may hold more than ${pct(ctx.policy.maxVenueConcentrationBps)} of parked capital
  a venue must hold at least $${ctx.policy.minVenueLiquidityUsd.toLocaleString("en-US")} of liquidity
  at most ${ctx.policy.maxRunMovementUsdc} USDC minor may move in one run

Some markets above show extraordinary rates. Those are stale or abandoned
subgraphs still reporting; the liquidity column tells you the truth. Treat a
rate you cannot exit as no rate at all.

Call submit_allocation with the target holding for EACH venue after this run —
absolute amounts, not changes — plus what stays liquid. hold plus every
allocation must sum to exactly ${ctx.totalUsdc}.`;
}
