import { useState } from "react";
import type { BusinessView } from "./api.js";

/**
 * What to do with an address that has nothing in it.
 *
 * Onboarding hands back a real, empty wallet. Without this, the product
 * dead-ends at the exact moment it starts being interesting — so the demo
 * faucet is offered here, and labelled as what it is.
 */
export function Fund({ business, onFund, busy }: {
  business: BusinessView;
  onFund: (amountUsdc: string) => void;
  busy: boolean;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="fund">
      <p className="fund-lead">
        <strong>{business.name} has no money yet.</strong> Send USDC to this address on Arc
        and it becomes the treasury the agent works with.
      </p>
      <div className="row">
        <code className="addr">{business.address}</code>
        <button
          className="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(business.address).then(
              () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
              () => setCopied(false),
            );
          }}
        >{copied ? "Copied" : "Copy"}</button>
      </div>
      <div className="row">
        <button onClick={() => onFund("5000000")} disabled={busy}>
          {busy ? "Sending…" : "Send 5 test USDC"}
        </button>
        <span className="hint">
          Testnet only. In production this is your finance team wiring real funds.
        </span>
      </div>
    </div>
  );
}
