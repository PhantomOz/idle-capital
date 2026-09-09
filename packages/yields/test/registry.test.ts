import { describe, expect, it } from "vitest";
import { LENDING_DEPLOYMENTS, LENDING_MARKETS_QUERY } from "../src/index.js";

describe("LENDING_DEPLOYMENTS", () => {
  it("covers enough protocols for the comparison to be credible", () => {
    expect(LENDING_DEPLOYMENTS.length).toBeGreaterThanOrEqual(20);
  });

  it("has a unique protocol per entry", () => {
    const protocols = LENDING_DEPLOYMENTS.map((d) => d.protocol);
    expect(new Set(protocols).size).toBe(protocols.length);
  });

  it("gives every entry a plausible subgraph id", () => {
    for (const d of LENDING_DEPLOYMENTS) {
      expect(d.subgraphId).toMatch(/^[1-9A-HJ-NP-Za-km-z]{40,50}$/);
      expect(d.network.length).toBeGreaterThan(0);
    }
  });

  it("includes every allowlisted blue-chip protocol", () => {
    const protocols = new Set(LENDING_DEPLOYMENTS.map((d) => d.protocol));
    for (const p of ["aave-v3", "compound-v3", "spark-lend"]) {
      expect(protocols.has(p)).toBe(true);
    }
  });

  it("deliberately includes rari-fuse, the trap the kernel must refuse", () => {
    expect(LENDING_DEPLOYMENTS.some((d) => d.protocol === "rari-fuse")).toBe(true);
  });
});

describe("LENDING_MARKETS_QUERY", () => {
  it("is a single document, reused for every protocol — that is the leverage", () => {
    expect(typeof LENDING_MARKETS_QUERY).toBe("string");
    expect(LENDING_MARKETS_QUERY).toContain("markets");
    expect(LENDING_MARKETS_QUERY).toContain("totalDepositBalanceUSD");
    expect(LENDING_MARKETS_QUERY).toContain("rates");
  });

  it("names no protocol, so it cannot have been specialised for one", () => {
    for (const p of ["aave", "compound", "spark", "morpho"]) {
      expect(LENDING_MARKETS_QUERY.toLowerCase()).not.toContain(p);
    }
  });
});
