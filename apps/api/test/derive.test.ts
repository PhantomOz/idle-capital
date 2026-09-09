import { describe, expect, it } from "vitest";
import type { Position, Proposal } from "@idle/core";
import { deriveIntents } from "../src/index.js";

function prop(allocations: Proposal["allocations"], hold = 0n): Proposal {
  return { hold, allocations, rationale: "x" };
}

describe("deriveIntents", () => {
  it("deposits into a venue with no current position", () => {
    const out = deriveIntents(prop([{ marketId: "m1", amountUsdc: 10n }]), []);
    expect(out).toEqual([{ kind: "earn_deposit", amountUsdc: 10n, marketId: "m1" }]);
  });

  it("withdraws from a venue the target drops entirely", () => {
    const positions: Position[] = [{ marketId: "m1", amountUsdc: 10n }];
    const out = deriveIntents(prop([]), positions);
    expect(out).toEqual([{ kind: "earn_withdraw", amountUsdc: 10n, marketId: "m1" }]);
  });

  it("emits nothing when the target already matches", () => {
    const positions: Position[] = [{ marketId: "m1", amountUsdc: 10n }];
    expect(deriveIntents(prop([{ marketId: "m1", amountUsdc: 10n }]), positions)).toEqual([]);
  });

  it("emits only the difference, not the whole target", () => {
    const positions: Position[] = [{ marketId: "m1", amountUsdc: 4n }];
    const out = deriveIntents(prop([{ marketId: "m1", amountUsdc: 10n }]), positions);
    expect(out).toEqual([{ kind: "earn_deposit", amountUsdc: 6n, marketId: "m1" }]);
  });

  it("SEQUENCES WITHDRAWALS FIRST — you cannot deploy capital you have not freed", () => {
    const positions: Position[] = [{ marketId: "m1", amountUsdc: 10n }];
    const out = deriveIntents(prop([{ marketId: "m2", amountUsdc: 10n }]), positions);
    expect(out.map((i) => i.kind)).toEqual(["earn_withdraw", "earn_deposit"]);
    expect(out[0]?.marketId).toBe("m1");
    expect(out[1]?.marketId).toBe("m2");
  });

  it("handles a partial rebalance across three venues", () => {
    const positions: Position[] = [
      { marketId: "m1", amountUsdc: 100n },
      { marketId: "m2", amountUsdc: 50n },
    ];
    const out = deriveIntents(prop([
      { marketId: "m1", amountUsdc: 40n },
      { marketId: "m2", amountUsdc: 50n },
      { marketId: "m3", amountUsdc: 60n },
    ]), positions);
    expect(out).toEqual([
      { kind: "earn_withdraw", amountUsdc: 60n, marketId: "m1" },
      { kind: "earn_deposit", amountUsdc: 60n, marketId: "m3" },
    ]);
  });

  it("is deterministic, so a retry derives the identical sequence", () => {
    const positions: Position[] = [{ marketId: "m1", amountUsdc: 10n }];
    const p = prop([{ marketId: "m2", amountUsdc: 10n }]);
    expect(deriveIntents(p, positions)).toEqual(deriveIntents(p, positions));
  });
});
