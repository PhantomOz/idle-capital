import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RunBlotter } from "../src/RunBlotter.js";
import type { RunView } from "../src/api.js";

const ESCALATED: RunView = {
  id: "run_1", status: "AWAITING_APPROVAL", createdAt: "2026-09-09T01:00:00Z",
  proposal: {
    hold: "40000000",
    allocations: [
      { marketId: "aave-v3:0xa", amountUsdc: "42000000" },
      { marketId: "compound-v3:0xb", amountUsdc: "18000000" },
    ],
    rationale: "TZS payroll of 4,200 falls due in six days.",
  },
  verdict: {
    kind: "escalated",
    breaches: [{ invariant: "K5", message: "aave-v3 would hold more than the permitted share",
                 observed: "70%", limit: "50%" }],
  },
};

describe("RunBlotter", () => {
  it("shows the agent's rationale in its own words", () => {
    render(<RunBlotter run={ESCALATED} onApprove={vi.fn()} onReject={vi.fn()} busy={false} />);
    expect(screen.getByText(/TZS payroll of 4,200/)).toBeTruthy();
  });

  it("shows every allocation with an exact amount", () => {
    render(<RunBlotter run={ESCALATED} onApprove={vi.fn()} onReject={vi.fn()} busy={false} />);
    expect(screen.getByText("42.000000")).toBeTruthy();
    expect(screen.getByText("40.000000")).toBeTruthy();
  });

  it("names the invariant that stopped the run and the limit it broke", () => {
    render(<RunBlotter run={ESCALATED} onApprove={vi.fn()} onReject={vi.fn()} busy={false} />);
    expect(screen.getByText("K5")).toBeTruthy();
    expect(screen.getByText(/50%/)).toBeTruthy();
  });

  it("offers approve and reject only while the run awaits a decision", () => {
    render(<RunBlotter run={ESCALATED} onApprove={vi.fn()} onReject={vi.fn()} busy={false} />);
    expect(screen.getByRole("button", { name: /approve/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /reject/i })).toBeTruthy();
  });

  it("offers no decision on a settled run", () => {
    const settled = { ...ESCALATED, status: "SETTLED", verdict: { kind: "approved" as const } };
    render(<RunBlotter run={settled} onApprove={vi.fn()} onReject={vi.fn()} busy={false} />);
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
  });

  it("calls back when a human approves", () => {
    const onApprove = vi.fn();
    render(<RunBlotter run={ESCALATED} onApprove={onApprove} onReject={vi.fn()} busy={false} />);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith("run_1");
  });

  it("disables both decisions while one is in flight", () => {
    render(<RunBlotter run={ESCALATED} onApprove={vi.fn()} onReject={vi.fn()} busy={true} />);
    expect(screen.getByRole("button", { name: /approve/i }).hasAttribute("disabled")).toBe(true);
  });

  it("explains a failed run instead of showing an empty panel", () => {
    const failed: RunView = {
      ...ESCALATED, status: "FAILED",
      verdict: { kind: "vetoed", breaches: [{ invariant: "K4", message: "protocol not allowlisted",
                                             observed: "rari-fuse", limit: "aave-v3" }] },
    };
    render(<RunBlotter run={failed} onApprove={vi.fn()} onReject={vi.fn()} busy={false} />);
    expect(screen.getByText("K4")).toBeTruthy();
  });
});
