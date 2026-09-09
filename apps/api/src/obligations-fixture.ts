import type { Obligation } from "@idle/core";

/**
 * The business's forward obligations, in the four currencies it trades in.
 *
 * This is company data, not market data — there is no feed to read it from,
 * and every treasury system takes it as input. The Graph tracks' live-data
 * rule is about the lending rates, which are fetched live and never faked.
 */
export const DEMO_OBLIGATIONS: Obligation[] = [
  { id: "ng-payroll-sep", currency: "NGN", amountMinor: 480_000_000n, dueDate: "2026-09-25",
    category: "payroll", confidence: 1 },
  { id: "ke-supplier-sep", currency: "KES", amountMinor: 38_700_000n, dueDate: "2026-09-18",
    category: "supplier", confidence: 0.9 },
  { id: "gh-rent-oct", currency: "GHS", amountMinor: 1_860_000n, dueDate: "2026-10-01",
    category: "rent", confidence: 1 },
  { id: "tz-payroll-sep", currency: "TZS", amountMinor: 1_350_000_000n, dueDate: "2026-09-15",
    category: "payroll", confidence: 1 },
];
