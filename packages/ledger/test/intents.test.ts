import { beforeEach, describe, expect, it } from "vitest";
import type { Proposal } from "@idle/core";
import {
  IntentConflictError, createRun, findInFlight, intentKey, listIntents,
  markConfirmed, markFailed, markSubmitted, materialiseIntents, openLedger, type Ledger,
} from "../src/index.js";

const PROPOSAL: Proposal = { hold: 1n, allocations: [], rationale: "x" };
const SPECS = [
  { kind: "earn_withdraw" as const, amountUsdc: 10_000_000n, marketId: "aave-v3:0xa" },
  { kind: "settle_usdc" as const, amountUsdc: 4_000_000n },
];

let l: Ledger;
beforeEach(() => {
  l = openLedger(":memory:");
  createRun(l, "r1", PROPOSAL);
});

describe("intentKey", () => {
  it("is stable for the same run and sequence", () => {
    expect(intentKey("r1", 0)).toBe(intentKey("r1", 0));
  });

  it("differs across sequences and across runs", () => {
    expect(intentKey("r1", 0)).not.toBe(intentKey("r1", 1));
    expect(intentKey("r1", 0)).not.toBe(intentKey("r2", 0));
  });
});

describe("materialiseIntents", () => {
  it("creates one intent per spec, in order", () => {
    const out = materialiseIntents(l, "r1", SPECS);
    expect(out).toHaveLength(2);
    expect(out[0]?.seq).toBe(0);
    expect(out[1]?.seq).toBe(1);
    expect(out[0]?.kind).toBe("earn_withdraw");
  });

  it("starts every intent pending with no tx", () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    expect(i?.status).toBe("pending");
    expect(i?.txRef).toBeNull();
  });

  it("round-trips bigint amounts exactly", () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    expect(i?.amountUsdc).toBe(10_000_000n);
  });

  it("IS IDEMPOTENT — calling twice does not create a second set", () => {
    materialiseIntents(l, "r1", SPECS);
    const second = materialiseIntents(l, "r1", SPECS);
    expect(second).toHaveLength(2);
    expect(listIntents(l, "r1")).toHaveLength(2);
  });

  it("returns the EXISTING intents on the second call, not fresh ones", () => {
    const first = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, first[0]!.id, "0xtx");
    const second = materialiseIntents(l, "r1", SPECS);
    // The already-submitted intent must come back as-is, never reset to pending
    expect(second[0]?.id).toBe(first[0]?.id);
    expect(second[0]?.status).toBe("submitted");
    expect(second[0]?.txRef).toBe("0xtx");
  });

  it("refuses to reuse a key for different content", () => {
    materialiseIntents(l, "r1", SPECS);
    expect(() => materialiseIntents(l, "r1", [
      { kind: "earn_withdraw", amountUsdc: 999n, marketId: "aave-v3:0xa" },
    ])).toThrow(IntentConflictError);
  });

  it("names the mismatch so the bug is findable", () => {
    materialiseIntents(l, "r1", SPECS);
    expect(() => materialiseIntents(l, "r1", [
      { kind: "earn_withdraw", amountUsdc: 999n, marketId: "aave-v3:0xa" },
    ])).toThrow(/999|10000000/);
  });
});

describe("status transitions", () => {
  it("moves pending -> submitted -> confirmed", () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    expect(markSubmitted(l, i!.id, "0xtx").status).toBe("submitted");
    expect(markConfirmed(l, i!.id).status).toBe("confirmed");
  });

  it("records the failure reason", () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    const f = markFailed(l, i!.id, "reverted: insufficient allowance");
    expect(f.status).toBe("failed");
    expect(f.error).toContain("allowance");
  });

  it("keeps the txRef when an intent fails after submission", () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, i!.id, "0xtx");
    expect(markFailed(l, i!.id, "reverted").txRef).toBe("0xtx");
  });
});

describe("findInFlight", () => {
  it("finds submitted intents and nothing else", () => {
    const out = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, out[0]!.id, "0xtx");
    const flight = findInFlight(l);
    expect(flight).toHaveLength(1);
    expect(flight[0]?.id).toBe(out[0]?.id);
  });

  it("is empty once everything has settled", () => {
    const out = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, out[0]!.id, "0xtx");
    markConfirmed(l, out[0]!.id);
    expect(findInFlight(l)).toHaveLength(0);
  });
});
