import { describe, expect, it, vi } from "vitest";
import { createPrivyProvisioner, policyLabel } from "../src/index.js";

type Call = { path: string; body: Record<string, unknown> };

function fakePrivy(over: { policy?: unknown; wallet?: unknown; fail?: string } = {}) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const path = String(url).replace("https://api.privy.io", "");
    calls.push({ path, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    if (over.fail === path) {
      return new Response(JSON.stringify({ error: "nope" }), { status: 400 });
    }
    const body = path === "/v1/policies"
      ? over.policy ?? { id: "pol_1" }
      : over.wallet ?? { id: "wal_1", address: "0xabc" };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const ARGS = { name: "Acme Trading", perTxCeilingUsdcMinor: 10_000_000n, chainId: 5042002 };

describe("createPrivyProvisioner", () => {
  it("returns the wallet, its address and the policy guarding it", async () => {
    const { fetchImpl } = fakePrivy();
    const p = createPrivyProvisioner({ appId: "a", appSecret: "s", fetchImpl });
    expect(await p.provision(ARGS)).toEqual({ walletId: "wal_1", address: "0xabc", policyId: "pol_1" });
  });

  /**
   * Order is the whole point. A wallet created first and guarded second is
   * unguarded for as long as the second call takes, and onboarding is exactly
   * when an address is being watched.
   */
  it("creates the policy BEFORE the wallet, so the wallet is born guarded", async () => {
    const { calls, fetchImpl } = fakePrivy();
    await createPrivyProvisioner({ appId: "a", appSecret: "s", fetchImpl }).provision(ARGS);
    expect(calls.map((c) => c.path)).toEqual(["/v1/policies", "/v1/wallets"]);
  });

  it("attaches the policy at creation rather than in a later call", async () => {
    const { calls, fetchImpl } = fakePrivy();
    await createPrivyProvisioner({ appId: "a", appSecret: "s", fetchImpl }).provision(ARGS);
    expect(calls[1]?.body.policy_ids).toEqual(["pol_1"]);
  });

  /**
   * Arc's native USDC has 18 decimals; the ledger counts 6. Copying the
   * ledger's number straight into the policy would set a ceiling of
   * 0.00000000001 USDC and refuse everything.
   */
  it("converts the ceiling into the chain's decimals", async () => {
    const { calls, fetchImpl } = fakePrivy();
    await createPrivyProvisioner({ appId: "a", appSecret: "s", fetchImpl }).provision(ARGS);
    const rules = calls[0]?.body.rules as { conditions: { field: string; value: string }[] }[];
    const value = rules[0]?.conditions.find((c) => c.field === "value")?.value;
    expect(BigInt(value ?? "0x0")).toBe(10_000_000_000_000_000_000n); // 10 USDC at 18dp
  });

  it("pins the policy to one chain, so a signature elsewhere is not covered", async () => {
    const { calls, fetchImpl } = fakePrivy();
    await createPrivyProvisioner({ appId: "a", appSecret: "s", fetchImpl }).provision(ARGS);
    const rules = calls[0]?.body.rules as { conditions: { field: string; value: string }[] }[];
    expect(rules[0]?.conditions.find((c) => c.field === "chain_id")?.value).toBe("5042002");
  });

  it("refuses a zero or negative ceiling instead of provisioning an open wallet", async () => {
    const { fetchImpl } = fakePrivy();
    const p = createPrivyProvisioner({ appId: "a", appSecret: "s", fetchImpl });
    await expect(p.provision({ ...ARGS, perTxCeilingUsdcMinor: 0n })).rejects.toThrow(/positive/);
  });

  it("refuses an unnamed business", async () => {
    const { fetchImpl } = fakePrivy();
    const p = createPrivyProvisioner({ appId: "a", appSecret: "s", fetchImpl });
    await expect(p.provision({ ...ARGS, name: "   " })).rejects.toThrow(/name/);
  });

  /** No wallet should exist if the policy call failed. */
  it("does not create a wallet when the policy cannot be created", async () => {
    const { calls, fetchImpl } = fakePrivy({ fail: "/v1/policies" });
    const p = createPrivyProvisioner({ appId: "a", appSecret: "s", fetchImpl });
    await expect(p.provision(ARGS)).rejects.toThrow(/nope/);
    expect(calls.map((c) => c.path)).toEqual(["/v1/policies"]);
  });

  it("rejects a wallet response missing an address rather than storing undefined", async () => {
    const { fetchImpl } = fakePrivy({ wallet: { id: "wal_1" } });
    const p = createPrivyProvisioner({ appId: "a", appSecret: "s", fetchImpl });
    await expect(p.provision(ARGS)).rejects.toThrow(/unusable wallet/);
  });

  it("rejects a policy response missing an id rather than creating an unguarded wallet", async () => {
    const { calls, fetchImpl } = fakePrivy({ policy: { name: "x" } });
    const p = createPrivyProvisioner({ appId: "a", appSecret: "s", fetchImpl });
    await expect(p.provision(ARGS)).rejects.toThrow(/without an id/);
    expect(calls.map((c) => c.path)).toEqual(["/v1/policies"]);
  });
});

describe("policyLabel", () => {
  it("keeps a short name intact", () => {
    expect(policyLabel("Acme", " treasury envelope")).toBe("Acme treasury envelope");
  });

  it("trims a long name to something Privy accepts, keeping the suffix", () => {
    const label = policyLabel("A".repeat(80), " treasury envelope");
    expect(label.length).toBeLessThanOrEqual(50);
    expect(label.endsWith(" treasury envelope")).toBe(true);
    expect(label.startsWith("AAA")).toBe(true);
  });

  it("marks a trimmed name so nobody reads it as the full one", () => {
    expect(policyLabel("A".repeat(80), " treasury envelope")).toContain("…");
  });

  it("does not mark a name that fitted", () => {
    expect(policyLabel("Acme", " treasury envelope")).not.toContain("…");
  });
});
