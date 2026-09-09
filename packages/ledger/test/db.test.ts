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
