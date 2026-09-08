import { USDC_UNIT, divCeil, type Currency } from "@idle/core";

export type FxTable = {
  /** ISO date the rates were captured. */
  asOf: string;
  /** Provenance, surfaced in the UI and README as a disclosed seam. */
  source: string;
  /** Minor units of local currency per 1 USD. NGN 1600.00/USD -> 160_000n. */
  minorPerUsd: Readonly<Record<Currency, bigint>>;
};

/**
 * Idle Capital does not consume a live FX oracle. Rates are a documented
 * fixed table, disclosed in the README and the demo, exactly as Arc being a
 * testnet is disclosed. Swapping in an oracle means replacing this object.
 */
export const FIXED_FX: FxTable = {
  asOf: "2026-09-01",
  source: "Documented fixed-rate table; not a live oracle. See specs/2026-09-09-idle-capital-design.md §2.",
  minorPerUsd: {
    NGN: 160_000n, // 1600.00 NGN / USD
    KES: 12_900n,  //  129.00 KES / USD
    GHS: 1_550n,   //   15.50 GHS / USD
    TZS: 270_000n, // 2700.00 TZS / USD
  },
};

/**
 * Convert a local-currency minor amount into USDC minor units, rounding UP.
 * Rounding up keeps a converted obligation from ever being under-reserved.
 */
export function toUsdcMinor(
  amountMinor: bigint,
  currency: Currency,
  fx: FxTable = FIXED_FX,
): bigint {
  const minorPerUsd = fx.minorPerUsd[currency];
  return divCeil(amountMinor * USDC_UNIT, minorPerUsd);
}
