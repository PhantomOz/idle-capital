import { describe, expect, it } from "vitest";
import type { Obligation } from "@idle/core";
import { bufferRequirementUsdc, scheduleByCurrency, withinHorizon } from "../src/index.js";

const ASOF = new Date("2026-09-09T00:00:00Z");

function ob(
  over: Partial<Obligation> & Pick<Obligation, "id" | "currency" | "amountMinor" | "dueDate">,
): Obligation {
  return { category: "supplier", confidence: 1, ...over };
}

describe("withinHorizon", () => {
  it("includes an obligation due inside the window", () => {
    expect(withinHorizon(ob({ id: "a", currency: "NGN", amountMinor: 1n, dueDate: "2026-09-20" }), 30, ASOF)).toBe(true);
  });

  it("includes an obligation due exactly on the horizon edge", () => {
    expect(withinHorizon(ob({ id: "a", currency: "NGN", amountMinor: 1n, dueDate: "2026-10-09" }), 30, ASOF)).toBe(true);
  });

  it("excludes an obligation due past the horizon", () => {
    expect(withinHorizon(ob({ id: "a", currency: "NGN", amountMinor: 1n, dueDate: "2026-10-10" }), 30, ASOF)).toBe(false);
  });

  it("INCLUDES a past-due obligation, which is still owed", () => {
    expect(withinHorizon(ob({ id: "a", currency: "NGN", amountMinor: 1n, dueDate: "2026-08-01" }), 30, ASOF)).toBe(true);
  });
});

describe("bufferRequirementUsdc", () => {
  it("is zero with no obligations", () => {
    expect(bufferRequirementUsdc([], 30, ASOF)).toBe(0n);
  });

  it("sums obligations across all four currencies in USDC", () => {
    const obligations = [
      ob({ id: "n", currency: "NGN", amountMinor: 160_000n, dueDate: "2026-09-15" }),
      ob({ id: "k", currency: "KES", amountMinor: 12_900n, dueDate: "2026-09-16" }),
      ob({ id: "g", currency: "GHS", amountMinor: 1_550n, dueDate: "2026-09-17" }),
      ob({ id: "t", currency: "TZS", amountMinor: 270_000n, dueDate: "2026-09-18" }),
    ];
    expect(bufferRequirementUsdc(obligations, 30, ASOF)).toBe(4_000_000n);
  });

  it("excludes obligations beyond the horizon", () => {
    const obligations = [
      ob({ id: "in", currency: "NGN", amountMinor: 160_000n, dueDate: "2026-09-15" }),
      ob({ id: "out", currency: "NGN", amountMinor: 160_000n, dueDate: "2026-12-01" }),
    ];
    expect(bufferRequirementUsdc(obligations, 30, ASOF)).toBe(1_000_000n);
  });

  it("does NOT discount low-confidence obligations — the buffer is a hard floor", () => {
    const obligations = [
      ob({ id: "n", currency: "NGN", amountMinor: 160_000n, dueDate: "2026-09-15", confidence: 0.1 }),
    ];
    expect(bufferRequirementUsdc(obligations, 30, ASOF)).toBe(1_000_000n);
  });
});

describe("scheduleByCurrency", () => {
  it("reports every currency, including those with nothing due", () => {
    const result = scheduleByCurrency(
      [ob({ id: "n", currency: "NGN", amountMinor: 160_000n, dueDate: "2026-09-15" })],
      30, ASOF,
    );
    expect(result).toEqual({ NGN: 1_000_000n, KES: 0n, GHS: 0n, TZS: 0n });
  });

  it("aggregates multiple obligations in the same currency", () => {
    const result = scheduleByCurrency(
      [
        ob({ id: "a", currency: "TZS", amountMinor: 270_000n, dueDate: "2026-09-15" }),
        ob({ id: "b", currency: "TZS", amountMinor: 270_000n, dueDate: "2026-09-16" }),
      ],
      30, ASOF,
    );
    expect(result.TZS).toBe(2_000_000n);
  });

  it("sums to the same total as bufferRequirementUsdc", () => {
    const obligations = [
      ob({ id: "n", currency: "NGN", amountMinor: 1_234_567n, dueDate: "2026-09-15" }),
      ob({ id: "k", currency: "KES", amountMinor: 98_765n, dueDate: "2026-09-16" }),
    ];
    const schedule = scheduleByCurrency(obligations, 30, ASOF);
    const summed = Object.values(schedule).reduce((a, b) => a + b, 0n);
    expect(summed).toBe(bufferRequirementUsdc(obligations, 30, ASOF));
  });
});
