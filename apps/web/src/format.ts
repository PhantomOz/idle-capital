/**
 * Money formatting for a treasury console.
 *
 * Every amount arrives from the API as a decimal string of USDC minor units.
 * None of these functions parse it into a Number: at 2^53 a JS number starts
 * losing whole units, and a treasury UI that quietly rounds is worse than one
 * that does not render at all.
 */

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const USDC_DECIMALS = 6;

/** USDC minor units -> "1,234,567.890123". String in, string out. */
export function formatUsdc(minor: string): string {
  const negative = minor.startsWith("-");
  const digits = (negative ? minor.slice(1) : minor).padStart(USDC_DECIMALS + 1, "0");
  const whole = digits.slice(0, digits.length - USDC_DECIMALS);
  const frac = digits.slice(digits.length - USDC_DECIMALS);
  return `${negative ? "-" : ""}${group(whole)}.${frac}`;
}

/** A supply-rate fraction -> "3.56%". */
export function formatApy(fraction: number): string {
  const pct = fraction * 100;
  const [whole = "0", frac = "00"] = pct.toFixed(2).split(".");
  const negative = whole.startsWith("-");
  return `${negative ? "-" : ""}${group(negative ? whole.slice(1) : whole)}.${frac}%`;
}

/** A USD magnitude -> "$209.5M". Display only; never money we move. */
export function formatUsdCompact(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/** Local-currency minor units. All four trade currencies use two. */
export function formatLocalMinor(minor: string, _currency: string): string {
  const digits = minor.padStart(3, "0");
  return `${group(digits.slice(0, -2))}.${digits.slice(-2)}`;
}

const SYMBOLS: Record<string, string> = {
  NGN: "₦", KES: "KSh", GHS: "₵", TZS: "TSh",
};

/** The symbol a business would recognise on its own invoice. */
export function currencySymbol(currency: string): string {
  return SYMBOLS[currency] ?? currency;
}

/** "₦2,400.00" — the obligation as the business wrote it down. */
export function formatLocal(minor: string, currency: string): string {
  return `${currencySymbol(currency)}${formatLocalMinor(minor, currency)}`;
}

/**
 * USDC minor units -> "$3.55", rounded DOWN to cents for display.
 *
 * Truncation, not rounding: a headline that reads $3.56 beside a ledger row of
 * 3.550000 invites the question of which one moved. The full precision is
 * always available through formatUsdc.
 */
export function formatUsdcShort(minor: string): string {
  const negative = minor.startsWith("-");
  const digits = (negative ? minor.slice(1) : minor).padStart(7, "0");
  const whole = digits.slice(0, digits.length - 6);
  const cents = digits.slice(digits.length - 6, digits.length - 4);
  return `${negative ? "-" : ""}$${group(whole)}.${cents}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-20" -> "20 Sep". Returns the input unchanged if it is not a date. */
export function formatDueDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  if (month === undefined) return iso;
  return `${Number(m[3])} ${month}`;
}

/** How many days until a due date, from a given day. Negative when overdue. */
export function daysUntil(iso: string, from: Date): number | null {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  const today = Date.parse(`${from.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((t - today) / 86_400_000);
}
