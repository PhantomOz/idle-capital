import { createPublicClient, http, type Address, type Hex } from "viem";

/**
 * Arc testnet.
 *
 * USDC is the NATIVE gas token here — a settlement transfer is a value
 * transfer, not an ERC-20 call, and the predeploy at 0x3600... mirrors the
 * same balance. Verified against the live chain; see the Privy/Arc spike.
 */
export const ARC_TESTNET = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [] as string[] } },
} as const;

/** Arc's native unit is 18 decimals; the treasury counts USDC in 6. */
const SCALE = 1_000_000_000_000n; // 10 ** 12

export function usdcMinorToWei(minor: bigint): bigint {
  return minor * SCALE;
}

/** Rounds DOWN. A balance we report must never be larger than the one we hold. */
export function weiToUsdcMinor(wei: bigint): bigint {
  return wei / SCALE;
}

export type ArcTransaction = {
  to: string; value: Hex; chain_id: number; nonce: number;
  gas_limit: Hex; max_fee_per_gas: Hex; max_priority_fee_per_gas: Hex;
};

export type ArcClient = {
  getBalanceUsdcMinor(address: Address): Promise<bigint>;
  buildTransfer(args: { from: Address; to: Address; amountUsdcMinor: bigint }): Promise<ArcTransaction>;
  broadcast(signed: Hex): Promise<Hex>;
  waitForReceipt(hash: Hex): Promise<{ status: "success" | "reverted"; blockNumber: bigint }>;
};

export function createArcClient(rpcUrl: string): ArcClient {
  const chain = { ...ARC_TESTNET, rpcUrls: { default: { http: [rpcUrl] } } };
  const pub = createPublicClient({ chain, transport: http(rpcUrl) });

  return {
    async getBalanceUsdcMinor(address) {
      return weiToUsdcMinor(await pub.getBalance({ address }));
    },

    async buildTransfer({ from, to, amountUsdcMinor }) {
      const [nonce, fees] = await Promise.all([
        pub.getTransactionCount({ address: from }),
        pub.estimateFeesPerGas(),
      ]);
      return {
        to,
        value: `0x${usdcMinorToWei(amountUsdcMinor).toString(16)}` as Hex,
        chain_id: ARC_TESTNET.id,
        nonce,
        gas_limit: "0x5208" as Hex, // 21000, a plain value transfer
        max_fee_per_gas: `0x${(fees.maxFeePerGas ?? 1_000_000_000n).toString(16)}` as Hex,
        max_priority_fee_per_gas:
          `0x${(fees.maxPriorityFeePerGas ?? 1_000_000_000n).toString(16)}` as Hex,
      };
    },

    async broadcast(signed) {
      return pub.request({ method: "eth_sendRawTransaction", params: [signed] }) as Promise<Hex>;
    },

    async waitForReceipt(hash) {
      const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
      return { status: r.status, blockNumber: r.blockNumber };
    },
  };
}
