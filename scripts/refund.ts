/**
 * Send the settlement account's Arc balance back to the treasury wallet.
 *
 * The settlement leg is a real transfer to a real counterparty, so running the
 * demo twice drains the treasury below its own buffer requirement and every
 * later run correctly parks nothing. This returns the funds so the pipeline can
 * be demonstrated again.
 *
 * This is the one place a private key is used, and it is the faucet EOA's, not
 * the treasury's — the treasury wallet has no key anywhere in this repo, which
 * is the whole point of D-014. Funding and refunding are the same category of
 * operator action.
 */
import { createPublicClient, createWalletClient, http, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") throw new Error(`${name} is not set`);
  return v;
}

const rpc = required("ARC_RPC_URL");
const chain = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
} as const;

const key = required("ARC_PRIVATE_KEY");
const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
const treasury = required("PRIVY_WALLET_ADDRESS") as Address;
const settlement = (process.env.SETTLEMENT_ADDRESS ?? treasury) as Address;

if (settlement.toLowerCase() === treasury.toLowerCase()) {
  console.log("SETTLEMENT_ADDRESS is the treasury wallet — nothing to refund.");
  process.exit(0);
}
if (account.address.toLowerCase() !== settlement.toLowerCase()) {
  throw new Error(
    `ARC_PRIVATE_KEY controls ${account.address}, but SETTLEMENT_ADDRESS is ${settlement}. ` +
    `Only the settlement account can refund itself.`,
  );
}

const pub = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ account, chain, transport: http(rpc) });

const balance = await pub.getBalance({ address: account.address });
const fees = await pub.estimateFeesPerGas();
const gasLimit = 21_000n;
const maxFeePerGas = fees.maxFeePerGas ?? 1_000_000_000n;
const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? 1_000_000_000n;

// Reserve twice the estimated fee and pin the fee fields to the same numbers
// the reserve was computed from. Estimating the fee, then letting the client
// re-estimate it at send time, leaves the transaction one base-fee tick short
// of being able to pay for itself.
const reserve = 2n * gasLimit * maxFeePerGas;

if (balance <= reserve) {
  console.log(`settlement account holds ${formatUnits(balance, 18)} USDC — below the gas reserve, nothing to send.`);
  process.exit(0);
}

const value = balance - reserve;
const hash = await wallet.sendTransaction({
  to: treasury, value, gas: gasLimit, maxFeePerGas, maxPriorityFeePerGas,
});
console.log(`refunding ${formatUnits(value, 18)} USDC to ${treasury}`);
console.log(`tx ${hash}`);
const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
console.log(`${r.status} in block ${r.blockNumber}`);
console.log(`treasury now ${formatUnits(await pub.getBalance({ address: treasury }), 18)} USDC`);
