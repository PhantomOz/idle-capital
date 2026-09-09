import type { Policy } from "@idle/core";

function int(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${key} must be an integer, got ${raw}`);
  return n;
}

/**
 * The operator's policy. Trusted configuration, unlike an agent proposal —
 * written by a human and reviewed, not generated.
 *
 * The allowlist default is the blue-chip set: audited, deeply liquid, and
 * defensible to anyone asking why these three. Every other protocol in the
 * registry still appears in the comparison the agent reasons over; they just
 * cannot receive funds.
 */
export function loadPolicy(env: NodeJS.ProcessEnv = process.env): Policy {
  const allowlist = (env.PROTOCOL_ALLOWLIST ?? "aave-v3,compound-v3,spark-lend")
    .split(",").map((s) => s.trim()).filter((s) => s.length > 0);

  return {
    bufferHorizonDays: int(env, "BUFFER_HORIZON_DAYS", 30),
    bufferMultiplierBps: int(env, "BUFFER_MULTIPLIER_BPS", 11_500),
    protocolAllowlist: allowlist,
    maxVenueConcentrationBps: int(env, "MAX_VENUE_CONCENTRATION_BPS", 5_000),
    maxRunMovementUsdc: BigInt(env.MAX_RUN_MOVEMENT_USDC ?? "500000000000"),
    minVenueLiquidityUsd: int(env, "MIN_VENUE_LIQUIDITY_USD", 1_000_000),
  };
}
