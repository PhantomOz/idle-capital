export type Allocation = {
  marketId: string;
  amountUsdc: bigint;
};

/** Untrusted output of the LLM agent. */
export type Proposal = {
  /** USDC to keep liquid. */
  hold: bigint;
  /** USDC to park, per market. */
  allocations: Allocation[];
  /** The agent's written reasoning, surfaced to humans. */
  rationale: string;
};

export type InvariantId = "K1" | "K2" | "K3" | "K4" | "K5" | "K6" | "K7" | "K8";

export type Breach = {
  invariant: InvariantId;
  /** Human-readable, shown in the approval queue. */
  message: string;
  /** The value that broke the invariant. */
  observed: string;
  /** The bound it broke. */
  limit: string;
};

export type Verdict =
  | { kind: "approved" }
  /** Structurally invalid — do not execute, do not ask a human to rubber-stamp. */
  | { kind: "vetoed"; breaches: Breach[] }
  /** Coherent but outside the autonomous envelope — a human decides. */
  | { kind: "escalated"; breaches: Breach[] };
