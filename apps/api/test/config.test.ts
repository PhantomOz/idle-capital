import { describe, expect, it } from "vitest";
import { loadPolicy } from "../src/config.js";
import { BUSINESS_OBLIGATIONS, TESTNET_OBLIGATIONS, loadObligations } from "../src/obligations-fixture.js";
import { bufferRequirementUsdc } from "@idle/obligations";

const ASOF = new Date("2026-09-10T00:00:00Z");

describe("loadPolicy", () => {
  /**
   * The allowlist authorises deposits. Naming a venue nothing can deposit into
   * is not a policy — a live run proposed parking 70% of the surplus across two
   * such venues before this was narrowed.
   */
  it("allows only venues this deployment can execute against", () => {
    expect(loadPolicy({}).protocolAllowlist).toEqual(["privy-earn"]);
  });

  it("lets an operator widen it without a code change", () => {
    const p = loadPolicy({ PROTOCOL_ALLOWLIST: "privy-earn, aave-v3 ,compound-v3" });
    expect(p.protocolAllowlist).toEqual(["privy-earn", "aave-v3", "compound-v3"]);
  });

  it("drops empty entries rather than allowlisting the empty protocol", () => {
    expect(loadPolicy({ PROTOCOL_ALLOWLIST: "privy-earn,," }).protocolAllowlist).toEqual(["privy-earn"]);
  });

  it("rejects a non-integer where an integer is required, instead of coercing it", () => {
    expect(() => loadPolicy({ BUFFER_HORIZON_DAYS: "30.5" })).toThrow(/must be an integer/);
  });
});

describe("loadObligations", () => {
  it("defaults to the testnet scale, so the documented run reaches settlement", () => {
    expect(loadObligations({})).toEqual(TESTNET_OBLIGATIONS);
  });

  it("serves the full business schedule on request", () => {
    expect(loadObligations({ OBLIGATIONS: "business" })).toBe(BUSINESS_OBLIGATIONS);
  });

  it("refuses an unrecognised value rather than silently picking one", () => {
    expect(() => loadObligations({ OBLIGATIONS: "prod" })).toThrow(/must be "testnet" or "business"/);
  });

  it("keeps every currency, category and due date when it scales", () => {
    expect(TESTNET_OBLIGATIONS.map((o) => [o.currency, o.category, o.dueDate]))
      .toEqual(BUSINESS_OBLIGATIONS.map((o) => [o.currency, o.category, o.dueDate]));
  });

  it("scales to a requirement the testnet treasury can actually cover", () => {
    // A few real dollars against a ~1.75 USDC requirement leaves a real
    // surplus to park. The business schedule needs 12,200 USDC and cannot.
    expect(bufferRequirementUsdc(TESTNET_OBLIGATIONS, 30, ASOF)).toBe(1_524_640n);
    expect(bufferRequirementUsdc(BUSINESS_OBLIGATIONS, 30, ASOF)).toBe(12_200_000_000n);
  });

  it("gives the two schedules distinct ids so a ledger cannot confuse them", () => {
    const business = new Set(BUSINESS_OBLIGATIONS.map((o) => o.id));
    expect(TESTNET_OBLIGATIONS.every((o) => !business.has(o.id))).toBe(true);
  });
});
