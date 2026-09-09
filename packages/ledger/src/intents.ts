import type { Ledger } from "./db.js";
import type { Intent, IntentKind, IntentStatus } from "./types.js";

export type IntentSpec = {
  kind: IntentKind;
  amountUsdc: bigint;
  marketId?: string | null;
};

/**
 * The idempotency key: stable for a given run and sequence position.
 *
 * Deliberately does NOT include the amount. If it did, a retry that computed
 * a slightly different amount would mint a NEW key and submit a second
 * transfer — which is precisely the double-spend this exists to prevent.
 * Instead the key stays stable and `materialiseIntents` refuses a content
 * mismatch loudly.
 */
export function intentKey(runId: string, seq: number): string {
  return `${runId}:${seq}`;
}

export class IntentConflictError extends Error {
  constructor(key: string, existing: string, incoming: string) {
    super(`Intent ${key} already exists with different content. ` +
          `Stored: ${existing}. Incoming: ${incoming}. ` +
          `Refusing to reissue — this is a bug in intent generation, not a retry.`);
    this.name = "IntentConflictError";
  }
}

type IntentRow = {
  id: string; run_id: string; seq: number; kind: string; amount_usdc: string;
  market_id: string | null; idempotency_key: string; status: string;
  tx_ref: string | null; error: string | null;
};

function hydrate(r: IntentRow): Intent {
  return {
    id: r.id, runId: r.run_id, seq: r.seq,
    kind: r.kind as IntentKind,
    amountUsdc: BigInt(r.amount_usdc),
    marketId: r.market_id,
    idempotencyKey: r.idempotency_key,
    status: r.status as IntentStatus,
    txRef: r.tx_ref, error: r.error,
  };
}

function fingerprint(s: IntentSpec): string {
  return `${s.kind}/${s.amountUsdc}/${s.marketId ?? ""}`;
}

/**
 * Create the intents for a run, or return the ones already there.
 *
 * Idempotent by construction: an intent that already exists is returned
 * untouched, never reset. That is what makes crash-and-resume safe — a run
 * that died between "submitted" and "confirmed" comes back with its
 * submitted intent intact rather than a fresh pending one that would be
 * submitted a second time.
 */
export function materialiseIntents(l: Ledger, runId: string, specs: IntentSpec[]): Intent[] {
  const now = new Date().toISOString();
  const insert = l.raw.prepare(
    "INSERT INTO intents (id,run_id,seq,kind,amount_usdc,market_id,idempotency_key,status,created_at,updated_at)" +
    " VALUES (?,?,?,?,?,?,?,?,?,?)");
  const byKey = l.raw.prepare("SELECT * FROM intents WHERE idempotency_key=?");

  const tx = l.raw.transaction((items: IntentSpec[]): Intent[] => {
    const out: Intent[] = [];
    for (const [seq, spec] of items.entries()) {
      const key = intentKey(runId, seq);
      const existing = byKey.get(key) as IntentRow | undefined;
      if (existing !== undefined) {
        const stored = fingerprint({
          kind: existing.kind as IntentKind,
          amountUsdc: BigInt(existing.amount_usdc),
          marketId: existing.market_id,
        });
        const incoming = fingerprint(spec);
        if (stored !== incoming) throw new IntentConflictError(key, stored, incoming);
        out.push(hydrate(existing));
        continue;
      }
      insert.run(
        `${key}#${spec.kind}`, runId, seq, spec.kind, spec.amountUsdc.toString(),
        spec.marketId ?? null, key, "pending", now, now,
      );
      out.push(hydrate(byKey.get(key) as IntentRow));
    }
    return out;
  });
  return tx(specs);
}

export function listIntents(l: Ledger, runId: string): Intent[] {
  return (l.raw.prepare("SELECT * FROM intents WHERE run_id=? ORDER BY seq").all(runId) as IntentRow[])
    .map(hydrate);
}

function setStatus(
  l: Ledger, id: string, status: IntentStatus,
  patch: { txRef?: string; error?: string } = {},
): Intent {
  const now = new Date().toISOString();
  l.raw.prepare(
    "UPDATE intents SET status=?, tx_ref=COALESCE(?, tx_ref), error=COALESCE(?, error), updated_at=? WHERE id=?",
  ).run(status, patch.txRef ?? null, patch.error ?? null, now, id);
  const row = l.raw.prepare("SELECT * FROM intents WHERE id=?").get(id) as IntentRow | undefined;
  if (row === undefined) throw new Error(`Intent ${id} not found`);
  return hydrate(row);
}

export function markSubmitted(l: Ledger, id: string, txRef: string): Intent {
  return setStatus(l, id, "submitted", { txRef });
}

export function markConfirmed(l: Ledger, id: string): Intent {
  return setStatus(l, id, "confirmed");
}

/**
 * COALESCE keeps any txRef already recorded — a failed transfer that was
 * broadcast still has a hash worth keeping for reconciliation.
 */
export function markFailed(l: Ledger, id: string, error: string): Intent {
  return setStatus(l, id, "failed", { error });
}

/** Intents broadcast but not yet resolved. The recovery sweep's input. */
export function findInFlight(l: Ledger): Intent[] {
  return (l.raw.prepare("SELECT * FROM intents WHERE status='submitted' ORDER BY run_id, seq").all() as IntentRow[])
    .map(hydrate);
}
