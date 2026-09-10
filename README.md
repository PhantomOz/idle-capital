# Idle Capital

An autonomous treasury agent for a twenty-person business trading across
Nigeria, Kenya, Ghana and Tanzania. It decides how much working capital must
stay liquid against forward obligations in NGN, KES, GHS and TZS — and where
the surplus goes.

It reads live lending rates from **The Graph**, proposes an allocation with
**Claude**, validates that proposal against a deterministic policy kernel, and
settles through a policy-bound **Privy** wallet onto **Arc**.

> **Every rate in this system is live.** The Graph query layer has no fixtures,
> no cache and no fallback — if the gateway fails, the run fails. §[Disclosed
> seams](#disclosed-seams) lists everything that is *not* live, in full.

---

## What one run looks like

```
POST /runs
```

```
The Graph        104 markets across 21 protocols, one standardized query
Agent            holds 11.997128 USDC, parks 8.000000 in the Earn vault
Kernel           K5 ESCALATED — 100% of parked capital in one venue
                 zero intents created; nothing moves
POST /runs/:id/approve
Privy            signs remotely; no private key exists in this process
Arc              8 USDC settled — 0x5720e045…, nonce 3, confirmed
```

The agent's own words from that run:

> *"The only venue we are permitted to use is the USDC earn account, which is
> very deep and easy to exit, so surplus goes there — but the per-run transfer
> cap limits us to eight million this time. The eye-catching rates elsewhere sit
> on venues with nothing left to withdraw, so they are not real returns and we
> decline them."*

The venue it declined is **rari-fuse at 12,728,198.58% APY on negative
liquidity** — a protocol exploited and abandoned in 2022 whose subgraph still
answers and still tops the live yield table. It is in the registry on purpose.
See [`docs/architecture.md` §8](docs/architecture.md#8-data-sources-and-the-seams).

---

## Run it

### Requirements

- **Node ≥ 22** (uses `--env-file-if-exists`)
- **pnpm 10**
- Credentials for The Graph, Anthropic, Privy and an Arc testnet RPC

### 1. Install

```bash
pnpm install
```

### 2. Configure

```bash
cp .env.example .env
```

Fill in `.env`. Every variable is documented inline there; the ones without
defaults are:

| Variable | Where it comes from |
|---|---|
| `GRAPH_API_KEY` | [Subgraph Studio](https://thegraph.com/studio/apikeys/) |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET` | [dashboard.privy.io](https://dashboard.privy.io) → app settings |
| `PRIVY_WALLET_ID`, `PRIVY_WALLET_ADDRESS` | `POST /v1/wallets` — a server wallet |
| `ARC_RPC_URL` | Arc testnet RPC (chainId 5042002) |

Optional but recommended:

| Variable | Effect |
|---|---|
| `PRIVY_EARN_VAULT_ID` | The Earn vault. Without it nothing can be parked and the agent works a fully liquid treasury |
| `SETTLEMENT_ADDRESS` | Settlement counterparty. Defaults to the treasury wallet, which makes every settlement a self-transfer — set it to another account you control |
| `OBLIGATIONS` | `testnet` (default) or `business`. See [below](#the-two-obligation-schedules) |
| `PROTOCOL_ALLOWLIST` | Venues that may receive funds. Defaults to `privy-earn` |

The treasury wallet needs a testnet USDC balance on Arc. USDC is the **native**
gas token there, so the balance is the account balance.

### 3. Start the backend

```bash
pnpm dev:api
```

```
idle-capital api on :8787  wallet 0x8621fCBa1B2bB29E53F0327aB3aEeFBB1857739F
```

### 4. Start the frontend

```bash
pnpm dev:web
```

Open the URL Vite prints — usually `http://localhost:5173`, or the next free
port. It proxies `/api` to the backend.

Press **Run the agent now**. If the kernel escalates, an **Approve** button
appears on the run.

### Or drive it from the terminal

```bash
curl -s localhost:8787/markets  | jq '.markets | length'      # live market count
curl -s -X POST localhost:8787/runs | jq '.run.status, .run.verdict'
curl -s -X POST localhost:8787/runs/<run-id>/approve | jq '.intents'
```

### Running the demo more than once

The settlement leg is a real transfer to a real counterparty, so repeated runs
drain the treasury below its own buffer requirement. Send it back:

```bash
pnpm demo:refund
```

---

## Verify it yourself

```bash
pnpm test        # 274 passing, 4 skipped
pnpm typecheck   # 11 projects, strict
```

The skipped tests are live-credential integration tests. Run them with a
populated `.env`:

```bash
pnpm test:live
```

Three of the tests are worth reading rather than just running:

- **`packages/ledger/test/crash.test.ts`** — crashes mid-run and asserts that
  exactly one broadcast survives the resume.
- **`packages/agent/test/prompt.test.ts`** — asserts an allowlisted venue
  survives a market list flooded with higher-rate junk. That regression cost a
  live run.
- **`packages/yields/test/registry.test.ts`** — asserts the query document names
  no protocol. One standardized document, 26 deployments.

---

## How it works

Three layers, each distrusting the one above it.

```
Claude proposes  →  policy kernel validates  →  Privy wallet policy enforces
   (fallible)         (deterministic, K1-K8)      (server-side, off-box)
```

The kernel has eight invariants. Five **veto** — the run dies and no intent is
ever created. Three **escalate** — a human decides. The split is not about
severity; it is about who may legitimately overrule the rule. Nobody may approve
missing payroll (K1). Somebody may accept concentration risk (K5).

The Privy wallet policy is the only layer that survives total compromise of this
codebase. Its ceiling is deliberately *above* the kernel's — 10 USDC per
transaction against the kernel's 8 per run — because an outer bound below the
inner one would mean kernel-approved runs get refused at the wallet, training
whoever is on call to ignore refusals. It has refused a real transaction in this
repo's history.

**Full detail, with diagrams: [`docs/architecture.md`](docs/architecture.md).**

### The two obligation schedules

The business owes about **$12,200** over 30 days. The treasury this build
controls is a testnet faucet balance of about **12 USDC**.

Against the real schedule the agent is correct to park nothing, on every run,
forever — so the demo would prove the buffer invariant and nothing else. The
default `OBLIGATIONS=testnet` runs the same four-currency schedule scaled by
1/2000. Currencies, categories, due dates and the FX table are untouched; only
the denomination moves, and the ids carry a `-scaled` suffix.

`OBLIGATIONS=business` shows K1 refusing the entire surplus, which is the other
half of the demonstration.

---

## Disclosed seams

Everything in this system that is not live, in full:

| | Status |
|---|---|
| Lending rates and liquidity | **Live** — 26 Messari standardized subgraphs, queried per run |
| Earn vault APY, liquidity, position | **Live** — Privy Earn API |
| Treasury balance, settlement | **Live** — Arc testnet, signed by Privy |
| FX rates | **Fixed table** with an `asOf` date and a source string, surfaced in the UI |
| Obligations | **Fixture** — company data; there is no feed to read it from |
| Arc | **Testnet**, chainId 5042002 |
| Earn deposit execution | **Not exercised** — the vault is Base mainnet with real USDC. It is read live and targeted by allocations; the settlement leg runs on Arc |

---

## Repository conventions

| Path | Contents |
|---|---|
| `docs/architecture.md` | How it is built and why, with diagrams |
| `DECISIONS.md` | Twenty architectural calls, each with its reasoning |
| `ATTRIBUTION.md` | Which files are AI-generated or AI-assisted, per file |
| `specs/` | Every spec, versioned as it changed |
| `specs/spikes/` | The two spikes that de-risked the build, with their findings |
| `specs/plans/` | The implementation plans, as written before execution |
| `prompts/` | Session prompts, dated |

This build is AI-assisted throughout, directed through a spec-driven workflow.
See [`ATTRIBUTION.md`](ATTRIBUTION.md).

Most of the decisions in `DECISIONS.md` were forced by **running** the system
rather than reviewing it: a withdrawal gap that only appeared once positions
existed, a first-boot crash a judge would have hit, a markets table that buried
its own conclusion, a wallet ceiling set to an arbitrary spike value, and a
prompt whose rate sort had quietly decided which venues the agent was allowed to
consider.
