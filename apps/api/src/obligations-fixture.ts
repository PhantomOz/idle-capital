import type { Obligation } from "@idle/core";

/**
 * The business's forward obligations, in the four currencies it trades in.
 *
 * This is company data, not market data — there is no feed to read it from,
 * and every treasury system takes it as input. The Graph tracks' live-data
 * rule is about the lending rates, which are fetched live and never faked.
 *
 * Totals $12,200 over a 30-day horizon, which is the real shape of a
 * twenty-person operation across Lagos, Nairobi, Accra and Dar es Salaam.
 */
export const BUSINESS_OBLIGATIONS: Obligation[] = [
  { id: "ng-payroll-sep", currency: "NGN", amountMinor: 480_000_000n, dueDate: "2026-09-25",
    category: "payroll", confidence: 1 },
  { id: "ke-supplier-sep", currency: "KES", amountMinor: 38_700_000n, dueDate: "2026-09-18",
    category: "supplier", confidence: 0.9 },
  { id: "gh-rent-oct", currency: "GHS", amountMinor: 1_860_000n, dueDate: "2026-10-01",
    category: "rent", confidence: 1 },
  { id: "tz-payroll-sep", currency: "TZS", amountMinor: 1_350_000_000n, dueDate: "2026-09-15",
    category: "payroll", confidence: 1 },
];

/**
 * The same schedule at 1/2000 scale — $6.10 instead of $12,200.
 *
 * The treasury this demo controls is a testnet faucet balance of roughly 12
 * USDC. Against the real schedule the agent is correct to park nothing, every
 * run, forever: obligations exceed capital by three orders of magnitude and K1
 * vetoes anything else. That proves the buffer invariant and nothing else.
 *
 * Scaling the obligations instead of inflating the treasury keeps every figure
 * in the demo a real one: the currencies, the categories, the due dates and the
 * FX table are untouched, and the settlement is a real transaction for its real
 * amount. Only the denomination moves, and it moves visibly.
 */
export const TESTNET_OBLIGATIONS: Obligation[] = BUSINESS_OBLIGATIONS.map((o) => ({
  ...o,
  id: `${o.id}-scaled`,
  amountMinor: o.amountMinor / 2_000n,
}));

/**
 * Which schedule this process runs against.
 *
 * Defaults to the testnet scale so the documented `POST /runs` exercises the
 * whole pipeline — propose, validate, escalate, approve, settle. Set
 * `OBLIGATIONS=business` to watch K1 refuse the entire surplus instead.
 */
export function loadObligations(env: NodeJS.ProcessEnv = process.env): Obligation[] {
  const choice = env.OBLIGATIONS ?? "testnet";
  if (choice === "business") return BUSINESS_OBLIGATIONS;
  if (choice === "testnet") return TESTNET_OBLIGATIONS;
  throw new Error(`OBLIGATIONS must be "testnet" or "business", got ${choice}`);
}
