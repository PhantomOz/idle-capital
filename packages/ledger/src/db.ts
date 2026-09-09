import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
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
  // better-sqlite3 refuses to create the parent directory, so a fresh clone
  // would fail on first boot with "directory does not exist" — the first
  // thing anyone following the README would hit.
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
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
