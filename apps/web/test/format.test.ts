import { describe, expect, it } from "vitest";
import { daysUntil, formatApy, formatDueDate, formatLocal, formatLocalMinor, formatUsdCompact, formatUsdc, formatUsdcShort } from "../src/format.js";

describe("formatUsdc", () => {
  it("renders six decimals, because exactness is the point", () => {
    expect(formatUsdc("40000000")).toBe("40.000000");
  });

  it("groups thousands", () => {
    expect(formatUsdc("1234567890123")).toBe("1,234,567.890123");
  });

  it("handles zero", () => {
    expect(formatUsdc("0")).toBe("0.000000");
  });

  it("handles a sub-unit amount without losing digits", () => {
    expect(formatUsdc("1")).toBe("0.000001");
  });

  it("NEVER goes through a float, so precision above 2^53 survives", () => {
    expect(formatUsdc("9007199254740993")).toBe("9,007,199,254.740993");
  });

  it("renders a negative amount with the sign in front", () => {
    expect(formatUsdc("-5000000")).toBe("-5.000000");
  });
});

describe("formatApy", () => {
  it("renders a fraction as a percentage with two decimals", () => {
    expect(formatApy(0.0356)).toBe("3.56%");
  });

  it("keeps an absurd rate legible rather than truncating it", () => {
    expect(formatApy(127281.9858)).toBe("12,728,198.58%");
  });

  it("renders zero", () => {
    expect(formatApy(0)).toBe("0.00%");
  });
});

describe("formatUsdCompact", () => {
  it("uses millions above a million", () => {
    expect(formatUsdCompact(209_500_000)).toBe("$209.5M");
  });

  it("uses thousands below a million", () => {
    expect(formatUsdCompact(45_300)).toBe("$45.3K");
  });

  it("shows a negative liquidity as negative, never as zero", () => {
    expect(formatUsdCompact(-4_700_000)).toBe("-$4.7M");
  });
});

describe("formatLocalMinor", () => {
  it("renders two minor digits for the trade currencies", () => {
    expect(formatLocalMinor("240000000", "NGN")).toBe("2,400,000.00");
  });
});

describe("formatUsdCompact billions", () => {
  it("uses billions rather than four-digit millions", () => {
    expect(formatUsdCompact(-1_279_500_000)).toBe("-$1.3B");
  });
});

describe("business-facing formatting", () => {
  it("shows an obligation the way the business wrote it", () => {
    expect(formatLocal("240000", "NGN")).toBe("₦2,400.00");
    expect(formatLocal("19350", "KES")).toBe("KSh193.50");
  });

  it("falls back to the code for a currency it has no symbol for", () => {
    expect(formatLocal("100", "XOF")).toBe("XOF1.00");
  });

  /** $3.56 beside a ledger row of 3.550000 invites the wrong question. */
  it("truncates the headline to cents rather than rounding up", () => {
    expect(formatUsdcShort("3559999")).toBe("$3.55");
  });

  it("formats a headline with thousands separators", () => {
    expect(formatUsdcShort("1234567890123")).toBe("$1,234,567.89");
  });

  it("never parses a headline through a Number", () => {
    expect(formatUsdcShort("9007199254740993000000")).toBe("$9,007,199,254,740,993.00");
  });

  it("writes a due date the way a person says it", () => {
    expect(formatDueDate("2026-09-20")).toBe("20 Sep");
    expect(formatDueDate("2026-10-01")).toBe("1 Oct");
  });

  it("leaves a value it cannot read as a date alone", () => {
    expect(formatDueDate("soon")).toBe("soon");
  });

  it("counts the days to a due date", () => {
    expect(daysUntil("2026-09-20", new Date("2026-09-11T13:00:00Z"))).toBe(9);
  });

  it("counts an overdue obligation as negative", () => {
    expect(daysUntil("2026-09-01", new Date("2026-09-11T13:00:00Z"))).toBe(-10);
  });
});
