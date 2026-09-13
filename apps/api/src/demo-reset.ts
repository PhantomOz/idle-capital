/**
 * Return a business's parked capital to liquid, so the demo can be run again.
 *
 * After a settled run the treasury is already where the agent wants it, so the
 * next run correctly decides nothing — which is the right behaviour and a dull
 * recording. This puts the money back on the near side of the decision.
 *
 *   tsx --env-file-if-exists=.env apps/api/src/demo-reset.ts biz_demo
 *
 * This is an OPERATOR action, not an agent one, and it deliberately does not go
 * through the run state machine: no run is created, no intent is recorded, and
 * the ledger gains no history claiming the agent decided something it did not.
 * It is the same category of act as funding the wallet in the first place.
 *
 * The withdrawal is real. The wallet policy permits it without an amount
 * ceiling, which is the point of leaving exits uncapped (D-026).
 */
import { getBusiness, listBusinesses, openLedger } from "@idle/ledger";
import { createPrivyClient } from "@idle/wallet";

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") throw new Error(`${name} is not set`);
  return v;
}

const appId = required("PRIVY_APP_ID");
const appSecret = required("PRIVY_APP_SECRET");
const vaultId = required("PRIVY_EARN_VAULT_ID");
const usdc = (n: bigint): string => `$${(Number(n) / 1e6).toFixed(6)}`;

const ledger = openLedger(process.env.LEDGER_PATH ?? ".idle/ledger.db");
const id = process.argv[2] ?? "biz_demo";
const business = getBusiness(ledger, id);
if (business === null) {
  console.error(`No business ${id}. Known: ${listBusinesses(ledger).map((b) => b.id).join(", ")}`);
  process.exit(1);
}

const privy = createPrivyClient({ appId, appSecret, walletId: business.walletId });
const position = await privy.earnPosition(vaultId);
console.log(`${business.name}: ${usdc(position.assetsInVault)} parked`);

if (position.assetsInVault === 0n) {
  console.log("Nothing to pull back — already fully liquid.");
  ledger.close();
  process.exit(0);
}

const action = await privy.earnWithdraw(
  vaultId, position.assetsInVault, `demo-reset-${Date.now()}`);
console.log(`withdrawing ${usdc(position.assetsInVault)} — action ${action.id}`);

// Poll to a terminal state. Reporting "done" on a pending action is the exact
// mistake the run state machine refuses to make, so this does not make it either.
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 4000));
  const now = await privy.walletAction(action.id);
  if (now.status === "succeeded") {
    const after = await privy.earnPosition(vaultId);
    console.log(`done — ${usdc(after.assetsInVault)} still parked`);
    console.log("The treasury is liquid again. `Run it again` now has a decision to make.");
    ledger.close();
    process.exit(0);
  }
  if (now.status === "rejected" || now.status === "failed") {
    console.error(`withdrawal ${now.status}. Nothing moved; the funds are still in the vault.`);
    ledger.close();
    process.exit(1);
  }
  process.stdout.write(".");
}
console.error("\nStill pending after 80s. It may yet land — check before retrying.");
ledger.close();
process.exit(1);
