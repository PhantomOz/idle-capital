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

const VAULT_ID = "q52e74l43z9plkapivrldsq3";
const ARGS = {
  name: "Acme Trading", perTxCeilingUsdcMinor: 10_000_000n, vaultId: VAULT_ID,
};

type Rule = { name: string; method: string; conditions: { field: string; value: string; abi?: unknown }[] };

async function rulesFor(over: Partial<typeof ARGS> = {}): Promise<Rule[]> {
  const { calls, fetchImpl } = fakePrivy();
  await createPrivyProvisioner({ appId: "a", appSecret: "s", fetchImpl }).provision({ ...ARGS, ...over });
  return calls[0]?.body.rules as Rule[];
}

function ruleFor(rules: Rule[], method: string): Rule | undefined {
  return rules.find((r) => r.method === method);
}

function condition(rule: Rule | undefined, field: string): string | undefined {
  return rule?.conditions.find((c) => c.field === field)?.value;
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
   * Privy fulfils an Earn deposit with an EIP-7702 transaction sent to the
   * wallet's own address, wrapping approve+deposit in an `execute` batch. So the
   * governable level is the action, not the transaction — a rule conditioned on
   * `to == vault` or decoding `approve.amount` from the outer calldata cannot
   * match, and an earlier version of this policy carried exactly those. The
   * deposit they appeared to bound was authorised by the action rule alone.
   */
  it("governs the action, not the prepared transaction", async () => {
    const methods = (await rulesFor()).map((r) => r.method);
    expect(methods).toContain("earn_deposit");
    expect(methods).toContain("earn_withdraw");
    expect(methods).not.toContain("eth_sendTransaction");
    expect(methods).not.toContain("eth_signTransaction");
  });

  it("binds the deposit to one vault id", async () => {
    expect(condition(ruleFor(await rulesFor(), "earn_deposit"), "vault_id")).toBe(VAULT_ID);
  });

  /**
   * raw_amount is in USDC's six decimals, which is the ledger's own minor unit,
   * so the ceiling passes through unscaled. The Arc policy this replaces had to
   * scale to eighteen, and getting that backwards in either direction is the
   * difference between a 10 USDC ceiling and no ceiling at all.
   */
  it("caps the deposit amount in the ledger's own unit, unscaled", async () => {
    const v = condition(ruleFor(await rulesFor(), "earn_deposit"), "raw_amount");
    expect(v).toBe("10000000"); // 10 USDC at 6dp, not 10e18
    expect(BigInt(v ?? "0")).toBe(10_000_000n);
  });

  it("reads the ceiling from the request body, not from a transaction field", async () => {
    const c = ruleFor(await rulesFor(), "earn_deposit")?.conditions ?? [];
    expect(c.length).toBeGreaterThan(0);
    for (const x of c) {
      expect((x as { field_source?: string }).field_source).toBe("action_request_body");
    }
  });

  /**
   * A ceiling on the way out is a trap, not a control: it creates capital that
   * cannot be retrieved in one operation.
   */
  it("puts no amount ceiling on withdrawals", async () => {
    const w = ruleFor(await rulesFor(), "earn_withdraw");
    expect(condition(w, "vault_id")).toBe(VAULT_ID);
    expect(condition(w, "raw_amount")).toBeUndefined();
    expect(condition(w, "amount")).toBeUndefined();
  });

  it("grants no wildcard method, so anything unlisted stays denied", async () => {
    const rules = await rulesFor();
    expect(rules.length).toBe(2);
    for (const r of rules) {
      expect(r.method).not.toBe("*");
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
