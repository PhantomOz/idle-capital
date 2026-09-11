import { beforeEach, describe, expect, it } from "vitest";
import type { Obligation } from "@idle/core";
import {
  createBusiness, createRun, getBusiness, listBusinesses, listObligations,
  listRuns, listRunsForBusiness, openLedger, setObligations, type Ledger,
} from "../src/index.js";

let l: Ledger;
beforeEach(() => { l = openLedger(":memory:"); });

function biz(id: string, name = "Acme Trading") {
  return createBusiness(l, {
    id, name, walletId: `wal_${id}`, address: `0x${id}`, policyId: `pol_${id}`,
  });
}

const OBLIGATION: Obligation = {
  id: "o1", currency: "NGN", amountMinor: 480_000_000n,
  dueDate: "2026-09-25", category: "payroll", confidence: 1,
};

describe("businesses", () => {
  it("stores the wallet provisioned for the business", () => {
    const b = biz("b1");
    expect(b).toMatchObject({
      id: "b1", name: "Acme Trading",
      walletId: "wal_b1", address: "0xb1", policyId: "pol_b1",
    });
  });

  it("returns null for a business that does not exist, rather than throwing", () => {
    expect(getBusiness(l, "nope")).toBeNull();
  });

  it("refuses a duplicate id, so two businesses cannot share a wallet row", () => {
    biz("b1");
    expect(() => biz("b1")).toThrow();
  });

  it("lists businesses in creation order", () => {
    biz("b1", "First"); biz("b2", "Second");
    expect(listBusinesses(l).map((b) => b.name)).toEqual(["First", "Second"]);
  });
});

describe("obligations", () => {
  it("round-trips an amount through TEXT without losing precision", () => {
    biz("b1");
    setObligations(l, "b1", [{ ...OBLIGATION, amountMinor: 9_007_199_254_740_993n }]);
    expect(listObligations(l, "b1")[0]?.amountMinor).toBe(9_007_199_254_740_993n);
  });

  it("keeps currency, category, due date and confidence intact", () => {
    biz("b1");
    setObligations(l, "b1", [OBLIGATION]);
    expect(listObligations(l, "b1")[0]).toEqual(OBLIGATION);
  });

  it("replaces the schedule wholesale rather than appending to it", () => {
    biz("b1");
    setObligations(l, "b1", [OBLIGATION]);
    setObligations(l, "b1", [{ ...OBLIGATION, id: "o2", amountMinor: 1n }]);
    expect(listObligations(l, "b1").map((o) => o.id)).toEqual(["o2"]);
  });

  it("orders by due date, so the nearest obligation reads first", () => {
    biz("b1");
    setObligations(l, "b1", [
      { ...OBLIGATION, id: "late", dueDate: "2026-10-01" },
      { ...OBLIGATION, id: "soon", dueDate: "2026-09-15" },
    ]);
    expect(listObligations(l, "b1").map((o) => o.id)).toEqual(["soon", "late"]);
  });

  it("refuses a schedule for a business that does not exist", () => {
    expect(() => setObligations(l, "ghost", [OBLIGATION])).toThrow(/not found/);
  });

  it("clears a schedule when given an empty set", () => {
    biz("b1");
    setObligations(l, "b1", [OBLIGATION]);
    expect(setObligations(l, "b1", [])).toEqual([]);
  });

  /**
   * The whole point of tenancy. One business must never reserve against
   * another's payroll, in either direction.
   */
  it("never returns one business's obligations to another", () => {
    biz("b1"); biz("b2");
    setObligations(l, "b1", [{ ...OBLIGATION, id: "b1-payroll" }]);
    setObligations(l, "b2", [{ ...OBLIGATION, id: "b2-payroll" }]);
    expect(listObligations(l, "b1").map((o) => o.id)).toEqual(["b1-payroll"]);
    expect(listObligations(l, "b2").map((o) => o.id)).toEqual(["b2-payroll"]);
  });

  it("leaves the other business's schedule alone when one is replaced", () => {
    biz("b1"); biz("b2");
    setObligations(l, "b1", [{ ...OBLIGATION, id: "b1-payroll" }]);
    setObligations(l, "b2", [{ ...OBLIGATION, id: "b2-payroll" }]);
    setObligations(l, "b1", []);
    expect(listObligations(l, "b2").map((o) => o.id)).toEqual(["b2-payroll"]);
  });
});

describe("runs scoped to a business", () => {
  it("records which business a run belongs to", () => {
    biz("b1");
    expect(createRun(l, "r1", null, "b1").businessId).toBe("b1");
  });

  it("returns only that business's runs", () => {
    biz("b1"); biz("b2");
    createRun(l, "r1", null, "b1");
    createRun(l, "r2", null, "b2");
    expect(listRunsForBusiness(l, "b1").map((r) => r.id)).toEqual(["r1"]);
  });

  it("excludes unscoped runs from a business's history", () => {
    biz("b1");
    createRun(l, "legacy", null);
    createRun(l, "r1", null, "b1");
    expect(listRunsForBusiness(l, "b1").map((r) => r.id)).toEqual(["r1"]);
    expect(listRuns(l).map((r) => r.id)).toEqual(["legacy", "r1"]);
  });

  it("refuses a run for a business that does not exist", () => {
    expect(() => createRun(l, "r1", null, "ghost")).toThrow();
  });
});
