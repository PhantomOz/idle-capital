/** USDC has six decimals. One whole USDC in minor units. */
export const USDC_UNIT = 1_000_000n;
export const USDC_DECIMALS = 6;

/**
 * Ceiling division for bigints.
 *
 * Rounds up on any remainder. Every money conversion in this system uses it,
 * because under-reserving is the unsafe direction: a buffer one unit too large
 * costs nothing, one unit too small can miss payroll.
 */
export function divCeil(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError(`divCeil: denominator must be > 0, got ${denominator}`);
  }
  if (numerator <= 0n) return 0n;
  return (numerator + denominator - 1n) / denominator;
}

/**
 * Apply a basis-point factor to a bigint amount, rounding up.
 * Ratios are basis points so no float ever touches money.
 */
export function applyBpsCeil(amount: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0) {
    throw new RangeError(`applyBpsCeil: bps must be a non-negative integer, got ${bps}`);
  }
  return divCeil(amount * BigInt(bps), 10_000n);
}
