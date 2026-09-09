import { formatApy, formatUsdCompact } from "./format.js";
import type { MarketView, PolicyView } from "./api.js";

/**
 * Why a market cannot receive funds, in the operator's language rather than
 * the kernel's. Returns null when it can.
 */
export function refusal(m: MarketView, policy: PolicyView): string | null {
  if (!policy.protocolAllowlist.includes(m.protocol)) return "not on the allowlist";
  if (m.liquidityUsd < policy.minVenueLiquidityUsd) return "below the liquidity floor";
  return null;
}

/**
 * The headline refusal: the single best rate on offer anywhere, and why the
 * treasury cannot take it.
 *
 * Shown once rather than as ninety struck-through rows. The argument that
 * chasing yield blindly is dangerous is made by the top of the list; repeating
 * it down the page buries every market the treasury can actually use.
 */
function TopRefusal({ market, reason }: { market: MarketView; reason: string }) {
  return (
    <div className="refusal">
      <p className="refusal-rate">{formatApy(market.supplyApy)}</p>
      <p className="refusal-body">
        The best rate on offer today is {market.protocol} {market.asset.symbol}, holding{" "}
        {formatUsdCompact(market.liquidityUsd)} of withdrawable liquidity. It is {reason},
        so the agent cannot put anything there.
      </p>
    </div>
  );
}

export function MarketTable({ markets, policy }: {
  markets: MarketView[];
  policy: PolicyView;
}) {
  if (markets.length === 0) {
    return (
      <p className="empty">
        No market data yet. Start the API with a Graph key to see live lending rates.
      </p>
    );
  }

  const sorted = [...markets].sort((a, b) => b.supplyApy - a.supplyApy);
  const refused = sorted.filter((m) => refusal(m, policy) !== null);
  const allowed = sorted.filter((m) => refusal(m, policy) === null);
  const top = refused[0];

  return (
    <>
      {top !== undefined && <TopRefusal market={top} reason={refusal(top, policy)!} />}

      {allowed.length === 0
        ? <p className="empty">
            None of today&rsquo;s {markets.length} markets clear the policy. The agent will hold
            everything liquid until one does.
          </p>
        : <table>
            <thead>
              <tr>
                <th scope="col">Protocol</th>
                <th scope="col">Asset</th>
                <th scope="col" style={{ textAlign: "right" }}>Supply rate</th>
                <th scope="col" style={{ textAlign: "right" }}>Liquidity</th>
              </tr>
            </thead>
            <tbody>
              {allowed.map((m) => (
                <tr key={m.id}>
                  <td>{m.protocol}</td>
                  <td>{m.asset.symbol}</td>
                  <td className="num">{formatApy(m.supplyApy)}</td>
                  <td className="num">{formatUsdCompact(m.liquidityUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>}

      {refused.length > 0 && (
        <p className="footnote">
          {refused.length} of {markets.length} markets refused — off the allowlist, or below the
          liquidity floor of {formatUsdCompact(policy.minVenueLiquidityUsd)}.
        </p>
      )}
    </>
  );
}
