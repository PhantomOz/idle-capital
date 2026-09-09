export type LendingDeployment = {
  /** Messari protocol identifier; matches `Market.protocol`. */
  protocol: string;
  network: string;
  /** Subgraph id on The Graph's decentralized network. */
  subgraphId: string;
};

/**
 * Messari standardized `lending` deployments, one per protocol.
 *
 * Committed rather than fetched at runtime: these are static facts, and
 * putting them in git makes the set reviewable and the build reproducible
 * without a second network dependency. Sourced from the Messari deployment
 * registry (messari/subgraphs `deployment/deployment.json`) and verified
 * live — see specs/spikes/2026-09-09-graph-schema-spike.md.
 *
 * rari-fuse is in this list ON PURPOSE. It was exploited and abandoned in
 * 2022, its subgraph still answers, and it still reports the highest yield in
 * the set (174% APY on negative liquidity). It is the live proof that the
 * kernel's allowlist and liquidity floor are load-bearing. See D-010.
 */
export const LENDING_DEPLOYMENTS: readonly LendingDeployment[] = [
  { protocol: "aave-v3", network: "ethereum", subgraphId: "JCNWRypm7FYwV8fx5HhzZPSFaMxgkPuw4TnR3Gpi81zk" },
  { protocol: "compound-v3", network: "ethereum", subgraphId: "AwoxEZbiWLvv6e3QdvdMZw4WDURdGbvPfHmZRc8Dpfz9" },
  { protocol: "spark-lend", network: "ethereum", subgraphId: "GbKdmBe4ycCYCQLQSjqGg6UHYoYfbyJyq5WrG35pv1si" },
  { protocol: "aave-v2", network: "ethereum", subgraphId: "C2zniPn45RnLDGzVeGZCx2Sw3GXrbc9gL4ZfL8B8Em2j" },
  { protocol: "compound-v2", network: "ethereum", subgraphId: "4TbqVA8p2DoBd5qDbPMwmDZv3CsJjWtxo8nVSqF2tA9a" },
  { protocol: "morpho-aave-v3", network: "ethereum", subgraphId: "FKe6ANnWmGPE6hajGLoTgPrVF2jYPHiRu2Jwcg9ZmG9A" },
  { protocol: "radiant-v2", network: "arbitrum", subgraphId: "2rQAKGJkvkiAXsCjx1n4E3DSgk2b7nCZMtt2BrV5TBgt" },
  { protocol: "moonwell", network: "base", subgraphId: "33ex1ExmYQtwGVwri1AP3oMFPGSce6YbocBP7fWbsBrg" },
  { protocol: "venus", network: "bsc", subgraphId: "CwswJ7sfENafqgAYU1upn3hQgoEV2CXXRZRJ7XtgJrKG" },
  { protocol: "benqi", network: "avalanche", subgraphId: "8ZjJGsaKea7WwLJPJNdHXPGsvXDe3iq2231aRjgBPisi" },
  { protocol: "iron-bank", network: "ethereum", subgraphId: "5YoxED3bbWV9byvn3x3S3ebZ3idrQmQmsJhL5LMyY26v" },
  { protocol: "euler-finance", network: "ethereum", subgraphId: "95nyAWFFaiz6gykko3HtBCyhRuP5vZzuKYsZiLxHxLhr" },
  { protocol: "sonne-finance", network: "optimism", subgraphId: "DQqb7FiQ1joLhESkAwvAYiuXhwfz4zf6qHmbt7stnec8" },
  { protocol: "dforce", network: "ethereum", subgraphId: "6PaB6tKFqrL6YoAELEhFGU6Gc39cEynLbo6ETZMF3sCy" },
  { protocol: "makerdao", network: "ethereum", subgraphId: "8sE6rTNkPhzZXZC6c8UQy2ghFTu5PPdGauwUBm4t7HZ1" },
  { protocol: "rari-fuse", network: "ethereum", subgraphId: "kecp6SPMvbB4GTqg9r5PXvztYriexj5F3ZCaATpjmb2" },
  { protocol: "uwu-lend", network: "ethereum", subgraphId: "CZBD7e8VGvNa6WkBHZAaC688bsZ35UvAM1AuDdVng2aE" },
  { protocol: "banker-joe", network: "avalanche", subgraphId: "9NjYuG2BFU1BPacNdKymd9eNdfVCaJM6LhsgD8zSQgDK" },
  { protocol: "maple-finance-v2", network: "ethereum", subgraphId: "94swSaaFChsQoZzb9Vc7Lo6FWFV6YZUMNSdFVTMAeRgj" },
  { protocol: "truefi", network: "ethereum", subgraphId: "39F8fYCvLYmutjqpzEwx3dcEJTtFFVupvBzJqkEzftA7" },
  { protocol: "liquity", network: "ethereum", subgraphId: "2D2dFCLjUt3MfFgTKW8cBxiRQ3Adss7KUtYh2rTcFVY" },
  { protocol: "goldfinch", network: "ethereum", subgraphId: "GRwpFCPYyQPdz84sCnKemzrNvgFPuKkFLcRLR6jsRxHr" },
  { protocol: "aave-arc", network: "ethereum", subgraphId: "5hyqnEzjZbwFBU1rk4JBknCeiF2Mj93qBzsyQfpAa3QA" },
  { protocol: "aave-rwa", network: "ethereum", subgraphId: "C8ynQrjVKcmqxb9fWrLvSCBFNf2ChFkxCg7Q8gknJrza" },
  { protocol: "radiant", network: "arbitrum", subgraphId: "5HTkKJNSm72tUGakwj8yroDGHxc6fBhmLaA5oJepZGL3" },
] as const;
