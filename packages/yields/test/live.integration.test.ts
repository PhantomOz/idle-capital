import { describe, expect, it } from "vitest";
import { getLendingMarkets } from "../src/index.js";

// Hits the real Subgraph Studio gateway. Skipped without a key so CI and
// contributors are not broken by its absence; run with `pnpm test:live`.
const KEY = process.env.GRAPH_API_KEY;
const live = KEY ? describe : describe.skip;

live("live Graph data (integration)", () => {
  it("returns real lending markets across many protocols", async () => {
    const res = await getLendingMarkets({ apiKey: KEY!, minProtocolQuorum: 5, timeoutMs: 60_000 });

    expect(res.protocolsSucceeded).toBeGreaterThanOrEqual(5);
    expect(res.markets.length).toBeGreaterThan(50);

    // Multi-protocol is the whole claim — one document, many protocols.
    const protocols = new Set(res.markets.map((m) => m.protocol));
    expect(protocols.size).toBeGreaterThanOrEqual(5);

    console.log(
      `live: ${res.markets.length} markets, ${protocols.size} protocols, ` +
      `${res.protocolsSucceeded}/${res.protocolsQueried} reachable`,
    );
  }, 90_000);

  it("returns plausible stablecoin supply rates", async () => {
    const res = await getLendingMarkets({
      apiKey: KEY!, assetSymbols: ["USDC", "USDT", "DAI"], minProtocolQuorum: 5, timeoutMs: 60_000,
    });
    expect(res.markets.length).toBeGreaterThan(5);

    // Normalized to a fraction. If the percent->fraction conversion ever
    // regresses, every rate lands around 3.0 instead of 0.03 and this fails.
    const blueChip = res.markets.filter((m) =>
      ["aave-v3", "compound-v3", "spark-lend"].includes(m.protocol));
    expect(blueChip.length).toBeGreaterThan(0);
    for (const m of blueChip) {
      expect(m.supplyApy).toBeGreaterThanOrEqual(0);
      expect(m.supplyApy).toBeLessThan(1); // < 100% — the fraction check
    }
  }, 90_000);
});
