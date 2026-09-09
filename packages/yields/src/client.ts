import type { Market } from "@idle/core";
import { LENDING_DEPLOYMENTS, type LendingDeployment } from "./registry.js";
import { LENDING_MARKETS_QUERY } from "./query.js";
import { normalizeMarket } from "./normalize.js";

const GATEWAY = "https://gateway.thegraph.com/api/subgraphs/id";

export type DeploymentFailure = { protocol: string; reason: string };

/** Thrown when too few protocols answered for the comparison to be credible. */
export class QuorumNotMetError extends Error {
  constructor(
    readonly needed: number,
    readonly got: number,
    readonly failures: DeploymentFailure[],
  ) {
    super(
      `Graph quorum not met: needed ${needed} protocols, got ${got}. ` +
      `Failures: ${failures.map((f) => `${f.protocol} (${f.reason})`).join("; ")}`,
    );
    this.name = "QuorumNotMetError";
  }
}

export type YieldsOptions = {
  apiKey: string;
  /** Defaults to the committed registry. */
  deployments?: readonly LendingDeployment[];
  /** Minimum protocols that must answer, else the run fails. See D-009. */
  minProtocolQuorum?: number;
  /** Restrict to these asset symbols, case-insensitive. */
  assetSymbols?: string[];
  timeoutMs?: number;
  /** Injected for tests. Production passes nothing and uses global fetch. */
  fetchImpl?: typeof fetch;
};

export type FetchResult = {
  markets: Market[];
  protocolsQueried: number;
  protocolsSucceeded: number;
  failures: DeploymentFailure[];
  fetchedAt: Date;
};

type Outcome =
  | { d: LendingDeployment; error: string }
  | { d: LendingDeployment; raw: unknown[] };

/**
 * Fetch lending markets across every deployment in the registry, using one
 * standardized query document.
 *
 * Fails CLOSED on quorum, never on an individual deployment. 11 of 46
 * deployments were unreachable when we probed — ordinary indexer churn on a
 * decentralized network, no fault of ours. Failing the whole run on one flaky
 * subgraph would brick the product most days (D-009).
 *
 * There is no cache and no fixture path here. Both Graph tracks disqualify
 * mocked data, and silently serving stale numbers would be worse than an
 * honest failure (D-007).
 */
export async function getLendingMarkets(opts: YieldsOptions): Promise<FetchResult> {
  const {
    apiKey,
    deployments = LENDING_DEPLOYMENTS,
    minProtocolQuorum = 5,
    assetSymbols,
    timeoutMs = 45_000,
    fetchImpl = fetch,
  } = opts;

  if (!apiKey) throw new Error("getLendingMarkets: a Graph API key is required");

  const wanted = assetSymbols?.map((s) => s.toUpperCase());
  const failures: DeploymentFailure[] = [];
  const markets: Market[] = [];
  let succeeded = 0;

  const results: Outcome[] = await Promise.all(deployments.map(async (d): Promise<Outcome> => {
    try {
      const res = await fetchImpl(`${GATEWAY}/${d.subgraphId}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Header, not URL — a key in a URL ends up in logs and referrers.
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ query: LENDING_MARKETS_QUERY }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return { d, error: `HTTP ${res.status}` };
      const body = await res.json() as {
        data?: { markets?: unknown[] };
        errors?: { message: string }[];
      };
      if (body.errors && body.errors.length > 0) {
        return { d, error: body.errors[0]?.message ?? "graphql error" };
      }
      return { d, raw: body.data?.markets ?? [] };
    } catch (e) {
      return { d, error: e instanceof Error ? e.message : String(e) };
    }
  }));

  for (const r of results) {
    if ("error" in r) {
      failures.push({ protocol: r.d.protocol, reason: r.error.slice(0, 120) });
      continue;
    }
    succeeded += 1;
    for (const raw of r.raw) {
      const m = normalizeMarket(raw, r.d.protocol, r.d.network);
      if (m === null) continue;
      if (wanted && !wanted.includes(m.asset.symbol.toUpperCase())) continue;
      markets.push(m);
    }
  }

  if (succeeded < minProtocolQuorum) {
    throw new QuorumNotMetError(minProtocolQuorum, succeeded, failures);
  }

  markets.sort((a, b) => b.supplyApy - a.supplyApy);
  return {
    markets,
    protocolsQueried: deployments.length,
    protocolsSucceeded: succeeded,
    failures,
    fetchedAt: new Date(),
  };
}
