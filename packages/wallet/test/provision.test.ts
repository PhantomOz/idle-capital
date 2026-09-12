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

const VAULT = "0xa6d1811a72a1cc1a4d536c4476c56da8d234d38d" as const;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const ARGS = {
  name: "Acme Trading", perTxCeilingUsdcMinor: 10_000_000n, chainId: 8453,
  vaultAddress: VAULT, usdcAddress: USDC,
};

type Rule = { name: string; method: string; conditions: { field: string; value: string; abi?: unknown }[] };

async function rulesFor(over: Partial<typeof ARGS> = {}): Promise<Rule[]> {
  const { calls, fetchImpl } = fakePrivy();
  await createPrivyProvisioner({ appId: "a", appSecret: "s", fetchImpl }).provision({ ...ARGS, ...over });
  return calls[0]?.body.rules as Rule[];
}

function condition(rules: Rule[], ruleName: string, field: string): string | undefined {
  return rules.find((r) => r.name === ruleName)?.conditions.find((c) => c.field === field)?.value;
}

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
   * A native-value ceiling is denominated in the chain's 18 decimals while the
   * ledger counts 6, so it is scaled. Copying the ledger's number in would set
   * a ceiling of 0.00000000001 and refuse everything.
   */
  it("scales the native-value ceiling to 18 decimals", async () => {
    const v = condition(await rulesFor(), "Native transfers under ceiling", "value");
    expect(BigInt(v ?? "0x0")).toBe(10_000_000_000_000_000_000n); // 10 USDC at 18dp
  });

  /**
   * The mirror of the above, and the one that bit on the move to Base: USDC's
   * own `approve` argument is already in six decimals, so scaling it would set a
   * ceiling a trillion times too high — which is to say, no ceiling at all.
   */
  it("does NOT scale the approve ceiling, because ERC-20 USDC is already 6dp", async () => {
    const v = condition(await rulesFor(), "Approve no more than the ceiling", "approve.amount");
    expect(BigInt(v ?? "0x0")).toBe(10_000_000n); // 10 USDC at 6dp
  });

  it("carries an ABI on the calldata condition, so Privy can decode the amount", async () => {
    const rules = await rulesFor();
    const c = rules.find((r) => r.name === "Approve no more than the ceiling")
      ?.conditions.find((x) => x.field === "approve.amount");
    expect(c?.abi).toBeDefined();
  });

  it("pins every rule to one chain, so a signature elsewhere is not covered", async () => {
    const rules = await rulesFor();
    expect(rules.length).toBeGreaterThan(2);
    for (const r of rules) {
      expect(r.conditions.find((c) => c.field === "chain_id")?.value).toBe("8453");
    }
  });

  /**
   * Privy's policy engine denies anything no rule allows, so the destination
   * list is the whole of where this wallet can send money.
   */
  it("allowlists the vault and USDC as destinations", async () => {
    const rules = await rulesFor();
    const tos = rules.flatMap((r) => r.conditions.filter((c) => c.field === "to").map((c) => c.value));
    expect(tos).toContain(VAULT);
    expect(tos).toContain(USDC);
  });

  it("does not allowlist a destination nobody asked for", async () => {
    const rules = await rulesFor();
    const tos = rules.flatMap((r) => r.conditions.filter((c) => c.field === "to").map((c) => c.value));
    expect(tos).not.toContain("0x000000000000000000000000000000000000dEaD");
  });

  it("admits extra destinations when the operator configures them", async () => {
    const helper = "0x1111111111111111111111111111111111111111" as const;
    const rules = await rulesFor({ extraDestinations: [helper] } as Partial<typeof ARGS>);
    const tos = rules.flatMap((r) => r.conditions.filter((c) => c.field === "to").map((c) => c.value));
    expect(tos).toContain(helper);
  });

  it("grants no wildcard method, so an unlisted RPC call stays denied", async () => {
    for (const r of await rulesFor()) {
      expect(r.method).not.toBe("*");
      expect(["eth_sendTransaction", "eth_signTransaction"]).toContain(r.method);
      expect(r.conditions.length).toBeGreaterThan(0); // an unconditioned ALLOW is a wildcard by another name
    }
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
