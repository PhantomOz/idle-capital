import { describe, expect, it, vi } from "vitest";
import type { Policy } from "@idle/core";
import { createProposer } from "../src/index.js";

const POLICY: Policy = {
  bufferHorizonDays: 30, bufferMultiplierBps: 11_500,
  protocolAllowlist: ["aave-v3"], maxVenueConcentrationBps: 5_000,
  maxRunMovementUsdc: 500_000_000_000n, minVenueLiquidityUsd: 1_000_000,
};
const CTX = {
  markets: [], positions: [], totalUsdc: 100_000_000n, bufferRequiredUsdc: 0n,
  scheduleByCurrency: {}, obligations: [], policy: POLICY,
  asOf: new Date("2026-09-09T00:00:00Z"),
};

function fakeClient(content: unknown[]) {
  return { messages: { create: vi.fn(async () => ({ content })) } };
}

describe("createProposer", () => {
  it("returns the proposal the model submitted through the tool", async () => {
    const client = fakeClient([{ type: "tool_use", name: "submit_allocation",
      input: { hold: "40000000", allocations: [{ marketId: "m1", amountUsdc: "60000000" }],
               rationale: "payroll in six days" } }]);
    const p = await createProposer({ client: client as never, model: "test" }).propose(CTX as never);
    expect(p.hold).toBe(40_000_000n);
    expect(p.rationale).toContain("payroll");
  });

  it("throws when the model answers in prose instead of calling the tool", async () => {
    const client = fakeClient([{ type: "text", text: "I think you should park it all." }]);
    await expect(createProposer({ client: client as never, model: "test" }).propose(CTX as never))
      .rejects.toThrow(/tool/i);
  });

  it("throws when the tool payload cannot be parsed, rather than inventing a proposal", async () => {
    const client = fakeClient([{ type: "tool_use", name: "submit_allocation",
      input: { hold: "not-a-number", allocations: [], rationale: "x" } }]);
    await expect(createProposer({ client: client as never, model: "test" }).propose(CTX as never))
      .rejects.toThrow(/invalid/i);
  });

  it("forces the tool rather than leaving the model the choice", async () => {
    const client = fakeClient([{ type: "tool_use", name: "submit_allocation",
      input: { hold: "100000000", allocations: [], rationale: "hold" } }]);
    await createProposer({ client: client as never, model: "test" }).propose(CTX as never);
    const args = client.messages.create.mock.calls[0]?.[0] as { tool_choice?: { type: string } };
    expect(args.tool_choice?.type).toBe("tool");
  });
});
