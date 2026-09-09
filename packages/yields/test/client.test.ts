import { describe, expect, it, vi } from "vitest";
import { QuorumNotMetError, getLendingMarkets } from "../src/index.js";

const MARKET = {
  id: "0xabc", name: "USDC",
  inputToken: { id: "0xusdc", symbol: "USDC", decimals: 6 },
  totalDepositBalanceUSD: "1000000", totalBorrowBalanceUSD: "400000",
  rates: [{ rate: "4.5", side: "LENDER", type: "VARIABLE" }],
};

function okFetch() {
  return vi.fn(async () => new Response(
    JSON.stringify({ data: { markets: [MARKET] } }), { status: 200 }));
}

const DEPLOYMENTS = [
  { protocol: "aave-v3", network: "ethereum", subgraphId: "a" },
  { protocol: "compound-v3", network: "ethereum", subgraphId: "b" },
  { protocol: "spark-lend", network: "ethereum", subgraphId: "c" },
];

describe("getLendingMarkets", () => {
  it("returns normalized markets from every reachable deployment", async () => {
    const res = await getLendingMarkets({
      apiKey: "k", deployments: DEPLOYMENTS, minProtocolQuorum: 1, fetchImpl: okFetch(),
    });
    expect(res.markets).toHaveLength(3);
    expect(res.protocolsQueried).toBe(3);
    expect(res.protocolsSucceeded).toBe(3);
  });

  it("sends the SAME query document to every deployment", async () => {
    const f = okFetch();
    await getLendingMarkets({ apiKey: "k", deployments: DEPLOYMENTS, minProtocolQuorum: 1, fetchImpl: f });
    const bodies = f.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)).query);
    expect(new Set(bodies).size).toBe(1);
  });

  it("never puts the api key in the URL", async () => {
    const f = okFetch();
    await getLendingMarkets({ apiKey: "secret", deployments: DEPLOYMENTS, minProtocolQuorum: 1, fetchImpl: f });
    for (const c of f.mock.calls) expect(String(c[0])).not.toContain("secret");
  });

  it("skips an unreachable deployment instead of failing the run", async () => {
    let n = 0;
    const f = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error("bad indexers: Unavailable");
      return new Response(JSON.stringify({ data: { markets: [MARKET] } }), { status: 200 });
    });
    const res = await getLendingMarkets({
      apiKey: "k", deployments: DEPLOYMENTS, minProtocolQuorum: 2, fetchImpl: f,
    });
    expect(res.protocolsSucceeded).toBe(2);
    expect(res.failures).toHaveLength(1);
  });

  it("treats a GraphQL error as a failed deployment, not usable data", async () => {
    const f = vi.fn(async () => new Response(
      JSON.stringify({ errors: [{ message: "Type `Query` has no field `markets`" }] }), { status: 200 }));
    await expect(getLendingMarkets({
      apiKey: "k", deployments: DEPLOYMENTS, minProtocolQuorum: 1, fetchImpl: f,
    })).rejects.toBeInstanceOf(QuorumNotMetError);
  });

  it("fails closed when too few protocols answer — no cache, no fixtures", async () => {
    const f = vi.fn(async () => { throw new Error("network down"); });
    await expect(getLendingMarkets({
      apiKey: "k", deployments: DEPLOYMENTS, minProtocolQuorum: 2, fetchImpl: f,
    })).rejects.toBeInstanceOf(QuorumNotMetError);
  });

  it("names the quorum it needed and what it got", async () => {
    const f = vi.fn(async () => { throw new Error("down"); });
    await getLendingMarkets({
      apiKey: "k", deployments: DEPLOYMENTS, minProtocolQuorum: 2, fetchImpl: f,
    }).catch((e: Error) => {
      expect(e.message).toContain("2");
      expect(e.message).toContain("0");
    });
  });

  it("filters to requested asset symbols when asked", async () => {
    const res = await getLendingMarkets({
      apiKey: "k", deployments: DEPLOYMENTS, minProtocolQuorum: 1,
      assetSymbols: ["USDT"], fetchImpl: okFetch(),
    });
    expect(res.markets).toHaveLength(0);
  });

  it("rejects an empty api key rather than querying anonymously", async () => {
    await expect(getLendingMarkets({
      apiKey: "", deployments: DEPLOYMENTS, minProtocolQuorum: 1, fetchImpl: okFetch(),
    })).rejects.toThrow(/api key/i);
  });
});
