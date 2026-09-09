import { describe, expect, it } from "vitest";
import { ARC_TESTNET, usdcMinorToWei, weiToUsdcMinor } from "../src/index.js";

describe("ARC_TESTNET", () => {
  it("is chain 5042002", () => {
    expect(ARC_TESTNET.id).toBe(5042002);
  });

  it("declares USDC as the native currency, because on Arc it is", () => {
    expect(ARC_TESTNET.nativeCurrency.symbol).toBe("USDC");
    expect(ARC_TESTNET.nativeCurrency.decimals).toBe(18);
  });
});

describe("usdcMinorToWei", () => {
  it("scales six-decimal treasury units to eighteen-decimal wei", () => {
    expect(usdcMinorToWei(1_000_000n)).toBe(1_000_000_000_000_000_000n);
  });

  it("keeps a single minor unit representable", () => {
    expect(usdcMinorToWei(1n)).toBe(1_000_000_000_000n);
  });

  it("handles zero", () => {
    expect(usdcMinorToWei(0n)).toBe(0n);
  });
});

describe("weiToUsdcMinor", () => {
  it("is the inverse for whole units", () => {
    expect(weiToUsdcMinor(1_000_000_000_000_000_000n)).toBe(1_000_000n);
  });

  it("rounds DOWN, so a reported balance is never overstated", () => {
    expect(weiToUsdcMinor(1_999_999_999_999n)).toBe(1n);
  });

  it("round-trips every whole minor unit", () => {
    for (const n of [0n, 1n, 12_000_000n, 9_007_199_254_740_993n]) {
      expect(weiToUsdcMinor(usdcMinorToWei(n))).toBe(n);
    }
  });
});
