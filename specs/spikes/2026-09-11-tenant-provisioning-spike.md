# Spike — per-tenant wallet provisioning

**Date:** 2026-09-11 · **Verdict:** GO

## Question

Can a business be onboarded entirely over the API — its own Privy wallet, its
own spending policy, enforced — with no dashboard step? Every part of the
multi-tenant plan depends on the answer, so it was probed before any code.

## Method

`.idle/spike-provision.ts`, against the live Privy API. Five steps: create a
policy, create a wallet with that policy attached, read the wallet back to
confirm attachment, then attempt one signature over the ceiling and one under.

## Findings

**F1 — The policy schema is flat.** `POST /v1/policies` takes a top-level
`rules` array of `{name, method, conditions, action}`. It rejects
`method_rules` and `default_action` outright:

```
400 Validation error: Required at "rules"; Unrecognized key(s) in object:
    'method_rules', 'default_action'
```

The working shape was recovered by reading back the policy created by hand
during the Privy/Arc spike, which is the cheapest schema reference available
and worth reaching for before guessing twice.

**F2 — Values in conditions are hex.** `0x8ac7230489e80000` is 10 × 10^18.
Arc's native USDC carries 18 decimals while the treasury counts 6, so the
policy ceiling is expressed in the chain's units, not the ledger's. The two
scales meet in `packages/chain`, and a provisioner must convert rather than
copy a number across.

**F3 — A wallet can be born with its policy attached.** `POST /v1/wallets`
accepts `policy_ids` at creation. There is no window in which a provisioned
wallet exists unguarded, which matters: a tenant wallet that is briefly
policy-free is a tenant wallet that can be drained during onboarding.

**F4 — The policy binds on a freshly provisioned wallet.** Proved, not assumed:

| Attempt | Result |
|---|---|
| 200 USDC — over the 10 ceiling | `400 policy_violation` |
| 1 USDC — under the ceiling | signed |

This is the same empirical standard the first Privy spike used (D-014). A
control nobody has watched refuse something is not yet a control.

## Consequence

Onboarding is a single API sequence: create policy → create wallet with it →
return the address to fund. Each business gets an independently enforced
spending envelope, which is what turns this from one hardcoded wallet in a
`.env` into a B2B financial product.

Artifacts created during the spike (live, on the Privy app): policy
`n70yj90kdhyev5uknpy8dvlf`, wallet `ufaei8ivd0hk44c3puxyt4e9` at
`0x216Ac9b94c63752484F9238eBB6fF5B330752c43`. Unfunded; retained as evidence.
