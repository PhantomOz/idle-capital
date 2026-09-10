import { applyBpsCeil } from "@idle/core";
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
        description:
          'USDC minor units to keep liquid, as a plain decimal integer: "7015000". ' +
          "No decimal point, no thousands separators, and no quote characters inside the string.",
      },
      allocations: {
        type: "array",
        description: "Target holding per market AFTER this run — absolute, not a change.",
        items: {
          type: "object",
          properties: {
            marketId: { type: "string" },
            amountUsdc: {
              type: "string",
              description:
                'USDC minor units, as a plain decimal integer: "1500000". No decimal point, ' +
                "no thousands separators, and no quote characters inside the string.",
            },
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

/** How many forbidden venues to show as the comparison set. */
const COMPARISON_ROWS = 20;

function row(m: Market): string {
  return `  ${m.id} | ${m.protocol} | ${m.asset.symbol} | apy ${(m.supplyApy * 100).toFixed(2)}% ` +
         `| liquidity $${Math.round(m.liquidityUsd).toLocaleString("en-US")}`;
}

/**
 * Split the live market set into what may receive funds and what may not.
 *
 * Both lists are sorted by rate, but they are capped separately, and that is
 * the whole point. A single list truncated by rate drops every allowlisted
 * venue: on live data the top rows are abandoned subgraphs reporting five- and
 * seven-figure percentages, and an allowlisted market at 3.7% does not survive
 * the cut. The agent then correctly reports that nothing is usable, because
 * nothing usable was on the page. Never let a sort decide which venues the
 * agent is allowed to consider.
 */
function splitMarkets(markets: Market[], allowlist: string[]): { allowed: Market[]; forbidden: Market[] } {
  const allow = new Set(allowlist);
  const byRate = [...markets].sort((a, b) => b.supplyApy - a.supplyApy);
  return {
    allowed: byRate.filter((m) => allow.has(m.protocol)),
    forbidden: byRate.filter((m) => !allow.has(m.protocol)).slice(0, COMPARISON_ROWS),
  };
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
  const { allowed, forbidden } = splitMarkets(ctx.markets, ctx.policy.protocolAllowlist);

  // Computed here with the SAME function K1 validates against, and stated as a
  // finished number. Asking the model to multiply a buffer by a basis-point
  // multiplier and round it is asking it to do exact integer money arithmetic;
  // a live run missed the floor by 450 minor units doing precisely that, and
  // the kernel vetoed it — correctly, and for no reason anyone wanted.
  const minimumHold = applyBpsCeil(ctx.bufferRequiredUsdc, ctx.policy.bufferMultiplierBps);
  const deployable = ctx.totalUsdc > minimumHold ? ctx.totalUsdc - minimumHold : 0n;
  const allowedRows = allowed.length === 0
    ? "  (none — nothing may receive funds this run)"
    : allowed.map(row).join("\n");
  const forbiddenRows = forbidden.length === 0
    ? "  (none)"
    : forbidden.map(row).join("\n");

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
  required cushion at ${pct(ctx.policy.bufferMultiplierBps)}: hold AT LEAST ${minimumHold} USDC minor
  most you may park this run: ${deployable} USDC minor

Both figures are already computed. Do not recompute them — hold below
${minimumHold} is rejected outright, however close.

VENUES THAT MAY RECEIVE FUNDS, best rate first
${allowedRows}

EVERY OTHER VENUE, best rate first — comparison only, funds may not enter
${forbiddenRows}

POLICY, enforced whatever you propose
  funds may only enter: ${ctx.policy.protocolAllowlist.join(", ")}
  no venue may hold more than ${pct(ctx.policy.maxVenueConcentrationBps)} of parked capital
  a venue must hold at least $${ctx.policy.minVenueLiquidityUsd.toLocaleString("en-US")} of liquidity
  at most ${ctx.policy.maxRunMovementUsdc} USDC minor may move in one run

Some markets above show extraordinary rates. Those are stale or abandoned
subgraphs still reporting; the liquidity column tells you the truth. Treat a
rate you cannot exit as no rate at all. A negative liquidity figure is a venue
reporting more borrowed than supplied — there is nothing there to withdraw.

The second list exists so you can see what you are declining. Judge the first
list on its own merits: a venue there at a modest rate with deep liquidity is
the right home for surplus, and holding everything liquid to chase nothing is
its own cost.

Call submit_allocation with the target holding for EACH venue after this run —
absolute amounts, not changes — plus what stays liquid. hold plus every
allocation must sum to exactly ${ctx.totalUsdc}.`;
}
