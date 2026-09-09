import { describe, expect, it } from "vitest";
import { formatApy, formatLocalMinor, formatUsdCompact, formatUsdc } from "../src/format.js";

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
