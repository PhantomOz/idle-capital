import { CURRENCIES, type Currency, type Obligation } from "@idle/core";
import { FIXED_FX, toUsdcMinor, type FxTable } from "./fx.js";

const MS_PER_DAY = 86_400_000;

/**
 * Is this obligation the treasury's problem within `horizonDays`?
 *
 * Past-due obligations count. Something owed last month is still owed, and
 * excluding it would under-reserve exactly when the business is already late.
 */
export function withinHorizon(o: Obligation, horizonDays: number, asOf: Date): boolean {
  const due = Date.parse(`${o.dueDate}T00:00:00Z`);
  if (Number.isNaN(due)) return false;
  return due <= asOf.getTime() + horizonDays * MS_PER_DAY;
}

/**
 * Total USDC that must stay liquid to cover obligations within the horizon.
 *
 * `confidence` deliberately does NOT scale the amount. The buffer is a hard
 * floor; a 10%-likely payroll run still needs the cash on the day it lands.
 * Confidence is surfaced to the agent for its rationale instead.
 */
export function bufferRequirementUsdc(
  obligations: Obligation[],
  horizonDays: number,
  asOf: Date,
  fx: FxTable = FIXED_FX,
): bigint {
  return obligations
    .filter((o) => withinHorizon(o, horizonDays, asOf))
    .reduce((total, o) => total + toUsdcMinor(o.amountMinor, o.currency, fx), 0n);
}

/** The same total, split by currency, in USDC minor units. */
export function scheduleByCurrency(
  obligations: Obligation[],
  horizonDays: number,
  asOf: Date,
  fx: FxTable = FIXED_FX,
): Record<Currency, bigint> {
  const out = Object.fromEntries(CURRENCIES.map((c) => [c, 0n])) as Record<Currency, bigint>;
  for (const o of obligations) {
    if (!withinHorizon(o, horizonDays, asOf)) continue;
    out[o.currency] += toUsdcMinor(o.amountMinor, o.currency, fx);
  }
  return out;
}
