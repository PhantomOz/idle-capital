import { describe, expect, it, vi } from "vitest";
import {
  createPrivyEarnExecutor, earnMarketId, UnreachableVenueError,
} from "../src/earn.js";
import { earnAction, parseEarnStatus } from "../src/privy.js";

const VAULT = "q52e74l43z9plkapivrldsq3";
const MARKET = earnMarketId(VAULT);
const ACTION_ID = "3f1a9c20-5b7e-4c1d-9f83-2a6d4e8b7c11";

function intent(over: Partial<Parameters<ReturnType<typeof createPrivyEarnExecutor>["submit"]>[0]> = {}) {
  return {
    kind: "earn_deposit",
    amountUsdc: 8_000_000n,
    marketId: MARKET,
    idempotencyKey: "run_abc:0",
    ...over,
  };
}

function privy(over: Record<string, unknown> = {}) {
  return {
    earnDeposit: vi.fn(async () => earnAction({ id: ACTION_ID, status: "pending" })),
    earnWithdraw: vi.fn(async () => earnAction({ id: ACTION_ID, status: "pending" })),
    walletAction: vi.fn(async () => earnAction({ id: ACTION_ID, status: "succeeded" })),
    ...over,
  } as never;
}

describe("earnMarketId", () => {
  it("matches the id the market list advertises, so intents line up", () => {
    expect(earnMarketId(VAULT)).toBe("privy-earn:q52e74l43z9plkapivrldsq3");
  });
});

describe("parseEarnStatus", () => {
  it("accepts exactly Privy's documented statuses", () => {
    for (const s of ["pending", "succeeded", "rejected", "failed"]) {
      expect(parseEarnStatus(s)).toBe(s);
    }
  });

  it("maps anything unrecognised to unknown rather than guessing success", () => {
    for (const s of ["SUCCEEDED", "ok", "complete", "", undefined, null, 1, {}]) {
      expect(parseEarnStatus(s)).toBe("unknown");
    }
  });
});

describe("createPrivyEarnExecutor.submit", () => {
  it("deposits with the amount and our idempotency key as the reference", async () => {
    const p = privy();
    const ex = createPrivyEarnExecutor({ privy: p, vaultId: VAULT });
    const ref = await ex.submit(intent());
    expect(ref).toBe(ACTION_ID);
    expect(p.earnDeposit).toHaveBeenCalledWith(VAULT, 8_000_000n, "run_abc:0");
  });

  it("routes a withdrawal to withdraw, not deposit", async () => {
    const p = privy();
    const ex = createPrivyEarnExecutor({ privy: p, vaultId: VAULT });
    await ex.submit(intent({ kind: "earn_withdraw", amountUsdc: 2_500_000n }));
    expect(p.earnWithdraw).toHaveBeenCalledWith(VAULT, 2_500_000n, "run_abc:0");
    expect(p.earnDeposit).not.toHaveBeenCalled();
  });

  it("accepts an intent with no market id, since the vault is implied", async () => {
    const p = privy();
    const ex = createPrivyEarnExecutor({ privy: p, vaultId: VAULT });
    await expect(ex.submit(intent({ marketId: null }))).resolves.toBe(ACTION_ID);
  });

  // The regression that matters: the Arc executor ignored marketId, so an
  // allocation into a Base vault silently became a transfer on Arc.
  it("refuses a venue it cannot reach instead of substituting its own", async () => {
    const p = privy();
    const ex = createPrivyEarnExecutor({ privy: p, vaultId: VAULT });
    await expect(ex.submit(intent({ marketId: "aave-v3:0xdeadbeef" })))
      .rejects.toThrow(UnreachableVenueError);
    expect(p.earnDeposit).not.toHaveBeenCalled();
  });

  it("refuses a settlement transfer rather than executing it as a deposit", async () => {
    const p = privy();
    const ex = createPrivyEarnExecutor({ privy: p, vaultId: VAULT });
    await expect(ex.submit(intent({ kind: "settle_usdc", marketId: null })))
      .rejects.toThrow(/cannot perform "settle_usdc"/);
    expect(p.earnDeposit).not.toHaveBeenCalled();
  });

  it("fails loudly when Privy returns no action id to reconcile against", async () => {
    const p = privy({ earnDeposit: vi.fn(async () => earnAction({ status: "pending" })) });
    const ex = createPrivyEarnExecutor({ privy: p, vaultId: VAULT });
    await expect(ex.submit(intent())).rejects.toThrow(/returned no action id/);
  });
});

describe("createPrivyEarnExecutor.checkStatus", () => {
  const cases: [string, "confirmed" | "failed" | "pending"][] = [
    ["succeeded", "confirmed"],
    ["failed", "failed"],
    ["rejected", "failed"],
    ["pending", "pending"],
  ];

  for (const [status, expected] of cases) {
    it(`maps ${status} to ${expected}`, async () => {
      const p = privy({ walletAction: vi.fn(async () => earnAction({ id: ACTION_ID, status })) });
      const ex = createPrivyEarnExecutor({ privy: p, vaultId: VAULT });
      expect(await ex.checkStatus(ACTION_ID)).toBe(expected);
    });
  }

  it("treats an unrecognised status as pending, never confirmed", async () => {
    const p = privy({ walletAction: vi.fn(async () => earnAction({ id: ACTION_ID, status: "settled" })) });
    const ex = createPrivyEarnExecutor({ privy: p, vaultId: VAULT });
    expect(await ex.checkStatus(ACTION_ID)).toBe("pending");
  });

  it("treats an unreadable action as pending, so reconcile retries the read", async () => {
    const p = privy({ walletAction: vi.fn(async () => { throw new Error("503"); }) });
    const ex = createPrivyEarnExecutor({ privy: p, vaultId: VAULT });
    expect(await ex.checkStatus(ACTION_ID)).toBe("pending");
  });

  it("reads the action back by the txRef submit returned", async () => {
    const p = privy();
    const ex = createPrivyEarnExecutor({ privy: p, vaultId: VAULT });
    const ref = await ex.submit(intent());
    await ex.checkStatus(ref);
    expect(p.walletAction).toHaveBeenCalledWith(ACTION_ID);
  });
});
