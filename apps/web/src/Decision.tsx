import { Fragment } from "react";
import { formatUsdc, formatUsdcShort } from "./format.js";
import type { RunView } from "./api.js";

const LABEL: Record<string, string> = {
  PROPOSED: "Thinking",
  VALIDATED: "Checked",
  AWAITING_APPROVAL: "Needs you",
  EXECUTING: "Moving",
  SETTLED: "Done",
  REJECTED: "You said no",
  FAILED: "Stopped",
};

/**
 * What each invariant means to the person who has to decide about it.
 *
 * The codes stay visible — they are how an operator finds the rule in the
 * policy, and a reviewer checks the kernel actually ran — but they lead with
 * the sentence, not the identifier. "K5" is not a reason.
 */
const RULE: Record<string, string> = {
  K1: "would leave less cash than the bills coming due need",
  K2: "does not add up — the parts do not equal the total",
  K3: "names a venue that is not in today's market data",
  K4: "chose a venue outside the ones you allow",
  K5: "would put too much of the surplus in a single venue",
  K6: "would move more money in one go than your limit allows",
  K7: "chose a venue that might not let you withdraw again",
  K8: "was not a well-formed proposal",
};

const VENUE: Record<string, string> = {
  "privy-earn": "USDC earn account",
  "aave-v3": "Aave v3",
  "aave-v2": "Aave v2",
  "compound-v3": "Compound v3",
  "compound-v2": "Compound v2",
  "spark-lend": "Spark",
};

function venue(marketId: string): string {
  const i = marketId.indexOf(":");
  const protocol = i === -1 ? marketId : marketId.slice(0, i);
  return VENUE[protocol] ?? protocol;
}

/** One sentence a business owner can act on, before any detail. */
function headline(run: RunView): string {
  const p = run.proposal;
  if (p === null) return "The agent did not get as far as a decision.";
  const parked = p.allocations.reduce((sum, a) => sum + BigInt(a.amountUsdc), 0n);
  const held = formatUsdcShort(p.hold);

  if (parked === 0n) return `Keep all ${held} where it is. Nothing was worth moving to.`;
  const where = p.allocations.length === 1 && p.allocations[0] !== undefined
    ? venue(p.allocations[0].marketId)
    : `${p.allocations.length} venues`;

  const earn = formatUsdcShort(parked.toString());
  switch (run.status) {
    case "SETTLED":
      return `Kept ${held} liquid and moved ${earn} into the ${where}.`;
    case "AWAITING_APPROVAL":
      return `Wants to keep ${held} liquid and move ${earn} into the ${where}.`;
    case "REJECTED":
      return `Wanted to move ${earn} into the ${where}. You said no, so nothing moved.`;
    case "FAILED":
      return `Wanted to move ${earn} into the ${where}, but the run stopped before it could.`;
    default:
      return `Keeping ${held} liquid, moving ${earn} into the ${where}.`;
  }
}

export function Decision({ run, onApprove, onReject, busy }: {
  run: RunView;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  busy: boolean;
}) {
  const p = run.proposal;
  const breaches = run.verdict?.breaches ?? [];
  const decidable = run.status === "AWAITING_APPROVAL";
  const vetoed = run.verdict?.kind === "vetoed";

  const amounts = p === null ? [] : [
    { name: "Stays liquid", amount: p.hold, kind: "hold" as const },
    ...p.allocations.map((a) => ({
      name: venue(a.marketId), amount: a.amountUsdc, kind: "park" as const,
    })),
  ];
  const largest = amounts.reduce((max, a) => (BigInt(a.amount) > max ? BigInt(a.amount) : max), 1n);

  return (
    <div className="run" data-status={run.status}>
      <div className="run-head">
        <p className="headline">{headline(run)}</p>
        <span className="status" data-status={run.status}>{LABEL[run.status] ?? run.status}</span>
      </div>

      {p === null
        ? <p className="rationale">{run.error ?? "This run stopped before the agent proposed anything."}</p>
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
        <div className="checks" data-vetoed={vetoed ? "yes" : "no"}>
          <p className="checks-lead">
            {vetoed
              ? "The safety rules stopped this. Nothing moved, and nothing can."
              : "The safety rules want a human on this one:"}
          </p>
          <ul className="breaches">
            {breaches.map((b) => (
              <li className="breach" key={b.invariant + b.observed}>
                <span>It {RULE[b.invariant] ?? b.message}.</span>
                <code title={`${b.message}. Found ${b.observed}, limit ${b.limit}.`}>
                  rule {b.invariant}
                </code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {run.status === "SETTLED" && p !== null && p.allocations.length > 0 && (
        <p className="seam">
          Settled on Arc, signed by this business&rsquo;s own wallet. Moving the funds into
          the vault itself is a mainnet step this testnet demo does not take, so the
          committed balance is this treasury&rsquo;s own record rather than a yield already
          being collected.
        </p>
      )}

      {decidable && (
        <div className="actions">
          <button onClick={() => onApprove(run.id)} disabled={busy}>Approve — move the money</button>
          <button className="secondary" onClick={() => onReject(run.id)} disabled={busy}>
            No, leave it alone
          </button>
        </div>
      )}

      <p className="run-id">{run.id}</p>
    </div>
  );
}
