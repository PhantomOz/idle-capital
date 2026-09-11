import { useState } from "react";
import type { BusinessView } from "./api.js";

/**
 * The first screen anyone sees, and the one that has to say what this is.
 *
 * The page it replaced opened with "Markets 104 / Protocols 21" — the machine
 * describing itself to someone who had not yet been told what the machine is
 * for.
 */
export function Onboard({ businesses, onCreate, onOpen, busy, error }: {
  businesses: BusinessView[];
  onCreate: (name: string) => void;
  onOpen: (id: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const [name, setName] = useState("");

  return (
    <div className="onboard">
      <div className="pitch">
        <h2>Money owed later should not sit still today.</h2>
        <p>
          A business selling across Lagos, Nairobi, Accra and Dar es Salaam collects
          in dollars and pays in naira, shillings and cedis. Payroll lands on the 25th,
          the supplier on the 18th, rent on the 1st — so the safe thing is to touch
          nothing, and the cash earns nothing.
        </p>
        <p>
          Idle Capital works out how much has to stay liquid against what you owe,
          and puts the rest to work. It checks its own answer against rules you set,
          and asks you before anything unusual.
        </p>
      </div>

      {businesses.length > 0 && (
        <div className="pick">
          <h3>Open a business</h3>
          <ul className="biz-list">
            {businesses.map((b) => (
              <li key={b.id}>
                <button className="biz" onClick={() => onOpen(b.id)}>
                  <span className="biz-name">{b.name}</span>
                  <span className="biz-addr">{b.address}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form
        className="pick"
        onSubmit={(e) => { e.preventDefault(); if (name.trim() !== "") onCreate(name.trim()); }}
      >
        <h3>Or add a new one</h3>
        <p className="hint">
          We create a wallet for it and hand you an address. Only that business can
          spend from it, and only within the limits you set.
        </p>
        <div className="row">
          <label className="sr-only" htmlFor="biz-name">Business name</label>
          <input
            id="biz-name" value={name} placeholder="Zamara Textiles"
            onChange={(e) => setName(e.target.value)} disabled={busy}
          />
          <button type="submit" disabled={busy || name.trim() === ""}>
            {busy ? "Creating the wallet…" : "Create business"}
          </button>
        </div>
      </form>

      {error !== null && <p className="error">{error}</p>}
    </div>
  );
}
