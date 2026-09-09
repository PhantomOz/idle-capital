import { beforeEach, describe, expect, it } from "vitest";
import type { Proposal, Verdict } from "@idle/core";
import {
  IllegalTransitionError, LEGAL_TRANSITIONS, attachProposal, createRun, getRun, listRuns,
  openLedger, transitionRun, type Ledger,
} from "../src/index.js";

const PROPOSAL: Proposal = {
  hold: 40_000_000n,
  allocations: [{ marketId: "aave-v3:0xabc", amountUsdc: 60_000_000n }],
  rationale: "TZS payroll in six days; park the surplus.",
};

let l: Ledger;
beforeEach(() => { l = openLedger(":memory:"); });

describe("createRun", () => {
  it("starts a run in PROPOSED", () => {
    const r = createRun(l, "r1", PROPOSAL);
    expect(r.status).toBe("PROPOSED");
    expect(r.id).toBe("r1");
  });

  it("round-trips the proposal including its bigints", () => {
    createRun(l, "r1", PROPOSAL);
    const r = getRun(l, "r1");
    expect(r?.proposal?.hold).toBe(40_000_000n);
    expect(r?.proposal?.allocations[0]?.amountUsdc).toBe(60_000_000n);
  });

  it("returns null for a run that does not exist", () => {
    expect(getRun(l, "nope")).toBeNull();
  });
});

describe("transitionRun", () => {
  it("allows PROPOSED -> VALIDATED", () => {
    createRun(l, "r1", PROPOSAL);
    expect(transitionRun(l, "r1", "VALIDATED").status).toBe("VALIDATED");
  });

  it("allows the escalation path PROPOSED -> AWAITING_APPROVAL -> EXECUTING", () => {
    createRun(l, "r1", PROPOSAL);
    transitionRun(l, "r1", "AWAITING_APPROVAL");
    expect(transitionRun(l, "r1", "EXECUTING").status).toBe("EXECUTING");
  });

  it("allows a human to reject from AWAITING_APPROVAL", () => {
    createRun(l, "r1", PROPOSAL);
    transitionRun(l, "r1", "AWAITING_APPROVAL");
    expect(transitionRun(l, "r1", "REJECTED").status).toBe("REJECTED");
  });

  it("refuses to skip validation: PROPOSED -> EXECUTING", () => {
    createRun(l, "r1", PROPOSAL);
    expect(() => transitionRun(l, "r1", "EXECUTING")).toThrow(IllegalTransitionError);
  });

  it("refuses to move out of a terminal state", () => {
    createRun(l, "r1", PROPOSAL);
    transitionRun(l, "r1", "VALIDATED");
    transitionRun(l, "r1", "EXECUTING");
    transitionRun(l, "r1", "SETTLED");
    expect(() => transitionRun(l, "r1", "EXECUTING")).toThrow(IllegalTransitionError);
  });

  it("names both states in the error, so a log line is diagnosable", () => {
    createRun(l, "r1", PROPOSAL);
    expect(() => transitionRun(l, "r1", "SETTLED")).toThrow(/PROPOSED.*SETTLED|SETTLED.*PROPOSED/);
  });

  it("throws for a run that does not exist", () => {
    expect(() => transitionRun(l, "ghost", "VALIDATED")).toThrow(/not found/i);
  });

  it("stores the kernel verdict alongside the transition", () => {
    createRun(l, "r1", PROPOSAL);
    const verdict: Verdict = {
      kind: "escalated",
      breaches: [{ invariant: "K5", message: "too concentrated", observed: "70%", limit: "50%" }],
    };
    transitionRun(l, "r1", "AWAITING_APPROVAL", { verdict });
    expect(getRun(l, "r1")?.verdict).toEqual(verdict);
  });

  it("advances updated_at", async () => {
    createRun(l, "r1", PROPOSAL);
    const before = getRun(l, "r1")!.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    transitionRun(l, "r1", "VALIDATED");
    expect(getRun(l, "r1")!.updatedAt >= before).toBe(true);
  });
});

describe("LEGAL_TRANSITIONS", () => {
  it("makes every terminal state actually terminal", () => {
    for (const t of ["SETTLED", "REJECTED", "FAILED"] as const) {
      expect(LEGAL_TRANSITIONS[t]).toHaveLength(0);
    }
  });

  it("lets any non-terminal state fail", () => {
    for (const s of ["PROPOSED", "VALIDATED", "AWAITING_APPROVAL", "EXECUTING"] as const) {
      expect(LEGAL_TRANSITIONS[s]).toContain("FAILED");
    }
  });
});

describe("listRuns", () => {
  it("filters by status", () => {
    createRun(l, "r1", PROPOSAL);
    createRun(l, "r2", PROPOSAL);
    transitionRun(l, "r2", "AWAITING_APPROVAL");
    expect(listRuns(l, "AWAITING_APPROVAL").map((r) => r.id)).toEqual(["r2"]);
    expect(listRuns(l)).toHaveLength(2);
  });
});

describe("runs without a proposal yet", () => {
  it("can start a run before a proposal exists", () => {
    const r = createRun(l, "r1", null);
    expect(r.status).toBe("PROPOSED");
    expect(r.proposal).toBeNull();
  });

  it("can fail a run that never got a proposal, keeping the audit trail", () => {
    createRun(l, "r1", null);
    expect(transitionRun(l, "r1", "FAILED").status).toBe("FAILED");
  });

  it("attaches a proposal once it exists", () => {
    createRun(l, "r1", null);
    attachProposal(l, "r1", PROPOSAL);
    expect(getRun(l, "r1")?.proposal?.hold).toBe(40_000_000n);
  });

  it("refuses to attach a proposal outside PROPOSED", () => {
    createRun(l, "r1", PROPOSAL);
    transitionRun(l, "r1", "VALIDATED");
    expect(() => attachProposal(l, "r1", PROPOSAL)).toThrow(/PROPOSED/);
  });
});
