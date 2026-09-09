import { Fragment } from "react";
import { formatUsdc } from "./format.js";
import type { RunView } from "./api.js";

const LABEL: Record<string, string> = {
  PROPOSED: "Proposed",
  VALIDATED: "Validated",
  AWAITING_APPROVAL: "Awaiting your approval",
  EXECUTING: "Executing",
  SETTLED: "Settled",
  REJECTED: "Rejected",
  FAILED: "Stopped",
};

/** Venue name without the market address the id carries. */
function venue(marketId: string): string {
  const i = marketId.indexOf(":");
  return i === -1 ? marketId : marketId.slice(0, i);
}

export function RunBlotter({ run, onApprove, onReject, busy }: {
  run: RunView;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  busy: boolean;
}) {
  const p = run.proposal;
  const breaches = run.verdict?.breaches ?? [];
  const decidable = run.status === "AWAITING_APPROVAL";

  const amounts = p === null ? [] : [
    { name: "held liquid", amount: p.hold, kind: "hold" as const },
    ...p.allocations.map((a) => ({ name: venue(a.marketId), amount: a.amountUsdc, kind: "park" as const })),
  ];
  const largest = amounts.reduce(
    (max, a) => (BigInt(a.amount) > max ? BigInt(a.amount) : max), 1n);

  return (
    <div className="run" data-status={run.status}>
      <div className="run-head">
        <span className="run-id">{run.id}</span>
        <span className="status" data-status={run.status}>{LABEL[run.status] ?? run.status}</span>
      </div>

      {p === null
        ? <p className="rationale">
            {run.error ?? "This run stopped before the agent proposed anything."}
          </p>
        : <p className="rationale">{p.rationale}</p>}

      {amounts.length > 0 && (
        <div className="alloc">
          {amounts.map((a) => (
            <Fragment key={a.name}>
              <span className="alloc-name">{a.name}</span>
              <span className="alloc-amt">{formatUsdc(a.amount)}</span>
              <span
                className="alloc-bar"
                data-kind={a.kind}
                style={{ width: `${Number((BigInt(a.amount) * 100n) / largest)}%` }}
              />
            </Fragment>
          ))}
        </div>
      )}

      {breaches.length > 0 && (
        <ul className="breaches">
          {breaches.map((b) => (
            <li className="breach" key={b.invariant + b.observed}>
              <code>{b.invariant}</code>
              <span>{b.message}. Found {b.observed}, limit {b.limit}.</span>
            </li>
          ))}
        </ul>
      )}

      {decidable && (
        <div className="actions">
          <button onClick={() => onApprove(run.id)} disabled={busy}>Approve this run</button>
          <button className="secondary" onClick={() => onReject(run.id)} disabled={busy}>Reject</button>
        </div>
      )}
    </div>
  );
}
