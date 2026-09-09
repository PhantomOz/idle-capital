import Anthropic from "@anthropic-ai/sdk";
import type { Allocation, Proposal } from "@idle/core";
import { ALLOCATION_TOOL, buildPrompt, type ProposalContext } from "./prompt.js";

/** Strict decimal-integer string to bigint. Rejects "1.5", "1e3", "" and " 1". */
function toMinor(v: unknown): bigint | null {
  if (typeof v !== "string" || !/^-?\d+$/.test(v)) return null;
  try { return BigInt(v); } catch { return null; }
}

/**
 * Parse the model's tool payload.
 *
 * Returns null for anything unusable rather than throwing or repairing. The
 * kernel is the authority on whether a proposal is acceptable; this function's
 * only job is deciding whether it is even a proposal.
 */
export function parseProposal(input: unknown): Proposal | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;

  const hold = toMinor(o.hold);
  if (hold === null) return null;
  if (typeof o.rationale !== "string" || o.rationale.trim().length === 0) return null;
  if (!Array.isArray(o.allocations)) return null;

  const allocations: Allocation[] = [];
  for (const raw of o.allocations) {
    if (typeof raw !== "object" || raw === null) return null;
    const a = raw as Record<string, unknown>;
    if (typeof a.marketId !== "string" || a.marketId.length === 0) return null;
    const amount = toMinor(a.amountUsdc);
    if (amount === null) return null;
    allocations.push({ marketId: a.marketId, amountUsdc: amount });
  }
  return { hold, allocations, rationale: o.rationale };
}

export type ProposerOptions = {
  client?: Anthropic;
  apiKey?: string;
  model?: string;
  maxTokens?: number;
};

/**
 * The reasoning layer.
 *
 * The tool is forced, so "the model replied in prose" is not a failure mode
 * that reaches production. Everything it returns still goes to the kernel,
 * which trusts none of it.
 */
export function createProposer(opts: ProposerOptions = {}) {
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY });
  const model = opts.model ?? process.env.AGENT_MODEL ?? "claude-opus-5";
  const maxTokens = opts.maxTokens ?? 2048;

  return {
    async propose(ctx: ProposalContext): Promise<Proposal> {
      const res = await client.messages.create({
        model,
        max_tokens: maxTokens,
        tools: [ALLOCATION_TOOL],
        tool_choice: { type: "tool", name: ALLOCATION_TOOL.name },
        messages: [{ role: "user", content: buildPrompt(ctx) }],
      });

      const block = (res.content as { type: string; name?: string; input?: unknown }[])
        .find((b) => b.type === "tool_use" && b.name === ALLOCATION_TOOL.name);
      if (block === undefined) {
        throw new Error("Agent did not call the submit_allocation tool");
      }
      const proposal = parseProposal(block.input);
      if (proposal === null) {
        throw new Error(`Agent returned an invalid proposal: ${JSON.stringify(block.input).slice(0, 200)}`);
      }
      return proposal;
    },
  };
}
