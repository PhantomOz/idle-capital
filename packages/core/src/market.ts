export type MarketAsset = {
  symbol: string;
  decimals: number;
  address: string;
};

/** A lending market, normalized from the Messari standardized schema. */
export type Market = {
  id: string;
  protocol: string;
  chain: string;
  asset: MarketAsset;
  /** Supply APY as a fraction, e.g. 0.0431 for 4.31%. */
  supplyApy: number;
  totalSuppliedUsd: number;
  totalBorrowedUsd: number;
  /** supplied - borrowed. What could actually be withdrawn. */
  liquidityUsd: number;
};
