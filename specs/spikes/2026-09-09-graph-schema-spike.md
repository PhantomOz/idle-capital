# Spike — Does the Messari standardized schema carry the product?

**Date:** 2026-09-09 · **Status:** Complete · **Verdict: GO**
**Question:** The brief rates this the single highest risk. Do Messari
Standardized Subgraphs cover enough lending protocols, with usable data, to
make a credible multi-protocol comparison from one query pattern?

**Method:** Read the Messari deployment registry, selected one decentralized
deployment per lending protocol, and executed a **single identical GraphQL
document** against every one of them in parallel. Probe scripts were
throwaway and are not in the repo; every number below is reproducible from
the registry plus a Subgraph Studio key.

---

## Headline result

| Measure | Count |
|---|---|
| Protocols on the standardized `lending` schema | 51 |
| ...with a decentralized-network deployment | 46 |
| ...that responded | 35 |
| ...that returned markets | 28 |
| ...that returned **stablecoin** markets | 25 |
| Distinct stablecoin lending markets available | **142** |

**One query document. 25 protocols. Zero per-protocol integration code.**
That is the standards-leverage claim The Graph's track asks us to make, and
it is now measured rather than asserted.

Top of the live set, by deposits:

| Protocol | Asset | Supply APY | Deposits | Liquidity |
|---|---|---|---|---|
| aave-v3 | USDT | 3.56% | $2,986M | $209.5M |
| aave-v3 | USDC | 12.85% | $2,164M | **$0.2M** |
| spark-lend | USDT | 2.81% | $379.6M | $54.4M |
| compound-v3 | USDC | 4.58% | $376.0M | $36.0M |
| aave-v3 | DAI | 3.07% | $131.6M | $17.4M |

---

## Five findings that change the build

### F1 — `supplyApy` is a percent, not a fraction

The spec said "fraction, e.g. 0.0431". The schema returns `"3.0674951411720908"`
for Aave DAI — percent. Left uncorrected, every yield in the product would
have been understated 100×, and the agent would have ranked venues on a
number two orders of magnitude off.

`rates` also carries **multiple entries per market** — a `BORROWER/STABLE`
rate of `0` sits alongside `BORROWER/VARIABLE` and `LENDER/VARIABLE`. Reading
"the first LENDER rate" is not safe; the adapter must filter on side **and**
type. All numeric fields arrive as decimal **strings**.

**Action:** `yields` normalizes to a fraction at the adapter boundary, filters
`side: LENDER, type: VARIABLE`, and parses strings explicitly.

### F2 — Indexer unavailability is normal, and D-007 was too strict

11 of 46 deployments failed, none of them our fault:

```
4x  subgraph not found: no allocations
3x  bad indexers: Unavailable(no status: failed to query indexer)
1x  bad indexers: BadResponse(no attestation)
1x  Type `Query` has no field `lendingProtocols`   <- schema outlier
```

This is ordinary decentralized-network behaviour: indexers come and go. D-007
as written ("if the live Graph query fails, the run fails") would brick the
product whenever any one of 25 subgraphs was mid-reallocation.

**Action:** D-007 is refined to a **quorum** rule — see D-009. No cache and no
fixtures, ever; but one flaky indexer is not a run failure.

### F3 — The data contains live landmines, and they validate the kernel

Two markets in the returned set:

| Protocol | Asset | Reported APY | Reported liquidity |
|---|---|---|---|
| rari-fuse | FRAX | **174.24%** | **−$4.7M** |
| iron-bank | USDT | **75.10%** | $11.5M |

Rari Fuse was exploited and abandoned in 2022. Its subgraph still answers, and
still reports the highest yield in the entire set. An agent optimising naively
for APY would send the treasury there first.

This is the strongest empirical result of the spike: **K4 (venue allowlist)
and K7 (liquidity floor) are not hypothetical hardening.** They stop a real,
currently-live trap that the highest-yield sort surfaces immediately. Negative
liquidity is also now a known-real value — `liquidityUsd` may be negative, and
K7's `<` comparison already handles it.

### F4 — Headline APY can be unwithdrawable

Aave v3 USDC shows 12.85% on $2.16bn of deposits with **$0.2M** of liquidity —
near-total utilisation. The rate is real; the exit is not.

This is exactly K7's argument ("yield on capital that cannot be withdrawn is
not yield") holding against real data rather than a unit test.

### F5 — Schema versions 1.3.0 through 3.1.0 coexist

One document worked across all of them but one. The standardized schema is
genuinely stable across versions — the leverage claim survives contact.

---

## Consequences

| Item | Where it lands |
|---|---|
| APY percent → fraction; rate filtering; string parsing | Spec §4 `yields` contract |
| Quorum instead of all-or-nothing | D-009, spec §8 |
| Allowlist/liquidity-floor validated on live data | D-010; demo narrative |
| `liquidityUsd` may be negative | Spec §4 `Market` |

**The query layer is GO.** No pivot required, and the $10,000 of Graph-track
exposure the brief flagged is retired as a risk.
