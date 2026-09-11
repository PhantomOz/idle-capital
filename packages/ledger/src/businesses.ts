import type { Currency, Obligation, ObligationCategory, Position } from "@idle/core";
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

/**
 * What this business has committed to venues, according to its own books.
 *
 * Derived from confirmed intents: deposits add, withdrawals subtract. This is
 * the treasury's internal accounting, and on this deployment it is the only
 * record of parked capital there is — the settlement leg moves USDC out of the
 * wallet on Arc, so a balance read alone would show the money as simply gone
 * and the business as poorer after every successful run.
 *
 * It is deliberately NOT a claim that the funds are earning. What it records is
 * that they left the liquid balance under an approved decision. The venue-side
 * deposit is a separate step this testnet deployment does not take, and the UI
 * says so rather than implying a yield that is not being collected.
 */
export function settledPositions(l: Ledger, businessId: string): Position[] {
  const rows = l.raw.prepare(
    `SELECT i.kind AS kind, i.market_id AS market_id, i.amount_usdc AS amount_usdc
       FROM intents i
       JOIN runs r ON r.id = i.run_id
      WHERE r.business_id = ? AND i.status = 'confirmed' AND i.market_id IS NOT NULL`,
  ).all(businessId) as { kind: string; market_id: string; amount_usdc: string }[];

  const byMarket = new Map<string, bigint>();
  for (const r of rows) {
    const signed = r.kind === "earn_withdraw" ? -BigInt(r.amount_usdc) : BigInt(r.amount_usdc);
    byMarket.set(r.market_id, (byMarket.get(r.market_id) ?? 0n) + signed);
  }

  return [...byMarket.entries()]
    // A venue withdrawn back to zero is not a position, and a negative one is
    // a bug we would rather not propagate into the kernel's conservation check.
    .filter(([, amount]) => amount > 0n)
    .map(([marketId, amountUsdc]) => ({ marketId, amountUsdc }))
    .sort((a, b) => a.marketId.localeCompare(b.marketId));
}
