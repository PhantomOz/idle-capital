import { useCallback, useEffect, useState } from "react";
import { api, type MarketView, type PolicyView, type RunView } from "./api.js";
import { MarketTable } from "./MarketTable.js";
import { RunBlotter } from "./RunBlotter.js";

export function App() {
  const [markets, setMarkets] = useState<MarketView[]>([]);
  const [policy, setPolicy] = useState<PolicyView | null>(null);
  const [runs, setRuns] = useState<RunView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, m, r] = await Promise.all([api.policy(), api.markets(), api.runs()]);
      setPolicy(p); setMarkets(m.markets); setRuns(r.runs); setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the treasury API.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "That did not work."); }
    finally { setBusy(false); }
  }, [load]);

  const protocols = new Set(markets.map((m) => m.protocol)).size;
  const latest = runs.at(-1) ?? null;
  const history = runs.slice(0, -1).reverse();

  return (
    <main className="sheet">
      <header className="masthead">
        <h1>Idle Capital</h1>
        <dl className="readout">
          <div><dt>Markets</dt><dd>{markets.length}</dd></div>
          <div><dt>Protocols</dt><dd>{protocols}</dd></div>
          <div><dt>Runs</dt><dd>{runs.length}</dd></div>
        </dl>
      </header>

      {error !== null && <p className="error">{error}</p>}

      <section>
        <div className="section-head">
          <h2>Latest run</h2>
          <button onClick={() => void act(api.startRun)} disabled={busy}>Run the agent now</button>
        </div>
        {latest === null
          ? <p className="empty">No runs yet. Run the agent to see what it proposes against today&rsquo;s rates.</p>
          : <RunBlotter
              run={latest} busy={busy}
              onApprove={(id) => void act(() => api.approve(id))}
              onReject={(id) => void act(() => api.reject(id))} />}
      </section>

      <section>
        <div className="section-head">
          <h2>Markets</h2>
          {policy !== null && <p>Funds may only enter {policy.protocolAllowlist.join(", ")}</p>}
        </div>
        {policy !== null && <MarketTable markets={markets} policy={policy} />}
      </section>

      {history.length > 0 && (
        <section>
          <div className="section-head"><h2>Earlier runs</h2></div>
          {history.map((r) => (
            <RunBlotter key={r.id} run={r} busy={busy} onApprove={() => {}} onReject={() => {}} />
          ))}
        </section>
      )}
    </main>
  );
}
