# Spike — Privy and Arc, before building the adapters

**Date:** 2026-09-09 · **Status:** Complete · **Verdict: GO, with one user action**
**Question:** All credentials landed at once. Before writing adapters against
them: does Arc work, does Privy authenticate, does the policy control actually
control anything, and is the Earn vault self-service — the brief's remaining
open Medium risk?

---

## Arc — works, and is stranger than expected

| Check | Result |
|---|---|
| RPC | `arc-testnet.g.alchemy.com`, reachable |
| chainId | **5042002** (`0x4cef52`) |
| Head block | 61,156,932 |
| USDC | `0x3600000000000000000000000000000000000000` — a real 1,798-byte predeploy |
| symbol / decimals | `USDC` / `6` |
| Funded account | `0x26470eB44FdC907429Fd44058c58107c0C108ac0` holds **20 USDC** |

The USDC address is a predeploy at a vanity address, and native balance and
ERC-20 balance report the same figure — **USDC is Arc's native gas token.**
That is unusual and worth knowing before writing settlement code: a transfer
can be either a native value transfer or an ERC-20 call, and they move the
same asset.

## Privy — authenticates, and the control genuinely controls

App `Idle-Capital` authenticates on Basic auth. Zero wallets and zero users
before this spike.

**Server wallet created:** `0x8621fCBa1B2bB29E53F0327aB3aEeFBB1857739F`
(`vhoqr47dkaxjjak9930z9g52`).

**Policy created and attached**, with one rule: allow `eth_signTransaction`
only where `chain_id == 5042002` **and** `value <= 0.01e18`. Then two signing
attempts against the same wallet:

```
sign UNDER the ceiling  ->  200   0x02f86d834cef5280843b9aca00…
sign OVER  the ceiling  ->  400   {"error":"RPC request denied due to
                                   policy violation","code":"policy_violation"}
```

**This is the finding that matters.** The policy is not documentation — it
refused a transaction. It is the same bound K6 enforces in the kernel,
restated at a layer the kernel cannot be bypassed from. Three gates, and now
all three are observed working rather than asserted.

## Privy signs Arc transactions directly

The signed payload above carries `chain_id 5042002`. The Privy server wallet
can therefore *be* the Arc settlement wallet — see D-014. The raw
`ARC_PRIVATE_KEY` becomes unnecessary for settlement, which means no private
key ever enters this process.

## Earn — available, but gated behind a dashboard step we cannot do

The endpoints exist, and are wallet-scoped rather than the paths first guessed:

```
GET  /v1/wallets/{id}/earn/ethereum/vaults      (get vault POSITION, needs vault_id)
POST /v1/wallets/{id}/earn/ethereum/deposit     (requires vault_id)
POST /v1/wallets/{id}/earn/ethereum/withdraw
```

Every call requires a `vault_id`, and a vault only exists once it is
configured in the Privy Dashboard — Privy's own docs list "deploy a fee
wrapper and configure your vault in the Privy Dashboard" as a prerequisite,
with a self-serve subset and the rest behind `sales@privy.io`. Vaults are
Morpho, on Ethereum.

**Two consequences.** First, this is a human dashboard action, not something
an API key can do — it needs the operator. Second, Earn is Ethereum-only,
so parking and Arc settlement are on different chains by construction.

**The brief already anticipated this**: "Fallback is a stablecoin conversion
or transfer flow, both explicitly eligible." `POST /v1/wallets/{id}/transfer`
and `/rpc` are both self-service and both verified working, so the Privy
Financial Flow track is satisfied either way. Earn is upside, not a
dependency.

---

## Verdict

| Item | Status |
|---|---|
| Arc reachable, USDC real, account funded | GO |
| Privy auth, server wallet | GO |
| Privy **policies** — the required control | GO, and empirically enforcing |
| Privy signs Arc transactions | GO |
| Privy **Earn** | Blocked on one Privy Dashboard action by the operator |

Nothing here changes the architecture except in our favour: the wallet that
signs is policy-gated, and we hold no private key.
