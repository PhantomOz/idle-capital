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
 * The allowlist is the set of venues funds may ENTER, which is narrower than
 * the set of protocols an operator considers acceptable. This deployment holds
 * one execution adapter: the curated Morpho vault reached through Privy Earn.
 * Aave v3, Compound v3 and Spark are acceptable protocols and stay in the
 * comparison the agent reasons over — but listing them here would authorise
 * deposits into venues nothing can deposit into, and a live run duly proposed
 * parking 70% of the surplus across two of them. An allowlist that names
 * unreachable venues is not a policy, it is a trap. D-016.
 *
 * Widening it is a one-line operator change once an adapter exists:
 * PROTOCOL_ALLOWLIST=privy-earn,aave-v3
 */
export function loadPolicy(env: NodeJS.ProcessEnv = process.env): Policy {
  const allowlist = (env.PROTOCOL_ALLOWLIST ?? "privy-earn")
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
