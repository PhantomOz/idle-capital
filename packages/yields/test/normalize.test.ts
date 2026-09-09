import { describe, expect, it } from "vitest";
import { normalizeMarket } from "../src/index.js";

const RAW = {
  id: "0xabc",
  name: "Aave Ethereum DAI",
  inputToken: { id: "0xdai", symbol: "DAI", decimals: 18 },
  totalDepositBalanceUSD: "131595831.1534137147814969299405428",
  totalBorrowBalanceUSD: "114166728.5342580216394213977897205",
  rates: [
    { rate: "0", side: "BORROWER", type: "STABLE" },
    { rate: "4.7147302816931436", side: "BORROWER", type: "VARIABLE" },
    { rate: "3.0674951411720908", side: "LENDER", type: "VARIABLE" },
  ],
};

describe("normalizeMarket", () => {
  it("converts the schema's PERCENT rate into a fraction", () => {
    const m = normalizeMarket(RAW, "aave-v3", "ethereum");
    expect(m?.supplyApy).toBeCloseTo(0.030674951, 8);
  });

  it("picks the LENDER/VARIABLE rate, not the first or the borrower rate", () => {
    const m = normalizeMarket(RAW, "aave-v3", "ethereum");
    expect(m?.supplyApy).not.toBe(0);
    expect(m?.supplyApy).toBeLessThan(0.04);
  });

  it("parses decimal strings into numbers", () => {
    const m = normalizeMarket(RAW, "aave-v3", "ethereum");
    expect(m?.totalSuppliedUsd).toBeCloseTo(131595831.15, 2);
    expect(m?.totalBorrowedUsd).toBeCloseTo(114166728.53, 2);
  });

  it("derives liquidity as supplied minus borrowed", () => {
    const m = normalizeMarket(RAW, "aave-v3", "ethereum");
    expect(m?.liquidityUsd).toBeCloseTo(17429102.62, 2);
  });

  it("does NOT clamp negative liquidity — K7 must see the real value", () => {
    const broken = { ...RAW, totalDepositBalanceUSD: "100", totalBorrowBalanceUSD: "4700000" };
    const m = normalizeMarket(broken, "rari-fuse", "ethereum");
    expect(m?.liquidityUsd).toBeLessThan(0);
  });

  it("namespaces the id by protocol so ids cannot collide across subgraphs", () => {
    const a = normalizeMarket(RAW, "aave-v3", "ethereum");
    const b = normalizeMarket(RAW, "compound-v3", "ethereum");
    expect(a?.id).not.toBe(b?.id);
    expect(a?.id).toContain("aave-v3");
  });

  it("carries the protocol through, because K4 allowlists on it", () => {
    expect(normalizeMarket(RAW, "aave-v3", "ethereum")?.protocol).toBe("aave-v3");
  });

  it("returns null when there is no lender rate to rank on", () => {
    const noLender = { ...RAW, rates: [{ rate: "1", side: "BORROWER", type: "VARIABLE" }] };
    expect(normalizeMarket(noLender, "aave-v3", "ethereum")).toBeNull();
  });

  it("returns null for a market with no input token", () => {
    expect(normalizeMarket({ ...RAW, inputToken: null }, "aave-v3", "ethereum")).toBeNull();
  });

  it("returns null on unparseable numbers rather than yielding NaN", () => {
    const bad = { ...RAW, totalDepositBalanceUSD: "not-a-number" };
    expect(normalizeMarket(bad, "aave-v3", "ethereum")).toBeNull();
  });

  it("returns null for malformed input instead of throwing", () => {
    for (const bad of [null, undefined, 42, "market", []]) {
      expect(normalizeMarket(bad, "aave-v3", "ethereum")).toBeNull();
    }
  });
});
