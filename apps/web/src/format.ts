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
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/** Local-currency minor units. All four trade currencies use two. */
export function formatLocalMinor(minor: string, _currency: string): string {
  const digits = minor.padStart(3, "0");
  return `${group(digits.slice(0, -2))}.${digits.slice(-2)}`;
}
