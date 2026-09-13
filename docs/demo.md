# Demo runbook

A 3-minute walkthrough, and how to put the system back so you can record it
again. Every figure below is real: Base mainnet, real USDC, a treasury of three
dollars.

---

## Before you record

```bash
pnpm dev:api          # terminal 1 — :8787
pnpm dev:web          # terminal 2 — :5173
pnpm demo:reset       # pull parked capital back so there is a decision to make
```

`demo:reset` is the one that matters. After a settled run the treasury is
already where the agent wants it, so the next run correctly decides *nothing* —
right behaviour, dull recording. The reset withdraws the position so the agent
has a live decision. It is an operator action: no run is created and the ledger
gains no history claiming the agent did something it did not.

**Check you are ready.** Open `http://localhost:5173`, pick **Kesi Foods**, and
confirm the masthead reads roughly:

```
Treasury $3.00    Liquid $3.00    Committed $0.00    Wallet 0x8621…739F
```

Committed **must** be `$0.00`. If it is not, run `pnpm demo:reset` again.

> Gas: each operation costs about `0.0000087` ETH. The wallet holds enough for
> roughly 50 more. `pnpm demo:reset` spends one too, so a long recording session
> is the thing most likely to run it dry — check the balance if runs start
> failing.

---

## The script

### 0:00 — What the business is (20s)

Land on the business list, not on a dashboard.

> "This is a twenty-person business selling across Lagos, Nairobi, Accra and
> Dar es Salaam. It collects in dollars and pays in naira, shillings and cedis.
> Payroll lands on the 25th, the supplier on the 18th, rent on the 1st — so the
> safe thing is to touch nothing, and the cash earns nothing."

Click **Kesi Foods**.

### 0:20 — What it owes (30s)

Let the obligations table sit on screen. Four bills, four currencies, four due
dates, each with days remaining and a dollar conversion.

> "Four bills in four currencies over the next three weeks. One point five two
> owed, and at a fifteen percent margin, one seventy-five has to stay liquid.
> Which leaves one twenty-four free to earn — and that is the only question
> this product asks."

Point at **Free to earn $1.24**. Note aloud that FX is a fixed table with a
date on it, not a live oracle — the footnote says so on screen.

### 0:50 — Ask the agent (35s)

Click **Run it again**. It takes 20–40 seconds; talk over it.

> "It is pulling live lending rates from The Graph — a hundred and four markets
> across twenty-six standardized Messari subgraphs, one query document, six
> chains. Then Claude proposes an allocation, and a deterministic kernel checks
> that proposal against rules I set."

### 1:25 — The refusal (35s) ← **the most important shot**

Scroll to **Where it could go**.

```
12,728,198.58%   The best rate on offer today is rari-fuse DAI, holding
                 -$5.7K of withdrawable liquidity. It is not on the
                 allowlist, so the agent cannot put anything there.

privy-earn  USDC  3.86%  $159.3M

103 of 104 markets refused — off the allowlist, or below the liquidity floor of $1.0M.
```

> "The best headline rate today is twelve *million* percent, on a pool with
> negative withdrawable liquidity. The agent refused it, and said why in its
> own words."

Scroll back to the decision and read the agent's sentence aloud:

> *"The eye-catching rates elsewhere sit in pools that are reporting more
> borrowed than supplied, meaning we could not get our money out."*

> "That is what The Graph is for here. Take the live data away and the agent
> cannot tell three point eight six percent from twelve million percent. The
> comparison is the reasoning."

### 2:00 — The kernel stops it (25s)

Point at the escalation band:

```
The safety rules want a human on this one:
It would put too much of the surplus in a single venue.        rule K5
```

> "The agent wanted to put the whole surplus in one venue. My concentration
> rule caps that at fifty percent, so it stopped and asked. Nothing has moved —
> zero intents exist. The LLM proposes; it never executes."

Mention `K9` if you have a spare breath:

> "There is also a rule that vetoes a venue that cannot earn its keep. It is
> there because this project spent a week parking capital at nought point nought
> nought three percent, and the other eight rules all passed it."

### 2:25 — Approve, and it is real (30s)

Click **Approve — move the money**.

> "Privy's policy checks it before signing — the vault must be the allowlisted
> one and the amount under a ten-dollar ceiling. Then a server wallet signs. No
> private key exists anywhere in this codebase."

When it settles, point at the masthead: **Liquid $1.75 · Committed $1.24**, and
at the disclosure line:

> "Deposited into a Morpho vault on Base, real USDC, earning from the moment it
> lands. And the committed figure is the vault's own answer, not my bookkeeping."

### 2:55 — Close (15s)

> "Multi-tenant: every business gets its own wallet and its own policy,
> provisioned before it can be funded. The money comes back the same way it went
> in — add a bill and the agent withdraws the difference automatically."

---

## Optional: the withdrawal (if you have 30 more seconds)

The strongest second act, because it proves the money is retrievable.

Click **edit** on the obligations, add a bill:

| field | value |
|---|---|
| currency | NGN |
| amount | 120000 |
| due | 2026-09-16 |
| category | supplier |

Run again. The agent proposes a *smaller* allocation, and `deriveIntents` emits
the **difference** as a withdrawal rather than re-depositing from scratch.
Approve it, and the position drops.

> "A bill lands three days out. The buffer goes up, so the agent pulls money
> back out of the vault — and it takes out the difference, not the whole
> position."

Remove that obligation afterwards to restore the four-bill schedule.

---

## If something goes wrong on camera

| Symptom | Cause | Fix |
|---|---|---|
| Run settles instantly, nothing moved | Treasury already where the agent wants it | `pnpm demo:reset` |
| `add what this business owes` (409) | No obligations for that tenant | Add them via **edit**, or pick Kesi Foods |
| Intent fails, `insufficient funds for gas` | Wallet out of ETH | Send ~`0.0005` ETH on Base to the wallet |
| Intent fails, `policy_violation` | Wallet still on a pre-Base policy | `pnpm repolicy <business-id>` |
| Treasury reads `$0.00`, `treasuryError` set | Base RPC unreachable | Check `BASE_RPC_URL` |
| Markets panel 503 | Graph gateway or key | Check `GRAPH_API_KEY`; there is no cache and no fallback by design |

Only **Kesi Foods** is funded and on a Base policy. Zamara, Bahari and Favour
Trend are empty and still carry Arc-era policies — `pnpm repolicy` fixes them if
you want a second tenant on camera.

---

## What each sponsor should see

| Track | The shot |
|---|---|
| Graph — Composable/Standardized | The markets panel: 104 markets, 26 subgraphs, one query document, live |
| Graph — AI Use Case | The 12,728,198.58% refusal and the agent's own sentence about it |
| Privy — B2B Financial Product | Per-tenant wallet + policy on the business list; `pnpm repolicy` output |
| Privy — Best Financial Flow | Approve → deposit settles → **Committed $1.24**; and the withdrawal |
