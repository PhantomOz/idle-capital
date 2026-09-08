export type Currency = "NGN" | "KES" | "GHS" | "TZS";

export const CURRENCIES: readonly Currency[] = ["NGN", "KES", "GHS", "TZS"] as const;

/** All four trade currencies use two minor digits. */
export const CURRENCY_DECIMALS: Readonly<Record<Currency, number>> = {
  NGN: 2, KES: 2, GHS: 2, TZS: 2,
};

export type ObligationCategory = "payroll" | "supplier" | "tax" | "rent";

export type Obligation = {
  id: string;
  currency: Currency;
  /** Minor units of `currency`. Never a float. */
  amountMinor: bigint;
  /** ISO 8601 calendar date, `YYYY-MM-DD`. */
  dueDate: string;
  category: ObligationCategory;
  /**
   * 0..1 — how certain this falls due as scheduled. Informs the agent's
   * rationale; does NOT reduce the hard buffer floor.
   */
  confidence: number;
};
