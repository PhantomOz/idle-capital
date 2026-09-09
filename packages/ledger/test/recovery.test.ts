import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Proposal } from "@idle/core";
import {
  createRun, getRun, listIntents, markSubmitted, materialiseIntents,
  openLedger, reconcile, transitionRun, type ExecutionPort, type Ledger,
} from "../src/index.js";

const PROPOSAL: Proposal = { hold: 1n, allocations: [], rationale: "x" };
const SPECS = [{ kind: "settle_usdc" as const, amountUsdc: 1_000_000n }];

let l: Ledger;
beforeEach(() => {
  l = openLedger(":memory:");
  createRun(l, "r1", PROPOSAL);
  transitionRun(l, "r1", "VALIDATED");
  transitionRun(l, "r1", "EXECUTING");
});

function port(status: "confirmed" | "failed" | "pending"): ExecutionPort {
  return { submit: vi.fn(async () => "0xnew"), checkStatus: vi.fn(async () => status) };
}

describe("reconcile", () => {
  it("confirms an intent whose transaction landed while we were down", async () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, i!.id, "0xtx");
    const report = await reconcile(l, port("confirmed"));
    expect(report.confirmed).toBe(1);
    expect(listIntents(l, "r1")[0]?.status).toBe("confirmed");
  });

  it("fails an intent whose transaction reverted while we were down", async () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, i!.id, "0xtx");
    const report = await reconcile(l, port("failed"));
    expect(report.failed).toBe(1);
    expect(listIntents(l, "r1")[0]?.status).toBe("failed");
  });

  it("leaves a still-pending transaction alone rather than guessing", async () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, i!.id, "0xtx");
    const report = await reconcile(l, port("pending"));
    expect(report.stillPending).toBe(1);
    expect(listIntents(l, "r1")[0]?.status).toBe("submitted");
  });

  it("NEVER resubmits — that is the whole point", async () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, i!.id, "0xtx");
    const p = port("pending");
    await reconcile(l, p);
    expect(p.submit).not.toHaveBeenCalled();
  });

  it("settles the run once every intent is confirmed", async () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, i!.id, "0xtx");
    await reconcile(l, port("confirmed"));
    expect(getRun(l, "r1")?.status).toBe("SETTLED");
  });

  it("fails the run when an intent failed", async () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, i!.id, "0xtx");
    await reconcile(l, port("failed"));
    expect(getRun(l, "r1")?.status).toBe("FAILED");
  });

  it("leaves the run EXECUTING while anything is still pending", async () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, i!.id, "0xtx");
    await reconcile(l, port("pending"));
    expect(getRun(l, "r1")?.status).toBe("EXECUTING");
  });

  it("does nothing when there is nothing in flight", async () => {
    const p = port("confirmed");
    const report = await reconcile(l, p);
    expect(report.checked).toBe(0);
    expect(p.checkStatus).not.toHaveBeenCalled();
  });

  it("survives a port that throws, leaving the intent in flight", async () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, i!.id, "0xtx");
    const bad: ExecutionPort = {
      submit: vi.fn(async () => "x"),
      checkStatus: vi.fn(async () => { throw new Error("rpc down"); }),
    };
    const report = await reconcile(l, bad);
    expect(report.stillPending).toBe(1);
    expect(listIntents(l, "r1")[0]?.status).toBe("submitted");
  });
});
