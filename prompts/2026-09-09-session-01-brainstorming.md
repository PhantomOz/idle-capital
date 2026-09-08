# Session 01 — Brainstorming and scope

**Date:** 2026-09-09 (session opened 2026-09-08 23:49 WAT)
**Directed by:** PhantomOz
**Tool:** Claude Code (Claude Opus 5, 1M context)
**Workflow:** spec-driven (superpowers brainstorming → spec → plan → build)

## Opening prompt (verbatim)

> You are the Engineering manager, you are to deliver this project
> https://claude.ai/code/artifact/b25b4bd2-04be-4f77-a1ab-549ec82d4351

The linked artifact is the Idle Capital engineering brief, Rev A, dated
2026-09-07. It is the source requirement document for this build.

## What the session established

**Finding raised before any question was asked:** the brief budgets six working
days from 7 Sep. At session open it was 23:52 on 8 Sep with an empty directory
and no commits — days 1 and 2 had elapsed. Real remaining time was ~4d 17h, not
6 days. Two brief requirements accrue and cannot be backfilled (continuous
commit history; per-file attribution), so the empty repo was itself a cost.

**Q1 — credentials.** Which of the three hard blockers are in hand?
→ *All three*: Subgraph Studio API key, Privy app ID + secret, Arc testnet
access with a funded wallet. This closed both external-latency items in the
brief's open-questions table.

**Q2 — resourcing.** Solo build, or specs handed to the four named devs?
→ *Solo.* Claude Code writes the implementation; PhantomOz reviews and records
the demo video. The video constraint was flagged in the question itself: it must
be human-narrated or it is rejected at upload.

**Q3 — decision core architecture.** Three options presented with tradeoffs:
deterministic optimiser only; LLM driving execution directly; or a constrained
three-layer core.
→ *Three-layer core adopted.* Recorded as D-006.

**EM calls made without asking, both flagged for override:**
- Fiat rails leg cut (recorded as D-005).
- TypeScript throughout, forced by the Privy SDK, GraphQL and Next.js.

**Approval:** design approved in full; commits to carry the global git identity
PhantomOz <faniogor@gmail.com>.

## Sequencing decision carried into the build

The first implementation act is a throwaway spike against the live Subgraph
Studio endpoint, to answer the brief's highest-rated risk — whether the Messari
standardized schema returns enough lending markets for a credible comparison —
before anything is built on top of it. The brief says day one, before anything
else; this is that.
