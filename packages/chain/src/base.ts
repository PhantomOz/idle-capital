import { createPublicClient, http, type Address } from "viem";

/**
 * Base mainnet.
 *
 * The treasury reads its liquid balance here, and Privy's Earn vault
 * ("Steakhouse Prime USDC", a Morpho vault) settles here. Real money, real
 * yield — see D-024 for why execution moved off Arc testnet.
 */
export const BASE_MAINNET = {
  id: 8453,
  name: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [] as string[] } },
} as const;

/** Circle's canonical USDC on Base. Six decimals. */
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

/**
 * USDC on Base is a six-decimal ERC-20, and six decimals is exactly the minor
 * unit the whole ledger counts in. So there is NO scaling on this path.
 *
 * That is the one thing worth stating loudly, because Arc is the opposite: its
 * USDC is the *native* token at eighteen decimals, so `packages/chain/arc.ts`
 * multiplies by 10^12 on the way in and divides on the way out. Copying that
 * scaling to Base would inflate every balance by a trillion; omitting it on Arc
 * would shrink every balance to dust. Same asset, same name, different units.
 */
const USDC_DECIMALS = 6;

const ERC20_BALANCE_OF = [{
  name: "balanceOf",
  type: "function",
  stateMutability: "view",
  inputs: [{ name: "account", type: "address" }],
  outputs: [{ name: "", type: "uint256" }],
}] as const;

export type BaseUsdcClient = {
  /** Liquid USDC held by this address, in minor units (6dp). */
  getBalanceUsdcMinor(address: Address): Promise<bigint>;
  /** Native ETH, in wei. Only needed when gas is not sponsored. */
  getGasBalanceWei(address: Address): Promise<bigint>;
  readonly usdcAddress: Address;
  readonly decimals: number;
};

export function createBaseUsdcClient(
  rpcUrl: string,
  usdcAddress: Address = BASE_USDC,
): BaseUsdcClient {
  const chain = { ...BASE_MAINNET, rpcUrls: { default: { http: [rpcUrl] } } };
  const pub = createPublicClient({ chain, transport: http(rpcUrl) });

  return {
    usdcAddress,
    decimals: USDC_DECIMALS,

    async getBalanceUsdcMinor(address) {
      return pub.readContract({
        address: usdcAddress,
        abi: ERC20_BALANCE_OF,
        functionName: "balanceOf",
        args: [address],
      });
    },

    async getGasBalanceWei(address) {
      return pub.getBalance({ address });
    },
  };
}
