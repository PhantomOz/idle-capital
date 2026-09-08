import { describe, expect, it } from "vitest";
import { USDC_UNIT, divCeil, applyBpsCeil } from "../src/index.js";

describe("USDC_UNIT", () => {
  it("is 1e6 because USDC has six decimals", () => {
    expect(USDC_UNIT).toBe(1_000_000n);
  });
});

describe("divCeil", () => {
  it("returns the exact quotient when division is clean", () => {
    expect(divCeil(10n, 5n)).toBe(2n);
  });

  it("rounds up on any remainder, because under-reserving is unsafe", () => {
    expect(divCeil(10n, 3n)).toBe(4n);
    expect(divCeil(1n, 1_000_000n)).toBe(1n);
  });

  it("returns zero for a zero numerator", () => {
    expect(divCeil(0n, 7n)).toBe(0n);
  });

  it("returns zero for a negative numerator rather than a negative amount", () => {
    expect(divCeil(-5n, 7n)).toBe(0n);
  });

  it("throws on a non-positive denominator", () => {
    expect(() => divCeil(1n, 0n)).toThrow(RangeError);
    expect(() => divCeil(1n, -3n)).toThrow(RangeError);
  });
});

describe("applyBpsCeil", () => {
  it("applies a 1.15x safety factor", () => {
    expect(applyBpsCeil(1_000_000n, 11_500)).toBe(1_150_000n);
  });

  it("is the identity at 10000 bps", () => {
    expect(applyBpsCeil(123_456n, 10_000)).toBe(123_456n);
  });

  it("rounds up rather than truncating", () => {
    expect(applyBpsCeil(1n, 5_000)).toBe(1n);
  });

  it("returns zero at zero bps", () => {
    expect(applyBpsCeil(999n, 0)).toBe(0n);
  });

  it("throws on a non-integer or negative bps", () => {
    expect(() => applyBpsCeil(1n, 1.5)).toThrow(RangeError);
    expect(() => applyBpsCeil(1n, -1)).toThrow(RangeError);
  });
});
