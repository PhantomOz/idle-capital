import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { usdcMinorToWei } from "@idle/chain";
import type { Address, Hex } from "viem";

/**
 * Sends testnet USDC to a newly provisioned business wallet.
 *
 * A demo affordance, and disclosed as one. Onboarding hands back an address
 * with nothing in it, and a reviewer creating a business has no way to fill it
 * — so the product would dead-end at exactly the moment it became interesting.
 * In production this is the customer wiring their own funds.
 *
 * It is the faucet EOA that signs here, never a business wallet. Tenant wallets
 * have no key anywhere in this system; that is the point of them (D-014).
 */
export function createFaucet(opts: {
  rpcUrl: string;
  chainId: number;
  privateKey: string;
  /** Refuses to send more than this in one call. */
  maxPerCallUsdcMinor: bigint;
}) {
  const chain = {
    id: opts.chainId,
    name: "Arc Testnet",
    nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [opts.rpcUrl] } },
  } as const;

  const account = privateKeyToAccount(
    (opts.privateKey.startsWith("0x") ? opts.privateKey : `0x${opts.privateKey}`) as Hex,
  );
  const pub = createPublicClient({ chain, transport: http(opts.rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(opts.rpcUrl) });

  return {
    address: account.address,

    async send(to: Address, amountUsdcMinor: bigint): Promise<string> {
      if (amountUsdcMinor > opts.maxPerCallUsdcMinor) {
        throw new Error(
          `The faucet sends at most ${opts.maxPerCallUsdcMinor} USDC minor units at a time`,
        );
      }
      const value = usdcMinorToWei(amountUsdcMinor);
      const balance = await pub.getBalance({ address: account.address });
      const fees = await pub.estimateFeesPerGas();
      const maxFeePerGas = fees.maxFeePerGas ?? 1_000_000_000n;
      const gas = 21_000n;

      // Check before sending rather than letting the node reject it: "the
      // faucet is empty" is something a reviewer can act on, and a viem
      // exceeds-balance stack trace is not.
      if (balance < value + gas * maxFeePerGas) {
        throw new Error("The testnet faucet is out of USDC — fund it and try again");
      }

      const hash = await wallet.sendTransaction({
        to, value, gas, maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? maxFeePerGas,
      });
      await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
      return hash;
    },
  };
}
