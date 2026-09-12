import { useCallback, useEffect, useState } from "react";
import { api, type BusinessDetail, type BusinessView, type MarketView, type PolicyView } from "./api.js";
import { Decision } from "./Decision.js";
import { Fund } from "./Fund.js";
import { MarketTable } from "./MarketTable.js";
import { Obligations } from "./Obligations.js";
import { Onboard } from "./Onboard.js";
import { Schedule } from "./Schedule.js";
import { formatUsdcShort } from "./format.js";

const REMEMBERED = "idle-capital.business";

export function App() {
  const [businesses, setBusinesses] = useState<BusinessView[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BusinessDetail | null>(null);
  const [markets, setMarkets] = useState<MarketView[]>([]);
  const [policy, setPolicy] = useState<PolicyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBERED);
      if (saved !== null) setOpenId(saved);
    } catch { /* a browser that blocks storage just starts at the list */ }
  }, []);

  const loadList = useCallback(async () => {
    try {
      setBusinesses((await api.businesses()).businesses);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the treasury service.");
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      setDetail(await api.business(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load that business.");
      setDetail(null);
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { if (openId !== null) void loadDetail(openId); }, [openId, loadDetail]);

  // Market data is the agent's comparison set, not the headline. Loaded once
  // and shown below the decision it explains.
  useEffect(() => {
    void (async () => {
      try {
        const [m, p] = await Promise.all([api.markets(), api.policy()]);
        setMarkets(m.markets);
        setPolicy(p);
      } catch { /* the page is still useful without the comparison table */ }
    })();
  }, []);

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await loadList();
      if (openId !== null) await loadDetail(openId);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }, [loadList, loadDetail, openId]);

  const open = useCallback((id: string) => {
    setOpenId(id);
    setEditing(false);
    try { localStorage.setItem(REMEMBERED, id); } catch { /* fine */ }
  }, []);

  const leave = useCallback(() => {
    setOpenId(null);
    setDetail(null);
    try { localStorage.removeItem(REMEMBERED); } catch { /* fine */ }
  }, []);

  if (openId === null || detail === null) {
    return (
      <main className="sheet">
        <header className="masthead">
          <h1>Idle Capital</h1>
          <p className="tagline">Treasury decisions for businesses paid in dollars, owing in local currency.</p>
        </header>
        <Onboard
          businesses={businesses} busy={busy} error={error}
          onOpen={open}
          onCreate={(name) => void act(async () => {
            const { business } = await api.createBusiness(name);
            open(business.id);
          })}
        />
      </main>
    );
  }

  const { business, treasury, treasuryError, schedule, runs } = detail;
  const parked = (treasury?.positions ?? [])
    .reduce((sum, p) => sum + BigInt(p.amountUsdc), 0n);
  const liquid = treasury === null ? 0n : BigInt(treasury.totalUsdc) - parked;
  const funded = treasury !== null && BigInt(treasury.totalUsdc) > 0n;
  const latest = runs.at(-1) ?? null;
  const earlier = runs.slice(0, -1).reverse();
  const hasSchedule = schedule.obligations.length > 0;

  return (
    <main className="sheet">
      <header className="masthead">
        <div className="who">
          <h1>{business.name}</h1>
          <button className="link" onClick={leave}>switch business</button>
        </div>
        <dl className="readout">
          <div>
            <dt>Treasury</dt>
            <dd>{treasury === null ? "unreadable" : formatUsdcShort(treasury.totalUsdc)}</dd>
          </div>
          <div>
            <dt>Liquid</dt>
            <dd>{treasury === null ? "—" : formatUsdcShort(liquid.toString())}</dd>
          </div>
          <div>
            <dt>Committed</dt>
            <dd>{treasury === null ? "—" : formatUsdcShort(parked.toString())}</dd>
          </div>
          <div>
            <dt>Wallet</dt>
            <dd className="addr-short">{business.address.slice(0, 6)}…{business.address.slice(-4)}</dd>
          </div>
        </dl>
      </header>

      {error !== null && <p className="error">{error}</p>}
      {treasuryError !== null && (
        <p className="error">Could not read this treasury: {treasuryError}</p>
      )}

      {!funded && treasury !== null && (
        <section>
          <div className="section-head"><h2>Fund it</h2></div>
          <Fund business={business} />
        </section>
      )}

      <section>
        <div className="section-head">
          <h2>What {business.name} owes</h2>
          <button className="link" onClick={() => setEditing((v) => !v)}>
            {editing ? "done" : hasSchedule ? "edit" : "add what you owe"}
          </button>
        </div>
        {editing
          ? <Obligations
              initial={schedule.obligations} busy={busy}
              onSave={(obligations) => void act(async () => {
                await api.setObligations(business.id, obligations);
                setEditing(false);
              })}
            />
          : <Schedule
              schedule={schedule}
              treasuryUsdc={treasury?.totalUsdc ?? null}
              today={new Date()}
            />}
      </section>

      <section>
        <div className="section-head">
          <h2>What the agent decided</h2>
          <button
            onClick={() => void act(() => api.startRun(business.id))}
            disabled={busy || !hasSchedule || !funded}
          >
            {busy ? "Working…" : latest === null ? "Ask the agent" : "Run it again"}
          </button>
        </div>
        {!hasSchedule && (
          <p className="empty">Add what this business owes first — that is what the decision turns on.</p>
        )}
        {hasSchedule && !funded && (
          <p className="empty">Fund the wallet above, then the agent has something to decide about.</p>
        )}
        {latest === null
          ? hasSchedule && funded && (
              <p className="empty">
                Nothing run yet. The agent will compare today&rsquo;s live lending rates against
                what you owe, and tell you what it would do.
              </p>
            )
          : <Decision
              run={latest} busy={busy}
              onApprove={(id) => void act(() => api.approve(id))}
              onReject={(id) => void act(() => api.reject(id))}
            />}
      </section>

      {markets.length > 0 && policy !== null && (
        <section>
          <div className="section-head">
            <h2>Where it could go</h2>
            <p>Live rates across {new Set(markets.map((m) => m.protocol)).size} lending protocols</p>
          </div>
          <MarketTable markets={markets} policy={policy} />
        </section>
      )}

      {earlier.length > 0 && (
        <section>
          <div className="section-head"><h2>Earlier decisions</h2></div>
          {earlier.map((r) => (
            <Decision key={r.id} run={r} busy={busy} onApprove={() => {}} onReject={() => {}} />
          ))}
        </section>
      )}
    </main>
  );
}
