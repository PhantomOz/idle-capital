import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BASE_MAINNET, BASE_USDC, createBaseUsdcClient, usdcMinorToWei,
} from "../src/index.js";

describe("BASE_MAINNET", () => {
  it("is chain 8453", () => {
    expect(BASE_MAINNET.id).toBe(8453);
  });

  it("declares ETH as the native currency, unlike Arc where USDC is native", () => {
    expect(BASE_MAINNET.nativeCurrency.symbol).toBe("ETH");
    expect(BASE_MAINNET.nativeCurrency.decimals).toBe(18);
  });
});

describe("BASE_USDC", () => {
  it("is Circle's canonical Base USDC", () => {
    expect(BASE_USDC).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  });
});

describe("createBaseUsdcClient", () => {
  it("reports six decimals, which is the ledger's own minor unit", () => {
    expect(createBaseUsdcClient("http://127.0.0.1:1").decimals).toBe(6);
  });

  it("defaults to canonical USDC but accepts an override", () => {
    expect(createBaseUsdcClient("http://127.0.0.1:1").usdcAddress).toBe(BASE_USDC);
    const alt = "0x1111111111111111111111111111111111111111" as const;
    expect(createBaseUsdcClient("http://127.0.0.1:1", alt).usdcAddress).toBe(alt);
  });
});

/**
 * A real JSON-RPC endpoint, so the test exercises viem's encode/decode rather
 * than a stub of our own method. Without this the "no scaling" claim below
 * would be asserting against whatever the test itself made up.
 */
describe("createBaseUsdcClient against a live JSON-RPC endpoint", () => {
  let server: Server;
  let url = "";
  const calls: { method: string; params: unknown }[] = [];
  /** 2.230910 USDC, exactly as a six-decimal ERC-20 reports it. */
  const RAW_BALANCE = 2_230_910n;

  function word(v: bigint): string {
    return `0x${v.toString(16).padStart(64, "0")}`;
  }

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const rpc = JSON.parse(body) as { id: number; method: string; params: unknown };
        calls.push({ method: rpc.method, params: rpc.params });
        const result =
          rpc.method === "eth_call" ? word(RAW_BALANCE)
          : rpc.method === "eth_getBalance" ? word(1_500_000_000_000_000n)
          : rpc.method === "eth_chainId" ? "0x2105"
          : "0x";
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    if (addr === null || typeof addr === "string") throw new Error("no port");
    url = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("returns the contract's value verbatim — no scaling on the Base path", async () => {
    const got = await createBaseUsdcClient(url).getBalanceUsdcMinor(
      "0x8621fCBa1B2bB29E53F0327aB3aEeFBB1857739F",
    );
    expect(got).toBe(RAW_BALANCE);
    // Arc's native USDC needs 10^12 scaling; proving the units genuinely differ
    // is what stops someone "fixing" Base by copying Arc's conversion in.
    expect(usdcMinorToWei(RAW_BALANCE)).not.toBe(RAW_BALANCE);
  });

  it("asks the USDC contract, not the native balance, for the treasury figure", async () => {
    calls.length = 0;
    await createBaseUsdcClient(url).getBalanceUsdcMinor(
      "0x8621fCBa1B2bB29E53F0327aB3aEeFBB1857739F",
    );
    const call = calls.find((c) => c.method === "eth_call");
    expect(call).toBeDefined();
    const [tx] = call!.params as [{ to: string; data: string }];
    expect(tx.to.toLowerCase()).toBe(BASE_USDC.toLowerCase());
    // balanceOf(address) selector, then the address right-aligned in a word.
    expect(tx.data.slice(0, 10)).toBe("0x70a08231");
    expect(tx.data.toLowerCase()).toContain("8621fcba1b2bb29e53f0327ab3aeefbb1857739f");
  });

  it("reads native ETH separately, for the case where gas is not sponsored", async () => {
    const wei = await createBaseUsdcClient(url).getGasBalanceWei(
      "0x8621fCBa1B2bB29E53F0327aB3aEeFBB1857739F",
    );
    expect(wei).toBe(1_500_000_000_000_000n);
  });
});
