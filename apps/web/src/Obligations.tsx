import { useState } from "react";
import type { ObligationInput, ObligationView } from "./api.js";

const CURRENCIES = [
  { code: "NGN", label: "Nigeria · naira" },
  { code: "KES", label: "Kenya · shilling" },
  { code: "GHS", label: "Ghana · cedi" },
  { code: "TZS", label: "Tanzania · shilling" },
];

const CATEGORIES = ["payroll", "supplier", "rent", "tax"];

type Row = { id: string; currency: string; major: string; dueDate: string; category: string };

/** All four trade currencies use two minor digits. */
function toMinor(major: string): string {
  const cleaned = major.replace(/,/g, "").trim();
  const [whole = "0", frac = ""] = cleaned.split(".");
  return `${whole}${frac.padEnd(2, "0").slice(0, 2)}`.replace(/^0+(?=\d)/, "");
}

function toMajor(minor: string): string {
  const padded = minor.padStart(3, "0");
  return `${padded.slice(0, -2)}.${padded.slice(-2)}`;
}

function blank(): Row {
  return { id: `row_${Math.random().toString(36).slice(2, 8)}`, currency: "NGN", major: "", dueDate: "", category: "payroll" };
}

/**
 * The schedule, as something a finance person edits.
 *
 * Amounts are typed in the currency they are owed in — nobody knows their
 * payroll in minor units — and converted to minor units on the way out, as
 * integers. Nothing here ever becomes a float.
 */
export function Obligations({ initial, onSave, busy }: {
  initial: ObligationView[];
  onSave: (obligations: ObligationInput[]) => void;
  busy: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(
    initial.length === 0
      ? [blank()]
      : initial.map((o) => ({
          id: o.id, currency: o.currency, major: toMajor(o.amountMinor),
          dueDate: o.dueDate, category: o.category,
        })),
  );

  function update(id: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  const complete = rows.filter((r) => r.major.trim() !== "" && r.dueDate !== "");

  return (
    <form
      className="obligations-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(complete.map((r) => ({
          id: r.id, currency: r.currency, amountMinor: toMinor(r.major),
          dueDate: r.dueDate, category: r.category,
        })));
      }}
    >
      <table className="ledger editable">
        <thead>
          <tr>
            <th scope="col">What for</th>
            <th scope="col">Where</th>
            <th scope="col">Amount</th>
            <th scope="col">Due</th>
            <th scope="col"><span className="sr-only">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <select value={r.category} onChange={(e) => update(r.id, { category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </td>
              <td>
                <select value={r.currency} onChange={(e) => update(r.id, { currency: e.target.value })}>
                  {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </td>
              <td>
                <input
                  inputMode="decimal" placeholder="480,000.00" value={r.major}
                  onChange={(e) => update(r.id, { major: e.target.value })}
                  aria-label="Amount owed"
                />
              </td>
              <td>
                <input
                  type="date" value={r.dueDate}
                  onChange={(e) => update(r.id, { dueDate: e.target.value })}
                  aria-label="Due date"
                />
              </td>
              <td>
                <button
                  type="button" className="link"
                  onClick={() => setRows((rs) => (rs.length === 1 ? [blank()] : rs.filter((x) => x.id !== r.id)))}
                >remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="row">
        <button type="button" className="secondary" onClick={() => setRows((rs) => [...rs, blank()])}>
          Add another
        </button>
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : `Save ${complete.length} obligation${complete.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </form>
  );
}
