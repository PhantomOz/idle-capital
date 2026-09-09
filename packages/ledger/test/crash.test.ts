import { describe, expect, it, vi } from "vitest";
import type { Proposal } from "@idle/core";
import {
  createRun, getRun, listIntents, markSubmitted, materialiseIntents,
  openLedger, reconcile, transitionRun, type ExecutionPort, type Intent,
} from "../src/index.js";

const PROPOSAL: Proposal = {
  hold: 40_000_000n,
  allocations: [{ marketId: "aave-v3:0xa", amountUsdc: 60_000_000n }],
  rationale: "park the surplus",
};
const SPECS = [
  { kind: "earn_deposit" as const, amountUsdc: 60_000_000n, marketId: "aave-v3:0xa" },
];

describe("crash and resume", () => {
  it("does not move money twice when the process dies mid-flight", async () => {
    // A chain that remembers every broadcast, so a double-spend is visible.
    const broadcasts: Intent[] = [];
    const landed = new Set<string>();
    const chain: ExecutionPort = {
      submit: vi.fn(async (i: Intent) => {
        broadcasts.push(i);
        const ref = `0xtx-${i.idempotencyKey}`;
        landed.add(ref); // it lands, but the process dies before recording it
        return ref;
      }),
      checkStatus: vi.fn(async (ref: string) => (landed.has(ref) ? "confirmed" : "pending")),
    };

    // --- process 1: broadcasts, then dies before recording the outcome ---
    const db = openLedger(":memory:");
    createRun(db, "r1", PROPOSAL);
    transitionRun(db, "r1", "VALIDATED");
    transitionRun(db, "r1", "EXECUTING");
    const [intent] = materialiseIntents(db, "r1", SPECS);
    const ref = await chain.submit(intent!);
    markSubmitted(db, intent!.id, ref);
    // <- crash here. The transfer is on-chain; the ledger says "submitted".

    expect(broadcasts).toHaveLength(1);
    expect(listIntents(db, "r1")[0]?.status).toBe("submitted");

    // --- process 2: same ledger, restarts, reconciles before doing anything ---
    const report = await reconcile(db, chain);

    expect(report.confirmed).toBe(1);
    expect(getRun(db, "r1")?.status).toBe("SETTLED");

    // THE ASSERTION THAT MATTERS: the money moved exactly once.
    expect(broadcasts).toHaveLength(1);
    expect(chain.submit).toHaveBeenCalledTimes(1);

    db.close();
  });

  it("re-materialising after a crash returns the submitted intent, not a fresh one", () => {
    const db = openLedger(":memory:");
    createRun(db, "r1", PROPOSAL);
    transitionRun(db, "r1", "VALIDATED");
    transitionRun(db, "r1", "EXECUTING");

    const [first] = materialiseIntents(db, "r1", SPECS);
    markSubmitted(db, first!.id, "0xtx");

    // The orchestrator restarts and recomputes the same intents from the
    // same proposal. It must NOT get a pending duplicate to submit.
    const [again] = materialiseIntents(db, "r1", SPECS);
    expect(again?.id).toBe(first?.id);
    expect(again?.status).toBe("submitted");
    expect(again?.txRef).toBe("0xtx");
    expect(listIntents(db, "r1")).toHaveLength(1);

    db.close();
  });
});
