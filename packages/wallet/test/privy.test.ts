import { describe, expect, it, vi } from "vitest";
import { createPrivyArcExecutor, createPrivyClient, createPrivyTreasury, PolicyViolationError } from "../src/index.js";

function fakeFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}
type Calls = { mock: { calls: [string, RequestInit][] } };

const OPTS = { appId: "app", appSecret: "s3cret", walletId: "w1" };
const ADDRESS = "0xAbC0000000000000000000000000000000000001" as const;
const TX = { to: "0x1", value: "0x1" as const, chain_id: 5042002, nonce: 0,
             gas_limit: "0x5208" as const, max_fee_per_gas: "0x1" as const,
             max_priority_fee_per_gas: "0x1" as const };

describe("createPrivyClient", () => {
  it("authenticates in headers, never in the URL", async () => {
    const f = fakeFetch({ data: { signed_transaction: "0xdead" } });
    await createPrivyClient({ ...OPTS, fetchImpl: f }).signTransaction(TX);
    const [url, init] = (f as unknown as Calls).mock.calls[0]!;
    expect(url).not.toContain("s3cret");
    const h = init.headers as Record<string, string>;
    expect(h.authorization).toMatch(/^Basic /);
    expect(h["privy-app-id"]).toBe("app");
  });

  it("returns the signed transaction", async () => {
    const f = fakeFetch({ data: { signed_transaction: "0xsigned" } });
    expect(await createPrivyClient({ ...OPTS, fetchImpl: f }).signTransaction(TX)).toBe("0xsigned");
  });

  it("surfaces a policy denial as its own error type, not a generic failure", async () => {
    const f = fakeFetch({ error: "RPC request denied due to policy violation", code: "policy_violation" }, 400);
    await expect(createPrivyClient({ ...OPTS, fetchImpl: f }).signTransaction(TX))
      .rejects.toBeInstanceOf(PolicyViolationError);
  });

  it("throws when Privy answers without a signed transaction", async () => {
    const f = fakeFetch({ data: {} });
    await expect(createPrivyClient({ ...OPTS, fetchImpl: f }).signTransaction(TX)).rejects.toThrow(/no signed/i);
  });

  it("parses an earn position into bigints", async () => {
    const f = fakeFetch({ assets_in_vault: "5000000", shares_in_vault: "4900000",
                          total_deposited: "5000000", total_withdrawn: "0" });
    const p = await createPrivyClient({ ...OPTS, fetchImpl: f }).earnPosition("v1");
    expect(p.assetsInVault).toBe(5_000_000n);
    expect(p.totalWithdrawn).toBe(0n);
  });

  it("reads an empty earn position as zero rather than NaN", async () => {
    const f = fakeFetch({ assets_in_vault: "0", shares_in_vault: "0" });
    const p = await createPrivyClient({ ...OPTS, fetchImpl: f }).earnPosition("v1");
    expect(p.assetsInVault).toBe(0n);
    expect(p.totalDeposited).toBe(0n);
  });

  it("reads vault metadata", async () => {
    const f = fakeFetch({ id: "v1", name: "Steakhouse Prime USDC", user_apy: 371,
                          available_liquidity_usd: 195624354.5 });
    const v = await createPrivyClient({ ...OPTS, fetchImpl: f }).earnVault("v1");
    expect(v.name).toContain("Steakhouse");
    expect(v.userApyBps).toBe(371);
  });

  it("sends the deposit amount as a raw minor-unit string, never a float", async () => {
    const f = fakeFetch({ ok: true });
    await createPrivyClient({ ...OPTS, fetchImpl: f }).earnDeposit("v1", 5_000_000n, "run-1");
    const body = JSON.parse(String((f as unknown as Calls).mock.calls[0]![1].body));
    expect(body.raw_amount).toBe("5000000");
    expect(body.vault_id).toBe("v1");
  });
});

describe("createPrivyTreasury", () => {
  it("counts liquid plus parked as the treasury total", async () => {
    const arc = { getBalanceUsdcMinor: vi.fn(async () => 12_000_000n) };
    const snap = await createPrivyTreasury({
      arc: arc as never, address: ADDRESS,
      listPositions: async () => [{ marketId: "earn:v1", amountUsdc: 3_000_000n }],
    }).snapshot();
    expect(snap.totalUsdc).toBe(15_000_000n);
    expect(snap.positions).toHaveLength(1);
  });

  it("reports liquid-only when nothing is parked", async () => {
    const arc = { getBalanceUsdcMinor: vi.fn(async () => 12_000_000n) };
    const snap = await createPrivyTreasury({
      arc: arc as never, address: ADDRESS, listPositions: async () => [],
    }).snapshot();
    expect(snap.totalUsdc).toBe(12_000_000n);
  });
});

describe("createPrivyArcExecutor", () => {
  const intent = { amountUsdc: 1_000_000n };

  it("builds, signs through Privy, then broadcasts", async () => {
    const arc = {
      buildTransfer: vi.fn(async () => TX),
      broadcast: vi.fn(async () => "0xhash"),
      waitForReceipt: vi.fn(), getBalanceUsdcMinor: vi.fn(),
    };
    const privy = { signTransaction: vi.fn(async () => "0xsigned" as const) };
    const ex = createPrivyArcExecutor({ arc: arc as never, privy, address: ADDRESS,
                                        settlementAddress: "0x2" as never });
    expect(await ex.submit(intent)).toBe("0xhash");
    expect(arc.broadcast).toHaveBeenCalledWith("0xsigned");
  });

  it("does NOT broadcast when the policy refuses the signature", async () => {
    const arc = { buildTransfer: vi.fn(async () => TX), broadcast: vi.fn(),
                  waitForReceipt: vi.fn(), getBalanceUsdcMinor: vi.fn() };
    const privy = { signTransaction: vi.fn(async () => { throw new PolicyViolationError("denied"); }) };
    const ex = createPrivyArcExecutor({ arc: arc as never, privy: privy as never, address: ADDRESS,
                                        settlementAddress: "0x2" as never });
    await expect(ex.submit(intent)).rejects.toBeInstanceOf(PolicyViolationError);
    expect(arc.broadcast).not.toHaveBeenCalled();
  });

  it("maps a reverted receipt to failed, not confirmed", async () => {
    const arc = { waitForReceipt: vi.fn(async () => ({ status: "reverted" as const, blockNumber: 1n })) };
    const ex = createPrivyArcExecutor({ arc: arc as never, privy: {} as never, address: ADDRESS,
                                        settlementAddress: "0x2" as never });
    expect(await ex.checkStatus("0xhash")).toBe("failed");
  });

  it("reports pending rather than guessing when the receipt is not there yet", async () => {
    const arc = { waitForReceipt: vi.fn(async () => { throw new Error("timeout"); }) };
    const ex = createPrivyArcExecutor({ arc: arc as never, privy: {} as never, address: ADDRESS,
                                        settlementAddress: "0x2" as never });
    expect(await ex.checkStatus("0xhash")).toBe("pending");
  });
});
