import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Decision } from "../src/Decision.js";
import type { RunView } from "../src/api.js";

function run(over: Partial<RunView> = {}): RunView {
  return {
    id: "run_1", businessId: "b1", status: "SETTLED",
    proposal: {
      hold: "3450000",
      allocations: [{ marketId: "privy-earn:q52e", amountUsdc: "3550000" }],
      rationale: "The supplier payment and the rent both land this month.",
    },
    verdict: { kind: "approved" },
    error: null, createdAt: "2026-09-11T12:00:00Z",
    ...over,
  };
}

const noop = () => {};

describe("Decision headline", () => {
  /** A business owner reads one sentence. It has to carry the decision. */
  it("says what happened in dollars and plain words", () => {
    render(<Decision run={run()} onApprove={noop} onReject={noop} busy={false} />);
    expect(screen.getByText(/Kept \$3\.45 liquid and moved \$3\.55 into the USDC earn account/)).toBeTruthy();
  });

  it("names the venue in words, never as a market id", () => {
    render(<Decision run={run()} onApprove={noop} onReject={noop} busy={false} />);
    expect(screen.queryByText(/q52e/)).toBeNull();
  });

  it("uses the future tense while a decision is still waiting on a human", () => {
    render(<Decision run={run({ status: "AWAITING_APPROVAL" })} onApprove={noop} onReject={noop} busy={false} />);
    expect(screen.getByText(/Wants to keep/)).toBeTruthy();
  });

  it("says plainly that nothing moved when a human said no", () => {
    render(<Decision run={run({ status: "REJECTED" })} onApprove={noop} onReject={noop} busy={false} />);
    expect(screen.getByText(/You said no, so nothing moved/)).toBeTruthy();
  });

  it("describes holding everything as a decision, not an absence", () => {
    const r = run({ proposal: { hold: "7000000", allocations: [], rationale: "nothing worth it" } });
    render(<Decision run={r} onApprove={noop} onReject={noop} busy={false} />);
    expect(screen.getByText(/Keep all \$7\.00 where it is/)).toBeTruthy();
  });

  it("explains a run that never reached a proposal", () => {
    const r = run({ status: "FAILED", proposal: null, verdict: null, error: "the rates could not be fetched" });
    render(<Decision run={r} onApprove={noop} onReject={noop} busy={false} />);
    expect(screen.getByText(/did not get as far as a decision/)).toBeTruthy();
    expect(screen.getByText(/rates could not be fetched/)).toBeTruthy();
  });
});

describe("Decision safety rules", () => {
  const escalated = run({
    status: "AWAITING_APPROVAL",
    verdict: { kind: "escalated", breaches: [{
      invariant: "K5", message: "market privy-earn:q52e would hold more than the permitted share",
      observed: "3550000 of 3550000", limit: "1775000 (5000bps)",
    }] },
  });

  /** "K5" is not a reason. The sentence is. */
  it("explains an escalation in words a person can act on", () => {
    render(<Decision run={escalated} onApprove={noop} onReject={noop} busy={false} />);
    expect(screen.getByText(/would put too much of the surplus in a single venue/)).toBeTruthy();
  });

  it("still shows the rule code, so an operator can find the policy", () => {
    render(<Decision run={escalated} onApprove={noop} onReject={noop} busy={false} />);
    expect(screen.getByText("rule K5")).toBeTruthy();
  });

  it("offers approval only while the run is waiting on it", () => {
    render(<Decision run={escalated} onApprove={noop} onReject={noop} busy={false} />);
    expect(screen.getByRole("button", { name: /Approve/ })).toBeTruthy();
  });

  it("offers no approval on a run that already settled", () => {
    render(<Decision run={run()} onApprove={noop} onReject={noop} busy={false} />);
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
  });

  /** A veto is final. Offering a button would suggest otherwise. */
  it("says a vetoed run cannot be approved, and offers no way to try", () => {
    const vetoed = run({
      status: "FAILED",
      verdict: { kind: "vetoed", breaches: [{
        invariant: "K1", message: "buffer not covered", observed: "1", limit: "2",
      }] },
    });
    render(<Decision run={vetoed} onApprove={noop} onReject={noop} busy={false} />);
    expect(screen.getByText(/Nothing moved, and nothing can/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
  });

  it("shows the full ledger amounts alongside the rounded headline", () => {
    const { container } = render(<Decision run={run()} onApprove={noop} onReject={noop} busy={false} />);
    const alloc = container.querySelector(".alloc");
    expect(within(alloc as HTMLElement).getByText("3.550000")).toBeTruthy();
  });
});

describe("Decision disclosure", () => {
  /**
   * The committed figure must be attributed to whoever actually knows it. It
   * comes from the vault's own position report, so the copy says so — the
   * previous version disclaimed a deposit the executor never made, and the
   * failure mode to guard against now is the opposite one: claiming a yield
   * without saying whose number it is.
   */
  it("attributes the committed balance to the vault, not to us", () => {
    render(<Decision run={run()} onApprove={noop} onReject={noop} busy={false} />);
    expect(screen.getByText(/vault&rsquo;s answer, not ours|vault’s answer, not ours/)).toBeTruthy();
  });

  it("names the chain and the policy the signature happened under", () => {
    render(<Decision run={run()} onApprove={noop} onReject={noop} busy={false} />);
    expect(screen.getByText(/earn vault on Base/)).toBeTruthy();
    expect(screen.getByText(/own spending policy/)).toBeTruthy();
  });

  it("makes no such claim on a run that moved nothing", () => {
    const r = run({ proposal: { hold: "7000000", allocations: [], rationale: "held" } });
    render(<Decision run={r} onApprove={noop} onReject={noop} busy={false} />);
    expect(screen.queryByText(/mainnet step/)).toBeNull();
  });
});
