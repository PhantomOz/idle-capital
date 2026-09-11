export type Allocation = { marketId: string; amountUsdc: string };
export type Breach = { invariant: string; message: string; observed: string; limit: string };
export type Verdict = { kind: "approved" | "vetoed" | "escalated"; breaches?: Breach[] };

export type RunView = {
  id: string;
  businessId: string | null;
  status: string;
  proposal: { hold: string; allocations: Allocation[]; rationale: string } | null;
  verdict: Verdict | null;
  error: string | null;
  createdAt: string;
};

export type BusinessView = {
  id: string;
  name: string;
  address: string;
  walletId: string;
  policyId: string;
  createdAt: string;
};

export type ObligationView = {
  id: string;
  currency: "NGN" | "KES" | "GHS" | "TZS";
  amountMinor: string;
  usdcMinor: string;
  dueDate: string;
  category: string;
  confidence: number;
  withinHorizon: boolean;
};

export type ScheduleView = {
  obligations: ObligationView[];
  totalUsdc: string;
  minimumHoldUsdc: string;
  deployableUsdc: string;
  horizonDays: number;
  multiplierBps: number;
  fx: { asOf: string; source: string };
};

export type BusinessDetail = {
  business: BusinessView;
  treasury: { totalUsdc: string; positions: { marketId: string; amountUsdc: string }[] } | null;
  treasuryError: string | null;
  schedule: ScheduleView;
  runs: RunView[];
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

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    ...(init?.body === undefined ? {} : { headers: { "content-type": "application/json" } }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type ObligationInput = {
  id?: string;
  currency: string;
  amountMinor: string;
  dueDate: string;
  category: string;
  confidence?: number;
};

export const api = {
  policy: () => send<PolicyView>("/policy"),
  markets: () => send<{ markets: MarketView[]; count: number }>("/markets"),

  businesses: () => send<{ businesses: BusinessView[] }>("/businesses"),
  business: (id: string) => send<BusinessDetail>(`/businesses/${id}`),
  createBusiness: (name: string) =>
    send<{ business: BusinessView }>("/businesses", {
      method: "POST", body: JSON.stringify({ name }),
    }),
  fund: (id: string, amountUsdc: string) =>
    send<{ txRef: string }>(`/businesses/${id}/fund`, {
      method: "POST", body: JSON.stringify({ amountUsdc }),
    }),
  setObligations: (id: string, obligations: ObligationInput[]) =>
    send<{ obligations: ObligationView[] }>(`/businesses/${id}/obligations`, {
      method: "PUT", body: JSON.stringify({ obligations }),
    }),

  startRun: (id: string) =>
    send<{ run: RunView }>(`/businesses/${id}/runs`, { method: "POST" }),
  approve: (runId: string) =>
    send<{ run: RunView }>(`/runs/${runId}/approve`, { method: "POST" }),
  reject: (runId: string) =>
    send<{ run: RunView }>(`/runs/${runId}/reject`, { method: "POST" }),
};
