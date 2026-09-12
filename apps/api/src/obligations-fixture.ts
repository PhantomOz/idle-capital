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
 * How far down the real schedule is scaled for a demo treasury.
 *
 * 8000 puts the four-currency schedule at about **$1.53**, which against a
 * treasury of a few real dollars leaves a buffer requirement of roughly $1.75
 * and a genuine surplus to decide about. A knob rather than a constant because
 * the treasury is no longer a fixed faucet balance — it is whatever real USDC
 * was sent to the wallet, so the right scale depends on that.
 *
 * Against the unscaled schedule the agent is correct to park nothing, every run,
 * forever: obligations exceed capital by three orders of magnitude and K1 vetoes
 * everything else. That proves the buffer invariant and nothing else.
 *
 * Scaling the obligations rather than inflating the treasury keeps every figure
 * in the demo a real one. The currencies, categories, due dates and FX table are
 * untouched; the deposit is a real deposit of its real amount. Only the
 * denomination moves, and it moves visibly.
 */
export function obligationScale(env: NodeJS.ProcessEnv = process.env): bigint {
  const raw = env.OBLIGATIONS_SCALE ?? "8000";
  if (!/^\d+$/.test(raw)) throw new Error(`OBLIGATIONS_SCALE must be a positive integer, got ${raw}`);
  const n = BigInt(raw);
  if (n === 0n) throw new Error("OBLIGATIONS_SCALE must be positive, got 0");
  return n;
}

export function scaledObligations(env: NodeJS.ProcessEnv = process.env): Obligation[] {
  const by = obligationScale(env);
  return BUSINESS_OBLIGATIONS.map((o) => ({
    ...o,
    id: `${o.id}-scaled`,
    amountMinor: o.amountMinor / by,
  }));
}

/** The default demo schedule, at the default scale. */
export const TESTNET_OBLIGATIONS: Obligation[] = scaledObligations({});

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
  if (choice === "testnet") return scaledObligations(env);
  throw new Error(`OBLIGATIONS must be "testnet" or "business", got ${choice}`);
}
