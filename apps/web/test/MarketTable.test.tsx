import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarketTable } from "../src/MarketTable.js";
import type { MarketView, PolicyView } from "../src/api.js";

const POLICY: PolicyView = {
  protocolAllowlist: ["aave-v3"],
  minVenueLiquidityUsd: 1_000_000,
  maxVenueConcentrationBps: 5_000,
  bufferHorizonDays: 30,
};

function m(over: Partial<MarketView>): MarketView {
  return {
    id: "x", protocol: "aave-v3", chain: "ethereum",
    asset: { symbol: "USDC", decimals: 6, address: "0x" },
    supplyApy: 0.0356, totalSuppliedUsd: 1e8, totalBorrowedUsd: 4e7, liquidityUsd: 6e7,
    ...over,
  };
}

describe("MarketTable", () => {
  it("lists a market the treasury may actually use", () => {
    render(<MarketTable markets={[m({ id: "a" })]} policy={POLICY} />);
    expect(screen.getByText("3.56%")).toBeTruthy();
  });

  it("leads with the best rate on offer and why it is refused", () => {
    render(<MarketTable
      markets={[m({ id: "a" }), m({ id: "r", protocol: "rari-fuse", supplyApy: 127281.98 })]}
      policy={POLICY} />);
    expect(screen.getByText("12,728,198.00%")).toBeTruthy();
    expect(screen.getByText(/not on the allowlist/i)).toBeTruthy();
  });

  it("refuses a market below the liquidity floor, naming that reason", () => {
    const { container } = render(
      <MarketTable markets={[m({ id: "l", liquidityUsd: -4_700_000 })]} policy={POLICY} />);
    // The phrase also appears in the footnote, so scope to the headline.
    const headline = container.querySelector(".refusal-body");
    expect(headline?.textContent).toMatch(/below the liquidity floor/i);
  });

  it("keeps refused markets out of the usable table rather than repeating them", () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      m({ id: `r${i}`, protocol: "rari-fuse", supplyApy: 9 - i }));
    render(<MarketTable markets={[...many, m({ id: "a" })]} policy={POLICY} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain("aave-v3");
  });

  it("counts what it refused, so nothing is silently dropped", () => {
    const many = Array.from({ length: 3 }, (_, i) =>
      m({ id: `r${i}`, protocol: "rari-fuse", supplyApy: 9 - i }));
    render(<MarketTable markets={[...many, m({ id: "a" })]} policy={POLICY} />);
    expect(screen.getByText(/3 of 4 markets refused/i)).toBeTruthy();
  });

  it("says what the agent will do when nothing clears the policy", () => {
    render(<MarketTable markets={[m({ id: "r", protocol: "rari-fuse" })]} policy={POLICY} />);
    expect(screen.getByText(/hold\s+everything liquid/i)).toBeTruthy();
  });

  it("directs rather than apologises when there is nothing to show", () => {
    render(<MarketTable markets={[]} policy={POLICY} />);
    expect(screen.getByText(/no market data/i)).toBeTruthy();
  });
});
