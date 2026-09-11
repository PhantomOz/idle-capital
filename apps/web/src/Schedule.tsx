import type { ScheduleView } from "./api.js";
import { daysUntil, formatDueDate, formatLocal, formatUsdcShort } from "./format.js";

const CATEGORY_WORDS: Record<string, string> = {
  payroll: "Payroll", supplier: "Supplier", rent: "Rent", tax: "Tax",
};

const COUNTRY: Record<string, string> = {
  NGN: "Nigeria", KES: "Kenya", GHS: "Ghana", TZS: "Tanzania",
};

function when(dueDate: string, today: Date): string {
  const days = daysUntil(dueDate, today);
  if (days === null) return "";
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

/**
 * What the business owes — the input the whole decision turns on.
 *
 * This panel exists because the first version of this page showed the answer
 * and hid the question. A reader could see the agent holding $3.45 and had no
 * way to learn why that number and not another.
 */
export function Schedule({
  schedule, treasuryUsdc, today,
}: {
  schedule: ScheduleView;
  treasuryUsdc: string | null;
  today: Date;
}) {
  const { obligations } = schedule;

  if (obligations.length === 0) {
    return (
      <p className="empty">
        Nothing owed yet. Add what this business has to pay and when, and the agent
        can work out how much must stay liquid.
      </p>
    );
  }

  return (
    <div className="schedule">
      <table className="ledger">
        <thead>
          <tr>
            <th scope="col">Due</th>
            <th scope="col">What for</th>
            <th scope="col" className="num">Amount</th>
            <th scope="col" className="num">In dollars</th>
          </tr>
        </thead>
        <tbody>
          {obligations.map((o) => (
            <tr key={o.id} data-horizon={o.withinHorizon ? "in" : "out"}>
              <td>
                <span className="due-date">{formatDueDate(o.dueDate)}</span>
                <span className="due-rel">{when(o.dueDate, today)}</span>
              </td>
              <td>
                {CATEGORY_WORDS[o.category] ?? o.category}
                <span className="where">{COUNTRY[o.currency] ?? o.currency}</span>
                {o.confidence < 1 && (
                  <span className="maybe">{Math.round(o.confidence * 100)}% likely</span>
                )}
              </td>
              <td className="num">{formatLocal(o.amountMinor, o.currency)}</td>
              <td className="num">{formatUsdcShort(o.usdcMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="totals">
        <div>
          <dt>Owed in the next {schedule.horizonDays} days</dt>
          <dd>{formatUsdcShort(schedule.totalUsdc)}</dd>
        </div>
        <div className="floor">
          <dt>
            Must stay liquid
            <span className="why">that, plus a {schedule.multiplierBps / 100 - 100}% margin</span>
          </dt>
          <dd>{formatUsdcShort(schedule.minimumHoldUsdc)}</dd>
        </div>
        <div className="free">
          <dt>
            Free to earn
            <span className="why">
              {treasuryUsdc === null ? "once the balance can be read" : "everything above the line"}
            </span>
          </dt>
          <dd>{formatUsdcShort(schedule.deployableUsdc)}</dd>
        </div>
      </dl>

      <p className="seam">
        Converted at a fixed table dated {schedule.fx.asOf}, not a live oracle.
      </p>
    </div>
  );
}
