import { describe, expect, it } from "vitest";
import { createArcClient } from "@idle/chain";
import { createPrivyArcExecutor, createPrivyClient } from "../src/index.js";
import type { Address } from "viem";

// Moves real testnet USDC on Arc, signed by the Privy wallet under its
// policy. Skipped unless the credentials are present.
const READY =
  process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET &&
  process.env.PRIVY_WALLET_ID && process.env.PRIVY_WALLET_ADDRESS &&
  process.env.ARC_RPC_URL;
const live = READY ? describe : describe.skip;

live("Privy-signed Arc settlement (integration)", () => {
  const arc = createArcClient(process.env.ARC_RPC_URL!);
  const address = process.env.PRIVY_WALLET_ADDRESS! as Address;
  const privy = createPrivyClient({
    appId: process.env.PRIVY_APP_ID!,
    appSecret: process.env.PRIVY_APP_SECRET!,
    walletId: process.env.PRIVY_WALLET_ID!,
  });
  const executor = createPrivyArcExecutor({
    arc, privy, address, settlementAddress: address,
  });

  it("settles a real intent on Arc without ever holding a private key", async () => {
    const before = await arc.getBalanceUsdcMinor(address);
    expect(before).toBeGreaterThan(0n);

    const txRef = await executor.submit({ amountUsdc: 100_000n }); // 0.1 USDC
    expect(txRef).toMatch(/^0x[0-9a-f]{64}$/i);

    const status = await executor.checkStatus(txRef);
    expect(status).toBe("confirmed");

    console.log(`live: settled 0.1 USDC on Arc, tx ${txRef}`);
  }, 180_000);

  it("reads the treasury balance from the chain", async () => {
    const balance = await arc.getBalanceUsdcMinor(address);
    console.log(`live: treasury holds ${Number(balance) / 1e6} USDC on Arc`);
    expect(balance).toBeGreaterThanOrEqual(0n);
  }, 60_000);
});
