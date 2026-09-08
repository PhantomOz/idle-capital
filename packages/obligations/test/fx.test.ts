import { describe, expect, it } from "vitest";
import { FIXED_FX, toUsdcMinor } from "../src/index.js";

describe("FIXED_FX", () => {
  it("documents when it was captured and that it is not a live oracle", () => {
    expect(FIXED_FX.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(FIXED_FX.source.length).toBeGreaterThan(0);
  });

  it("covers all four trade currencies", () => {
    expect(Object.keys(FIXED_FX.minorPerUsd).sort()).toEqual(["GHS", "KES", "NGN", "TZS"]);
  });
});

describe("toUsdcMinor", () => {
  it("converts exactly one dollar's worth of NGN to one USDC", () => {
    // 160_000 kobo === 1600.00 NGN === 1 USD at the fixed rate
    expect(toUsdcMinor(160_000n, "NGN")).toBe(1_000_000n);
  });

  it("converts each currency at its own rate", () => {
    expect(toUsdcMinor(12_900n, "KES")).toBe(1_000_000n);
    expect(toUsdcMinor(1_550n, "GHS")).toBe(1_000_000n);
    expect(toUsdcMinor(270_000n, "TZS")).toBe(1_000_000n);
  });

  it("scales linearly", () => {
    expect(toUsdcMinor(1_600_000n, "NGN")).toBe(10_000_000n);
  });

  it("rounds up so a converted obligation is never under-reserved", () => {
    // 1 kobo is a vanishing fraction of a USDC, but it must not vanish to zero
    expect(toUsdcMinor(1n, "NGN")).toBe(7n);
  });

  it("returns zero for a zero amount", () => {
    expect(toUsdcMinor(0n, "NGN")).toBe(0n);
  });

  it("accepts an injected table so rates are never hard-wired into callers", () => {
    const table = { ...FIXED_FX, minorPerUsd: { ...FIXED_FX.minorPerUsd, NGN: 200_000n } };
    expect(toUsdcMinor(200_000n, "NGN", table)).toBe(1_000_000n);
  });
});
