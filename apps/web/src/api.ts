export type Allocation = { marketId: string; amountUsdc: string };
export type Breach = { invariant: string; message: string; observed: string; limit: string };
export type Verdict = { kind: "approved" | "vetoed" | "escalated"; breaches?: Breach[] };

export type RunView = {
  id: string;
  status: string;
  proposal: { hold: string; allocations: Allocation[]; rationale: string } | null;
  verdict: Verdict | null;
  error: string | null;
  createdAt: string;
};

export type MarketView = {
  id: string;
  protocol: string;
  chain: string;
  asset: { symbol: string; decimals: number; address: string };
  supplyApy: number;
  totalSuppliedUsd: number;
  totalBorrowedUsd: number;
  liquidityUsd: number;
};

export type PolicyView = {
  protocolAllowlist: string[];
  minVenueLiquidityUsd: number;
  maxVenueConcentrationBps: number;
  bufferHorizonDays: number;
};

const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  policy: () => get<PolicyView>("/policy"),
  markets: () => get<{ markets: MarketView[]; count: number }>("/markets"),
  runs: () => get<{ runs: RunView[] }>("/runs"),
  startRun: () => post<{ run: RunView }>("/runs"),
  approve: (id: string) => post<{ run: RunView }>(`/runs/${id}/approve`),
  reject: (id: string) => post<{ run: RunView }>(`/runs/${id}/reject`),
};
