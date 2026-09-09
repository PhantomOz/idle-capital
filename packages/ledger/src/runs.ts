import type { Proposal, Verdict } from "@idle/core";
import type { Ledger } from "./db.js";
import type { Run, RunStatus } from "./types.js";

/**
 * The state machine, spelled out. Spec §6.
 *
 * Terminal states have no outgoing transitions — a settled run cannot be
 * re-executed, and a rejected one cannot be quietly resurrected. Every
 * non-terminal state can fail, because anything can fail.
 */
export const LEGAL_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  PROPOSED: ["VALIDATED", "AWAITING_APPROVAL", "FAILED"],
  VALIDATED: ["EXECUTING", "FAILED"],
  AWAITING_APPROVAL: ["EXECUTING", "REJECTED", "FAILED"],
  EXECUTING: ["SETTLED", "FAILED"],
  SETTLED: [],
  REJECTED: [],
  FAILED: [],
};

export class IllegalTransitionError extends Error {
  constructor(readonly runId: string, readonly from: RunStatus, readonly to: RunStatus) {
    super(`Run ${runId}: illegal transition ${from} -> ${to}. ` +
          `Legal from ${from}: ${LEGAL_TRANSITIONS[from].join(", ") || "(terminal)"}`);
    this.name = "IllegalTransitionError";
  }
}

/** bigint does not survive JSON. Serialize as a tagged string. */
function toJson(v: unknown): string {
  return JSON.stringify(v, (_k, val: unknown) =>
    typeof val === "bigint" ? { __bigint: val.toString() } : val);
}

function fromJson<T>(s: string | null): T | null {
  if (s === null) return null;
  return JSON.parse(s, (_k, val: unknown) =>
    typeof val === "object" && val !== null && typeof (val as { __bigint?: string }).__bigint === "string"
      ? BigInt((val as { __bigint: string }).__bigint)
      : val) as T;
}

type RunRow = {
  id: string; status: string; proposal: string | null; verdict: string | null;
  created_at: string; updated_at: string;
};

function hydrate(row: RunRow): Run {
  return {
    id: row.id,
    status: row.status as RunStatus,
    proposal: fromJson<Proposal>(row.proposal),
    verdict: fromJson<Verdict>(row.verdict),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createRun(l: Ledger, id: string, proposal: Proposal): Run {
  const now = new Date().toISOString();
  l.raw.prepare(
    "INSERT INTO runs (id,status,proposal,verdict,created_at,updated_at) VALUES (?,?,?,?,?,?)",
  ).run(id, "PROPOSED", toJson(proposal), null, now, now);
  return getRun(l, id)!;
}

export function getRun(l: Ledger, id: string): Run | null {
  const row = l.raw.prepare("SELECT * FROM runs WHERE id=?").get(id) as RunRow | undefined;
  return row === undefined ? null : hydrate(row);
}

export function listRuns(l: Ledger, status?: RunStatus): Run[] {
  const rows = (status === undefined
    ? l.raw.prepare("SELECT * FROM runs ORDER BY created_at").all()
    : l.raw.prepare("SELECT * FROM runs WHERE status=? ORDER BY created_at").all(status)) as RunRow[];
  return rows.map(hydrate);
}

/**
 * Move a run to a new state, refusing anything the machine does not allow.
 *
 * Throwing rather than returning an error is deliberate: an illegal
 * transition is a bug in the caller, not a runtime condition to branch on,
 * and a state machine that silently permits SETTLED -> EXECUTING is not a
 * state machine.
 */
export function transitionRun(
  l: Ledger, id: string, to: RunStatus, patch: { verdict?: Verdict } = {},
): Run {
  const current = getRun(l, id);
  if (current === null) throw new Error(`Run ${id} not found`);
  if (!LEGAL_TRANSITIONS[current.status].includes(to)) {
    throw new IllegalTransitionError(id, current.status, to);
  }
  const now = new Date().toISOString();
  if (patch.verdict !== undefined) {
    l.raw.prepare("UPDATE runs SET status=?, verdict=?, updated_at=? WHERE id=?")
      .run(to, toJson(patch.verdict), now, id);
  } else {
    l.raw.prepare("UPDATE runs SET status=?, updated_at=? WHERE id=?").run(to, now, id);
  }
  return getRun(l, id)!;
}
