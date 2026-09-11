import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Schedule } from "../src/Schedule.js";
import type { ScheduleView } from "../src/api.js";

const TODAY = new Date("2026-09-11T12:00:00Z");

function schedule(over: Partial<ScheduleView> = {}): ScheduleView {
  return {
    obligations: [{
      id: "ng-payroll", currency: "NGN", amountMinor: "240000", usdcMinor: "1500000",
      dueDate: "2026-09-20", category: "supplier", confidence: 0.9, withinHorizon: true,
    }],
    totalUsdc: "3000000",
    minimumHoldUsdc: "3450000",
    deployableUsdc: "3550000",
    horizonDays: 30,
    multiplierBps: 11_500,
    fx: { asOf: "2026-09-01", source: "Documented fixed-rate table; not a live oracle." },
    ...over,
  };
}

describe("Schedule", () => {
  /** The input the whole decision turns on, and the thing the old page hid. */
  it("shows the obligation in the currency the business owes it in", () => {
    render(<Schedule schedule={schedule()} treasuryUsdc="7000000" today={TODAY} />);
    expect(screen.getByText("₦2,400.00")).toBeTruthy();
  });

  it("shows the dollar equivalent beside it", () => {
    render(<Schedule schedule={schedule()} treasuryUsdc="7000000" today={TODAY} />);
    expect(screen.getByText("$1.50")).toBeTruthy();
  });

  it("says when it is due in days, not just as a date", () => {
    render(<Schedule schedule={schedule()} treasuryUsdc="7000000" today={TODAY} />);
    expect(screen.getByText("20 Sep")).toBeTruthy();
    expect(screen.getByText("in 9 days")).toBeTruthy();
  });

  it("flags an overdue obligation as overdue rather than as a past date", () => {
    const s = schedule({ obligations: [{
      ...schedule().obligations[0]!, dueDate: "2026-09-01",
    }] });
    render(<Schedule schedule={s} treasuryUsdc="7000000" today={TODAY} />);
    expect(screen.getByText("10 days overdue")).toBeTruthy();
  });

  it("names the country, so a currency code is never the only clue", () => {
    render(<Schedule schedule={schedule()} treasuryUsdc="7000000" today={TODAY} />);
    expect(screen.getByText("Nigeria")).toBeTruthy();
  });

  it("marks an uncertain obligation without discounting its amount", () => {
    render(<Schedule schedule={schedule()} treasuryUsdc="7000000" today={TODAY} />);
    expect(screen.getByText("90% likely")).toBeTruthy();
    expect(screen.getByText("$1.50")).toBeTruthy();
  });

  it("states the floor and what is free above it", () => {
    render(<Schedule schedule={schedule()} treasuryUsdc="7000000" today={TODAY} />);
    expect(screen.getByText("$3.45")).toBeTruthy();
    expect(screen.getByText("$3.55")).toBeTruthy();
  });

  it("explains the margin as a percentage rather than as basis points", () => {
    render(<Schedule schedule={schedule()} treasuryUsdc="7000000" today={TODAY} />);
    expect(screen.getByText(/plus a 15% margin/)).toBeTruthy();
  });

  /** A fixed FX table is a seam, and disclosed seams stay on the page. */
  it("discloses that the conversion is not a live oracle", () => {
    render(<Schedule schedule={schedule()} treasuryUsdc="7000000" today={TODAY} />);
    expect(screen.getByText(/fixed table dated 2026-09-01, not a live oracle/)).toBeTruthy();
  });

  it("invites a schedule when there is none, rather than showing an empty table", () => {
    render(<Schedule schedule={schedule({ obligations: [] })} treasuryUsdc={null} today={TODAY} />);
    expect(screen.getByText(/Nothing owed yet/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
