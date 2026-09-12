import { useState } from "react";
import type { BusinessView } from "./api.js";

/**
 * What to do with an address that has nothing in it.
 *
 * Onboarding hands back a real, empty wallet, and without this the product
 * dead-ends at the moment it starts being interesting.
 *
 * There is no longer a funding button. The treasury holds real USDC on Base
 * mainnet, and mainnet has no tap — so the honest affordance is the address and
 * what to send to it. The button that used to sit here moved testnet balances
 * between two accounts the project itself controlled, which taught a reviewer
 * nothing true about funding a treasury. D-024.
 */
export function Fund({ business }: { business: BusinessView }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="fund">
      <p className="fund-lead">
        <strong>{business.name} has no money yet.</strong> Send USDC on Base to this
        address and it becomes the treasury the agent works with.
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
      <p className="hint">
        Base mainnet, real USDC. This wallet was provisioned with a spending policy
        already attached — it can move funds into the allowlisted earn vault and
        nowhere else, whatever the agent proposes.
      </p>
    </div>
  );
}
