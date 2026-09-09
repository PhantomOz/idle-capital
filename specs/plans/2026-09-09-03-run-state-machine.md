# Run State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@idle/ledger` — the durable run/intent state machine that makes it impossible for money to end up in limbo. Legal-transition enforcement, per-intent idempotency, atomic writes, and startup reconciliation of anything left in flight.

**Architecture:** SQLite via better-sqlite3, synchronous and transactional. A run owns an ordered list of intents; each intent is one money-moving action with a stable idempotency key. Execution goes through an injected `ExecutionPort`, so the whole machine is buildable and testable before Privy or Arc credentials exist — the real adapters plug in behind the same interface on Friday.

**Tech Stack:** better-sqlite3 13, TypeScript 5 strict, Vitest.

**Spec:** `specs/2026-09-09-idle-capital-design.md` §6, §7, §8
**Decision:** D-003 — this is built *before* the happy path, on purpose.

## Global Constraints

- Inherits every Plan 1 constraint (bigint money, strict TS, commit per task, update `ATTRIBUTION.md`).
- **Money is stored as TEXT and read back as `bigint`.** SQLite INTEGER is a 64-bit signed value that better-sqlite3 hands back as a JS `number`, which silently loses precision above 2^53. TEXT round-trips exactly.
- **Every status change is a transaction.** A run's status and its intents' statuses must never disagree, even on a crash mid-write.
- **An intent is never re-issued under a fresh idempotency key.** That is the one rule that makes double-spending impossible; everything else here exists to protect it.
- **Illegal transitions throw.** A state machine that silently permits `SETTLED → EXECUTING` is not a state machine.
- **Tests use `:memory:`.** Fast, isolated, no fixture files.

---

### Task 1: Schema and store

**Files:**
- Create: `packages/ledger/package.json`, `packages/ledger/tsconfig.json`
- Create: `packages/ledger/src/types.ts`, `packages/ledger/src/db.ts`, `packages/ledger/src/index.ts`
- Test: `packages/ledger/test/db.test.ts`

**Interfaces:**
- Consumes: `@idle/core` types `Proposal`, `Verdict`
- Produces: `type RunStatus`, `type IntentStatus`, `type IntentKind`, `type Run`, `type Intent`, `openLedger(path?: string): Ledger`, `type Ledger` (wraps the connection with `close()` and `raw`)

- [ ] **Step 1: Create the package shell**

`packages/ledger/package.json`:
```json
{
  "name": "@idle/ledger",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@idle/core": "workspace:*",
    "better-sqlite3": "^13.0.3"
  }
}
```

`packages/ledger/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

- [ ] **Step 2: Write the failing test**

`packages/ledger/test/db.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { openLedger } from "../src/index.js";

describe("openLedger", () => {
  it("creates the runs and intents tables", () => {
    const l = openLedger(":memory:");
    const tables = l.raw.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("runs");
    expect(names).toContain("intents");
    l.close();
  });

  it("enforces the idempotency key as unique", () => {
    const l = openLedger(":memory:");
    l.raw.prepare("INSERT INTO runs (id,status,created_at,updated_at) VALUES (?,?,?,?)")
      .run("r1", "PROPOSED", "t", "t");
    const ins = l.raw.prepare(
      "INSERT INTO intents (id,run_id,seq,kind,amount_usdc,market_id,idempotency_key,status,created_at,updated_at)" +
      " VALUES (?,?,?,?,?,?,?,?,?,?)");
    ins.run("i1", "r1", 0, "earn_deposit", "1000", null, "r1:0", "pending", "t", "t");
    expect(() =>
      ins.run("i2", "r1", 0, "earn_deposit", "1000", null, "r1:0", "pending", "t", "t"),
    ).toThrow(/UNIQUE/i);
    l.close();
  });

  it("stores money as TEXT so bigint round-trips exactly", () => {
    const l = openLedger(":memory:");
    l.raw.prepare("INSERT INTO runs (id,status,created_at,updated_at) VALUES (?,?,?,?)")
      .run("r1", "PROPOSED", "t", "t");
    // Above 2^53 — this is where a JS number would silently lose precision
    const huge = 9007199254740993n;
    l.raw.prepare(
      "INSERT INTO intents (id,run_id,seq,kind,amount_usdc,market_id,idempotency_key,status,created_at,updated_at)" +
      " VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run("i1", "r1", 0, "earn_deposit", huge.toString(), null, "r1:0", "pending", "t", "t");
    const row = l.raw.prepare("SELECT amount_usdc FROM intents WHERE id=?").get("i1") as { amount_usdc: string };
    expect(BigInt(row.amount_usdc)).toBe(huge);
    l.close();
  });

  it("rejects an intent pointing at a run that does not exist", () => {
    const l = openLedger(":memory:");
    expect(() =>
      l.raw.prepare(
        "INSERT INTO intents (id,run_id,seq,kind,amount_usdc,market_id,idempotency_key,status,created_at,updated_at)" +
        " VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run("i1", "nope", 0, "earn_deposit", "1", null, "k", "pending", "t", "t"),
    ).toThrow(/FOREIGN KEY/i);
    l.close();
  });

  it("is idempotent to open twice on the same file", () => {
    const a = openLedger(":memory:");
    expect(() => a.migrate()).not.toThrow();
    a.close();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run packages/ledger`
Expected: FAIL — cannot resolve `../src/index.js`

- [ ] **Step 4: Write `packages/ledger/src/types.ts`**

```ts
import type { Proposal, Verdict } from "@idle/core";

/** See spec §6. Terminal states have no outgoing transitions. */
export type RunStatus =
  | "PROPOSED"
  | "VALIDATED"
  | "AWAITING_APPROVAL"
  | "EXECUTING"
  | "SETTLED"
  | "REJECTED"
  | "FAILED";

export type IntentStatus = "pending" | "submitted" | "confirmed" | "failed";

export type IntentKind = "earn_deposit" | "earn_withdraw" | "settle_usdc";

export type Run = {
  id: string;
  status: RunStatus;
  proposal: Proposal | null;
  verdict: Verdict | null;
  createdAt: string;
  updatedAt: string;
};

export type Intent = {
  id: string;
  runId: string;
  /** Order within the run. Part of the idempotency key. */
  seq: number;
  kind: IntentKind;
  amountUsdc: bigint;
  marketId: string | null;
  /** Stable across retries. The reason double-spending is impossible. */
  idempotencyKey: string;
  status: IntentStatus;
  txRef: string | null;
  error: string | null;
};
```

- [ ] **Step 5: Write `packages/ledger/src/db.ts`**

```ts
import Database from "better-sqlite3";

export type Ledger = {
  /** Escape hatch for tests and bespoke queries. */
  raw: Database.Database;
  migrate(): void;
  close(): void;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id          TEXT PRIMARY KEY,
  status      TEXT NOT NULL,
  proposal    TEXT,
  verdict     TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intents (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES runs(id),
  seq             INTEGER NOT NULL,
  kind            TEXT NOT NULL,
  -- TEXT, not INTEGER: better-sqlite3 hands INTEGER back as a JS number,
  -- which silently loses precision above 2^53. TEXT round-trips exactly.
  amount_usdc     TEXT NOT NULL,
  market_id       TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL,
  tx_ref          TEXT,
  error           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_intents_run  ON intents(run_id, seq);
CREATE INDEX IF NOT EXISTS idx_intents_stat ON intents(status);
CREATE INDEX IF NOT EXISTS idx_runs_status  ON runs(status);
`;

/**
 * Open (and migrate) the durable ledger.
 *
 * `:memory:` in tests; a file path in production. Foreign keys are enabled
 * explicitly because SQLite leaves them off by default — without that, an
 * intent could reference a run that does not exist and the "money in limbo"
 * guarantee would rest on application code remembering to check.
 */
export function openLedger(path = ".idle/ledger.db"): Ledger {
  const raw = new Database(path);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");

  const ledger: Ledger = {
    raw,
    migrate() { raw.exec(SCHEMA); },
    close() { raw.close(); },
  };
  ledger.migrate();
  return ledger;
}
```

`packages/ledger/src/index.ts`:
```ts
export * from "./types.js";
export * from "./db.js";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm install && pnpm vitest run packages/ledger`
Expected: PASS — 5 tests

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add the durable ledger schema

Money is TEXT, not INTEGER: better-sqlite3 hands INTEGER back as a JS number,
which silently loses precision above 2^53. The test proves the round-trip at
9007199254740993.

Foreign keys are enabled explicitly — SQLite leaves them off by default, and
without them an intent could reference a run that does not exist.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Run transitions

**Files:**
- Create: `packages/ledger/src/runs.ts`
- Modify: `packages/ledger/src/index.ts`
- Test: `packages/ledger/test/runs.test.ts`

**Interfaces:**
- Consumes: `./db.js` type `Ledger`, `./types.js`
- Produces: `LEGAL_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>>`, `class IllegalTransitionError extends Error`, `createRun(l: Ledger, id: string, proposal: Proposal): Run`, `getRun(l: Ledger, id: string): Run | null`, `transitionRun(l: Ledger, id: string, to: RunStatus, patch?: { verdict?: Verdict }): Run`, `listRuns(l: Ledger, status?: RunStatus): Run[]`

- [ ] **Step 1: Write the failing test**

`packages/ledger/test/runs.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { Proposal, Verdict } from "@idle/core";
import {
  IllegalTransitionError, LEGAL_TRANSITIONS, createRun, getRun, listRuns,
  openLedger, transitionRun, type Ledger,
} from "../src/index.js";

const PROPOSAL: Proposal = {
  hold: 40_000_000n,
  allocations: [{ marketId: "aave-v3:0xabc", amountUsdc: 60_000_000n }],
  rationale: "TZS payroll in six days; park the surplus.",
};

let l: Ledger;
beforeEach(() => { l = openLedger(":memory:"); });

describe("createRun", () => {
  it("starts a run in PROPOSED", () => {
    const r = createRun(l, "r1", PROPOSAL);
    expect(r.status).toBe("PROPOSED");
    expect(r.id).toBe("r1");
  });

  it("round-trips the proposal including its bigints", () => {
    createRun(l, "r1", PROPOSAL);
    const r = getRun(l, "r1");
    expect(r?.proposal?.hold).toBe(40_000_000n);
    expect(r?.proposal?.allocations[0]?.amountUsdc).toBe(60_000_000n);
  });

  it("returns null for a run that does not exist", () => {
    expect(getRun(l, "nope")).toBeNull();
  });
});

describe("transitionRun", () => {
  it("allows PROPOSED -> VALIDATED", () => {
    createRun(l, "r1", PROPOSAL);
    expect(transitionRun(l, "r1", "VALIDATED").status).toBe("VALIDATED");
  });

  it("allows the escalation path PROPOSED -> AWAITING_APPROVAL -> EXECUTING", () => {
    createRun(l, "r1", PROPOSAL);
    transitionRun(l, "r1", "AWAITING_APPROVAL");
    expect(transitionRun(l, "r1", "EXECUTING").status).toBe("EXECUTING");
  });

  it("allows a human to reject from AWAITING_APPROVAL", () => {
    createRun(l, "r1", PROPOSAL);
    transitionRun(l, "r1", "AWAITING_APPROVAL");
    expect(transitionRun(l, "r1", "REJECTED").status).toBe("REJECTED");
  });

  it("refuses to skip validation: PROPOSED -> EXECUTING", () => {
    createRun(l, "r1", PROPOSAL);
    expect(() => transitionRun(l, "r1", "EXECUTING")).toThrow(IllegalTransitionError);
  });

  it("refuses to move out of a terminal state", () => {
    createRun(l, "r1", PROPOSAL);
    transitionRun(l, "r1", "VALIDATED");
    transitionRun(l, "r1", "EXECUTING");
    transitionRun(l, "r1", "SETTLED");
    expect(() => transitionRun(l, "r1", "EXECUTING")).toThrow(IllegalTransitionError);
  });

  it("names both states in the error, so a log line is diagnosable", () => {
    createRun(l, "r1", PROPOSAL);
    expect(() => transitionRun(l, "r1", "SETTLED")).toThrow(/PROPOSED.*SETTLED|SETTLED.*PROPOSED/);
  });

  it("throws for a run that does not exist", () => {
    expect(() => transitionRun(l, "ghost", "VALIDATED")).toThrow(/not found/i);
  });

  it("stores the kernel verdict alongside the transition", () => {
    createRun(l, "r1", PROPOSAL);
    const verdict: Verdict = {
      kind: "escalated",
      breaches: [{ invariant: "K5", message: "too concentrated", observed: "70%", limit: "50%" }],
    };
    transitionRun(l, "r1", "AWAITING_APPROVAL", { verdict });
    expect(getRun(l, "r1")?.verdict).toEqual(verdict);
  });

  it("advances updated_at", async () => {
    createRun(l, "r1", PROPOSAL);
    const before = getRun(l, "r1")!.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    transitionRun(l, "r1", "VALIDATED");
    expect(getRun(l, "r1")!.updatedAt >= before).toBe(true);
  });
});

describe("LEGAL_TRANSITIONS", () => {
  it("makes every terminal state actually terminal", () => {
    for (const t of ["SETTLED", "REJECTED", "FAILED"] as const) {
      expect(LEGAL_TRANSITIONS[t]).toHaveLength(0);
    }
  });

  it("lets any non-terminal state fail", () => {
    for (const s of ["PROPOSED", "VALIDATED", "AWAITING_APPROVAL", "EXECUTING"] as const) {
      expect(LEGAL_TRANSITIONS[s]).toContain("FAILED");
    }
  });
});

describe("listRuns", () => {
  it("filters by status", () => {
    createRun(l, "r1", PROPOSAL);
    createRun(l, "r2", PROPOSAL);
    transitionRun(l, "r2", "AWAITING_APPROVAL");
    expect(listRuns(l, "AWAITING_APPROVAL").map((r) => r.id)).toEqual(["r2"]);
    expect(listRuns(l)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/ledger/test/runs.test.ts`
Expected: FAIL — `createRun` is not exported

- [ ] **Step 3: Write `packages/ledger/src/runs.ts`**

```ts
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
  return JSON.stringify(v, (_k, val) =>
    typeof val === "bigint" ? { __bigint: val.toString() } : val);
}

function fromJson<T>(s: string | null): T | null {
  if (s === null) return null;
  return JSON.parse(s, (_k, val) =>
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
```

Append to `packages/ledger/src/index.ts`:
```ts
export * from "./runs.js";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/ledger`
Expected: PASS — 20 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add run transitions with the state machine spelled out

Terminal states have no outgoing transitions: a settled run cannot be
re-executed and a rejected one cannot be quietly resurrected.

Illegal transitions throw rather than returning an error, because an illegal
transition is a bug in the caller, not a runtime condition to branch on.

bigint does not survive JSON, so proposals and verdicts serialize through a
tagged form that round-trips exactly.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The intent ledger and its idempotency guarantee

**Files:**
- Create: `packages/ledger/src/intents.ts`
- Modify: `packages/ledger/src/index.ts`
- Test: `packages/ledger/test/intents.test.ts`

**Interfaces:**
- Consumes: `./db.js`, `./types.js`
- Produces: `intentKey(runId: string, seq: number): string`, `class IntentConflictError extends Error`, `materialiseIntents(l: Ledger, runId: string, specs: IntentSpec[]): Intent[]`, `type IntentSpec = { kind: IntentKind; amountUsdc: bigint; marketId?: string | null }`, `listIntents(l: Ledger, runId: string): Intent[]`, `markSubmitted(l: Ledger, id: string, txRef: string): Intent`, `markConfirmed(l: Ledger, id: string): Intent`, `markFailed(l: Ledger, id: string, error: string): Intent`, `findInFlight(l: Ledger): Intent[]`

- [ ] **Step 1: Write the failing test**

`packages/ledger/test/intents.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { Proposal } from "@idle/core";
import {
  IntentConflictError, createRun, findInFlight, intentKey, listIntents,
  markConfirmed, markFailed, markSubmitted, materialiseIntents, openLedger, type Ledger,
} from "../src/index.js";

const PROPOSAL: Proposal = { hold: 1n, allocations: [], rationale: "x" };
const SPECS = [
  { kind: "earn_withdraw" as const, amountUsdc: 10_000_000n, marketId: "aave-v3:0xa" },
  { kind: "settle_usdc" as const, amountUsdc: 4_000_000n },
];

let l: Ledger;
beforeEach(() => {
  l = openLedger(":memory:");
  createRun(l, "r1", PROPOSAL);
});

describe("intentKey", () => {
  it("is stable for the same run and sequence", () => {
    expect(intentKey("r1", 0)).toBe(intentKey("r1", 0));
  });

  it("differs across sequences and across runs", () => {
    expect(intentKey("r1", 0)).not.toBe(intentKey("r1", 1));
    expect(intentKey("r1", 0)).not.toBe(intentKey("r2", 0));
  });
});

describe("materialiseIntents", () => {
  it("creates one intent per spec, in order", () => {
    const out = materialiseIntents(l, "r1", SPECS);
    expect(out).toHaveLength(2);
    expect(out[0]?.seq).toBe(0);
    expect(out[1]?.seq).toBe(1);
    expect(out[0]?.kind).toBe("earn_withdraw");
  });

  it("starts every intent pending with no tx", () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    expect(i?.status).toBe("pending");
    expect(i?.txRef).toBeNull();
  });

  it("round-trips bigint amounts exactly", () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    expect(i?.amountUsdc).toBe(10_000_000n);
  });

  it("IS IDEMPOTENT — calling twice does not create a second set", () => {
    materialiseIntents(l, "r1", SPECS);
    const second = materialiseIntents(l, "r1", SPECS);
    expect(second).toHaveLength(2);
    expect(listIntents(l, "r1")).toHaveLength(2);
  });

  it("returns the EXISTING intents on the second call, not fresh ones", () => {
    const first = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, first[0]!.id, "0xtx");
    const second = materialiseIntents(l, "r1", SPECS);
    // The already-submitted intent must come back as-is, never reset to pending
    expect(second[0]?.id).toBe(first[0]?.id);
    expect(second[0]?.status).toBe("submitted");
    expect(second[0]?.txRef).toBe("0xtx");
  });

  it("refuses to reuse a key for different content", () => {
    materialiseIntents(l, "r1", SPECS);
    expect(() => materialiseIntents(l, "r1", [
      { kind: "earn_withdraw", amountUsdc: 999n, marketId: "aave-v3:0xa" },
    ])).toThrow(IntentConflictError);
  });

  it("names the mismatch so the bug is findable", () => {
    materialiseIntents(l, "r1", SPECS);
    expect(() => materialiseIntents(l, "r1", [
      { kind: "earn_withdraw", amountUsdc: 999n, marketId: "aave-v3:0xa" },
    ])).toThrow(/999|10000000/);
  });
});

describe("status transitions", () => {
  it("moves pending -> submitted -> confirmed", () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    expect(markSubmitted(l, i!.id, "0xtx").status).toBe("submitted");
    expect(markConfirmed(l, i!.id).status).toBe("confirmed");
  });

  it("records the failure reason", () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    const f = markFailed(l, i!.id, "reverted: insufficient allowance");
    expect(f.status).toBe("failed");
    expect(f.error).toContain("allowance");
  });

  it("keeps the txRef when an intent fails after submission", () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, i!.id, "0xtx");
    expect(markFailed(l, i!.id, "reverted").txRef).toBe("0xtx");
  });
});

describe("findInFlight", () => {
  it("finds submitted intents and nothing else", () => {
    const out = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, out[0]!.id, "0xtx");
    const flight = findInFlight(l);
    expect(flight).toHaveLength(1);
    expect(flight[0]?.id).toBe(out[0]?.id);
  });

  it("is empty once everything has settled", () => {
    const out = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, out[0]!.id, "0xtx");
    markConfirmed(l, out[0]!.id);
    expect(findInFlight(l)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/ledger/test/intents.test.ts`
Expected: FAIL — `intentKey` is not exported

- [ ] **Step 3: Write `packages/ledger/src/intents.ts`**

```ts
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

  const tx = l.raw.transaction((items: IntentSpec[]) => {
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

/** COALESCE keeps any txRef already recorded — a failed transfer that was
 *  broadcast still has a hash worth keeping for reconciliation. */
export function markFailed(l: Ledger, id: string, error: string): Intent {
  return setStatus(l, id, "failed", { error });
}

/** Intents broadcast but not yet resolved. The recovery sweep's input. */
export function findInFlight(l: Ledger): Intent[] {
  return (l.raw.prepare("SELECT * FROM intents WHERE status='submitted' ORDER BY run_id, seq").all() as IntentRow[])
    .map(hydrate);
}
```

Append to `packages/ledger/src/index.ts`:
```ts
export * from "./intents.js";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/ledger`
Expected: PASS — 34 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add the intent ledger and its idempotency guarantee

The key is stable for a run and sequence position and deliberately excludes
the amount. If it included the amount, a retry that recomputed a slightly
different figure would mint a NEW key and submit a second transfer — exactly
the double-spend this exists to prevent. Instead the key stays stable and a
content mismatch is refused loudly as the intent-generation bug it is.

An intent that already exists is returned untouched, never reset. That is
what makes crash-and-resume safe.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Recovery — reconciling what was left in flight

**Files:**
- Create: `packages/ledger/src/ports.ts`, `packages/ledger/src/recovery.ts`
- Modify: `packages/ledger/src/index.ts`
- Test: `packages/ledger/test/recovery.test.ts`

**Interfaces:**
- Consumes: `./intents.js`, `./runs.js`
- Produces: `interface ExecutionPort { submit(i: Intent): Promise<string>; checkStatus(txRef: string): Promise<TxStatus> }`, `type TxStatus = "confirmed" | "failed" | "pending"`, `reconcile(l: Ledger, port: ExecutionPort): Promise<ReconcileReport>`, `type ReconcileReport = { checked: number; confirmed: number; failed: number; stillPending: number }`

- [ ] **Step 1: Write the failing test**

`packages/ledger/test/recovery.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Proposal } from "@idle/core";
import {
  createRun, getRun, listIntents, markSubmitted, materialiseIntents,
  openLedger, reconcile, transitionRun, type ExecutionPort, type Ledger,
} from "../src/index.js";

const PROPOSAL: Proposal = { hold: 1n, allocations: [], rationale: "x" };
const SPECS = [{ kind: "settle_usdc" as const, amountUsdc: 1_000_000n }];

let l: Ledger;
beforeEach(() => {
  l = openLedger(":memory:");
  createRun(l, "r1", PROPOSAL);
  transitionRun(l, "r1", "VALIDATED");
  transitionRun(l, "r1", "EXECUTING");
});

function port(status: "confirmed" | "failed" | "pending"): ExecutionPort {
  return { submit: vi.fn(async () => "0xnew"), checkStatus: vi.fn(async () => status) };
}

describe("reconcile", () => {
  it("confirms an intent whose transaction landed while we were down", async () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, i!.id, "0xtx");
    const report = await reconcile(l, port("confirmed"));
    expect(report.confirmed).toBe(1);
    expect(listIntents(l, "r1")[0]?.status).toBe("confirmed");
  });

  it("fails an intent whose transaction reverted while we were down", async () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, i!.id, "0xtx");
    const report = await reconcile(l, port("failed"));
    expect(report.failed).toBe(1);
    expect(listIntents(l, "r1")[0]?.status).toBe("failed");
  });

  it("leaves a still-pending transaction alone rather than guessing", async () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, i!.id, "0xtx");
    const report = await reconcile(l, port("pending"));
    expect(report.stillPending).toBe(1);
    expect(listIntents(l, "r1")[0]?.status).toBe("submitted");
  });

  it("NEVER resubmits — that is the whole point", async () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, i!.id, "0xtx");
    const p = port("pending");
    await reconcile(l, p);
    expect(p.submit).not.toHaveBeenCalled();
  });

  it("settles the run once every intent is confirmed", async () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, i!.id, "0xtx");
    await reconcile(l, port("confirmed"));
    expect(getRun(l, "r1")?.status).toBe("SETTLED");
  });

  it("fails the run when an intent failed", async () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, i!.id, "0xtx");
    await reconcile(l, port("failed"));
    expect(getRun(l, "r1")?.status).toBe("FAILED");
  });

  it("leaves the run EXECUTING while anything is still pending", async () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, i!.id, "0xtx");
    await reconcile(l, port("pending"));
    expect(getRun(l, "r1")?.status).toBe("EXECUTING");
  });

  it("does nothing when there is nothing in flight", async () => {
    const p = port("confirmed");
    const report = await reconcile(l, p);
    expect(report.checked).toBe(0);
    expect(p.checkStatus).not.toHaveBeenCalled();
  });

  it("survives a port that throws, leaving the intent in flight", async () => {
    const [i] = materialiseIntents(l, "r1", SPECS);
    markSubmitted(l, i!.id, "0xtx");
    const bad: ExecutionPort = {
      submit: vi.fn(async () => "x"),
      checkStatus: vi.fn(async () => { throw new Error("rpc down"); }),
    };
    const report = await reconcile(l, bad);
    expect(report.stillPending).toBe(1);
    expect(listIntents(l, "r1")[0]?.status).toBe("submitted");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/ledger/test/recovery.test.ts`
Expected: FAIL — `reconcile` is not exported

- [ ] **Step 3: Write `packages/ledger/src/ports.ts`**

```ts
import type { Intent } from "./types.js";

export type TxStatus = "confirmed" | "failed" | "pending";

/**
 * The seam between the state machine and whatever actually moves money.
 *
 * Declared here so the ledger is complete and testable before Privy and Arc
 * credentials exist. The real adapters implement this interface on Friday and
 * nothing above them changes.
 */
export interface ExecutionPort {
  /** Broadcast the intent. Returns a transaction reference. */
  submit(intent: Intent): Promise<string>;
  /** Has this transaction landed? Must be safe to call repeatedly. */
  checkStatus(txRef: string): Promise<TxStatus>;
}
```

- [ ] **Step 4: Write `packages/ledger/src/recovery.ts`**

```ts
import type { Ledger } from "./db.js";
import { findInFlight, listIntents, markConfirmed, markFailed } from "./intents.js";
import type { ExecutionPort } from "./ports.js";
import { getRun, transitionRun } from "./runs.js";

export type ReconcileReport = {
  checked: number;
  confirmed: number;
  failed: number;
  stillPending: number;
};

/**
 * Reconcile every intent left in flight, then settle the runs they belong to.
 *
 * Run at startup, before any new work is issued. This is the answer to "money
 * in limbo" (D-003): a process that died between broadcasting a transfer and
 * recording its outcome comes back, asks the chain what actually happened,
 * and records it.
 *
 * It NEVER resubmits. Resubmission is how a crash becomes a double-spend —
 * the transaction may well have landed while we were down, which is exactly
 * the case this function exists to discover.
 *
 * A port that throws leaves the intent in flight. Not knowing is a strictly
 * better state than guessing wrong in either direction.
 */
export async function reconcile(l: Ledger, port: ExecutionPort): Promise<ReconcileReport> {
  const inFlight = findInFlight(l);
  const report: ReconcileReport = {
    checked: inFlight.length, confirmed: 0, failed: 0, stillPending: 0,
  };
  const touchedRuns = new Set<string>();

  for (const intent of inFlight) {
    touchedRuns.add(intent.runId);
    if (intent.txRef === null) { report.stillPending += 1; continue; }
    let status;
    try {
      status = await port.checkStatus(intent.txRef);
    } catch {
      report.stillPending += 1;
      continue;
    }
    if (status === "confirmed") { markConfirmed(l, intent.id); report.confirmed += 1; }
    else if (status === "failed") { markFailed(l, intent.id, "reconciled: transaction failed"); report.failed += 1; }
    else { report.stillPending += 1; }
  }

  for (const runId of touchedRuns) {
    const run = getRun(l, runId);
    if (run === null || run.status !== "EXECUTING") continue;
    const intents = listIntents(l, runId);
    if (intents.some((i) => i.status === "failed")) {
      transitionRun(l, runId, "FAILED");
    } else if (intents.every((i) => i.status === "confirmed")) {
      transitionRun(l, runId, "SETTLED");
    }
    // Otherwise something is still in flight — leave it EXECUTING and try again
    // on the next sweep.
  }

  return report;
}
```

Append to `packages/ledger/src/index.ts`:
```ts
export * from "./ports.js";
export * from "./recovery.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run packages/ledger && pnpm typecheck`
Expected: PASS — 43 tests, typecheck clean

- [ ] **Step 6: Update ATTRIBUTION.md and commit**

Append to the per-file table:
```markdown
| `packages/ledger/**` | `AI` | Schema, state machine, intent ledger and recovery; the never-resubmit rule is a team decision (D-003) |
```

```bash
git add -A
git commit -m "Add crash recovery that reconciles rather than resubmits

Run at startup before any new work. A process that died between broadcasting
a transfer and recording its outcome comes back, asks the chain what actually
happened, and records it.

It never resubmits. Resubmission is how a crash becomes a double-spend — the
transaction may well have landed while we were down, which is exactly the
case this function exists to discover.

A port that throws leaves the intent in flight. Not knowing is a strictly
better state than guessing wrong in either direction.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The crash-and-resume proof

**Files:**
- Test: `packages/ledger/test/crash.test.ts`

**Interfaces:**
- Consumes: everything above
- Produces: no new exports — this is the test that proves the guarantee end to end

**Why a separate task:** the individual units are tested. This proves the *property* — that killing the process mid-flight and restarting cannot move money twice. It is also the demo's strongest 40 seconds, so it needs to be a thing that can be pointed at.

- [ ] **Step 1: Write the test**

`packages/ledger/test/crash.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import type { Proposal } from "@idle/core";
import {
  createRun, getRun, listIntents, markSubmitted, materialiseIntents,
  openLedger, reconcile, transitionRun, type ExecutionPort, type Intent,
} from "../src/index.js";

const PROPOSAL: Proposal = {
  hold: 40_000_000n,
  allocations: [{ marketId: "aave-v3:0xa", amountUsdc: 60_000_000n }],
  rationale: "park the surplus",
};
const SPECS = [
  { kind: "earn_deposit" as const, amountUsdc: 60_000_000n, marketId: "aave-v3:0xa" },
];

describe("crash and resume", () => {
  it("does not move money twice when the process dies mid-flight", async () => {
    // A chain that remembers every broadcast, so a double-spend is visible.
    const broadcasts: Intent[] = [];
    const landed = new Set<string>();
    const chain: ExecutionPort = {
      submit: vi.fn(async (i: Intent) => {
        broadcasts.push(i);
        const ref = `0xtx-${i.idempotencyKey}`;
        landed.add(ref); // it lands, but the process dies before recording it
        return ref;
      }),
      checkStatus: vi.fn(async (ref: string) => (landed.has(ref) ? "confirmed" : "pending")),
    };

    // --- process 1: broadcasts, then dies before recording the outcome ---
    const db = openLedger(":memory:");
    createRun(db, "r1", PROPOSAL);
    transitionRun(db, "r1", "VALIDATED");
    transitionRun(db, "r1", "EXECUTING");
    const [intent] = materialiseIntents(db, "r1", SPECS);
    const ref = await chain.submit(intent!);
    markSubmitted(db, intent!.id, ref);
    // <- crash here. The transfer is on-chain; the ledger says "submitted".

    expect(broadcasts).toHaveLength(1);
    expect(listIntents(db, "r1")[0]?.status).toBe("submitted");

    // --- process 2: same ledger, restarts, reconciles before doing anything ---
    const report = await reconcile(db, chain);

    expect(report.confirmed).toBe(1);
    expect(getRun(db, "r1")?.status).toBe("SETTLED");

    // THE ASSERTION THAT MATTERS: the money moved exactly once.
    expect(broadcasts).toHaveLength(1);
    expect(chain.submit).toHaveBeenCalledTimes(1);

    db.close();
  });

  it("re-materialising after a crash returns the submitted intent, not a fresh one", () => {
    const db = openLedger(":memory:");
    createRun(db, "r1", PROPOSAL);
    transitionRun(db, "r1", "VALIDATED");
    transitionRun(db, "r1", "EXECUTING");

    const [first] = materialiseIntents(db, "r1", SPECS);
    markSubmitted(db, first!.id, "0xtx");

    // The orchestrator restarts and recomputes the same intents from the
    // same proposal. It must NOT get a pending duplicate to submit.
    const [again] = materialiseIntents(db, "r1", SPECS);
    expect(again?.id).toBe(first?.id);
    expect(again?.status).toBe("submitted");
    expect(again?.txRef).toBe("0xtx");
    expect(listIntents(db, "r1")).toHaveLength(1);

    db.close();
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run packages/ledger/test/crash.test.ts`
Expected: PASS — 2 tests

- [ ] **Step 3: Run the whole suite**

Run: `pnpm test && pnpm typecheck`
Expected: 142 passed, 2 skipped; typecheck clean

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Prove crash-and-resume cannot move money twice

The unit tests cover the parts; this proves the property. A fake chain
remembers every broadcast, the process 'dies' between broadcasting and
recording, and the assertion that matters is that after recovery the
broadcast count is still exactly one.

This is also the demo's strongest 40 seconds — a treasury product that cannot
survive a crash mid-transfer is not a treasury product.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Definition of done

- [ ] `pnpm test` passes — 142 tests, 2 skipped (live)
- [ ] `pnpm typecheck` clean
- [ ] Illegal transitions throw; terminal states are terminal
- [ ] `reconcile` never calls `port.submit`
- [ ] The crash test asserts a broadcast count of exactly 1 after recovery
- [ ] Money round-trips as `bigint` above 2^53

## Deferred

`@idle/agent` (needs `ANTHROPIC_API_KEY`), the real `ExecutionPort` adapters for Privy and Arc, `apps/api` HTTP surface, `apps/web`.
