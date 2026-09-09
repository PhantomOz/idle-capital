import type { Market } from "@idle/core";

export type RawRate = { rate: string; side: string; type: string };

export type RawMarket = {
  id: string;
  name: string;
  inputToken: { id: string; symbol: string; decimals: number } | null;
  totalDepositBalanceUSD: string;
  totalBorrowBalanceUSD: string;
  rates: RawRate[];
};

/** Parse a schema decimal string. Returns null rather than NaN. */
function num(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize one raw market into the shape the rest of the system uses.
 *
 * This is the single place the Messari schema's quirks are corrected, and
 * every one of them was found by probing the live endpoint rather than
 * reading the docs (spike F1):
 *
 *   - `rate` is a PERCENT ("3.0674..." = 3.07%), not the fraction the rest of
 *     the system expects. Divided by 100 here, exactly once.
 *   - `rates` holds several entries per market, including a BORROWER/STABLE
 *     rate of 0. Taking "the first LENDER rate" is not safe; we filter on
 *     side AND type.
 *   - Every numeric field is a decimal string.
 *
 * Returns null for anything unusable. A market we cannot trust is dropped,
 * never guessed at — a wrong APY silently steers the agent.
 */
export function normalizeMarket(raw: unknown, protocol: string, network: string): Market | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  if (typeof r.id !== "string" || r.id.length === 0) return null;

  const token = r.inputToken;
  if (typeof token !== "object" || token === null) return null;
  const t = token as Record<string, unknown>;
  if (typeof t.symbol !== "string" || typeof t.id !== "string") return null;
  const decimals = typeof t.decimals === "number" ? t.decimals : num(t.decimals);
  if (decimals === null) return null;

  const supplied = num(r.totalDepositBalanceUSD);
  const borrowed = num(r.totalBorrowBalanceUSD);
  if (supplied === null || borrowed === null) return null;

  if (!Array.isArray(r.rates)) return null;
  const lender = r.rates.find(
    (x): x is RawRate =>
      typeof x === "object" && x !== null &&
      (x as RawRate).side === "LENDER" && (x as RawRate).type === "VARIABLE",
  );
  if (lender === undefined) return null;
  const percent = num(lender.rate);
  if (percent === null) return null;

  return {
    // Namespaced: market ids are only unique within a subgraph, and K3/K4
    // match on this id across the whole merged set.
    id: `${protocol}:${r.id}`,
    protocol,
    chain: network,
    asset: { symbol: t.symbol, decimals, address: t.id },
    supplyApy: percent / 100,
    totalSuppliedUsd: supplied,
    totalBorrowedUsd: borrowed,
    // Not clamped. A stale subgraph reporting negative liquidity is exactly
    // what K7 exists to catch, and clamping would hide it.
    liquidityUsd: supplied - borrowed,
  };
}
