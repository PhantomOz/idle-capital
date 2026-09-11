import type { Currency, Obligation, ObligationCategory } from "@idle/core";
import type { Ledger } from "./db.js";

export type Business = {
  id: string;
  name: string;
  walletId: string;
  address: string;
  policyId: string;
  createdAt: string;
};

type BusinessRow = {
  id: string; name: string; wallet_id: string; address: string;
  policy_id: string; created_at: string;
};

type ObligationRow = {
  id: string; currency: string; amount_minor: string;
  due_date: string; category: string; confidence: number;
};

function hydrate(r: BusinessRow): Business {
  return {
    id: r.id, name: r.name, walletId: r.wallet_id,
    address: r.address, policyId: r.policy_id, createdAt: r.created_at,
  };
}

/**
 * Record a business and the wallet provisioned for it.
 *
 * Written only after provisioning succeeds. A row here is a promise that an
 * address exists and is guarded, and writing it first — then failing to
 * provision — would leave the product showing a funding address nobody owns.
 */
export function createBusiness(
  l: Ledger,
  b: { id: string; name: string; walletId: string; address: string; policyId: string },
): Business {
  const now = new Date().toISOString();
  l.raw.prepare(
    "INSERT INTO businesses (id,name,wallet_id,address,policy_id,created_at) VALUES (?,?,?,?,?,?)",
  ).run(b.id, b.name, b.walletId, b.address, b.policyId, now);
  return getBusiness(l, b.id)!;
}

export function getBusiness(l: Ledger, id: string): Business | null {
  const row = l.raw.prepare("SELECT * FROM businesses WHERE id=?").get(id) as BusinessRow | undefined;
  return row === undefined ? null : hydrate(row);
}

export function listBusinesses(l: Ledger): Business[] {
  return (l.raw.prepare("SELECT * FROM businesses ORDER BY created_at").all() as BusinessRow[]).map(hydrate);
}

/**
 * Replace a business's schedule wholesale.
 *
 * Obligations are edited as a set, not row by row: a treasury's forward
 * schedule is a single statement of what is owed, and applying it atomically
 * means no run can ever read a half-updated one and under-reserve against it.
 */
export function setObligations(l: Ledger, businessId: string, obligations: Obligation[]): Obligation[] {
  if (getBusiness(l, businessId) === null) throw new Error(`Business ${businessId} not found`);
  const now = new Date().toISOString();
  const del = l.raw.prepare("DELETE FROM obligations WHERE business_id=?");
  const ins = l.raw.prepare(
    "INSERT INTO obligations (id,business_id,currency,amount_minor,due_date,category,confidence,created_at) " +
    "VALUES (?,?,?,?,?,?,?,?)",
  );
  l.raw.transaction(() => {
    del.run(businessId);
    for (const o of obligations) {
      ins.run(o.id, businessId, o.currency, o.amountMinor.toString(), o.dueDate, o.category, o.confidence, now);
    }
  })();
  return listObligations(l, businessId);
}

export function listObligations(l: Ledger, businessId: string): Obligation[] {
  const rows = l.raw.prepare(
    "SELECT * FROM obligations WHERE business_id=? ORDER BY due_date, id",
  ).all(businessId) as ObligationRow[];
  return rows.map((r) => ({
    id: r.id,
    currency: r.currency as Currency,
    amountMinor: BigInt(r.amount_minor),
    dueDate: r.due_date,
    category: r.category as ObligationCategory,
    confidence: r.confidence,
  }));
}
