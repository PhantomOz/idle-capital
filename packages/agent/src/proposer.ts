import Anthropic from "@anthropic-ai/sdk";
import type { Allocation, Proposal } from "@idle/core";
import { ALLOCATION_TOOL, buildPrompt, type ProposalContext } from "./prompt.js";

/**
 * Strict decimal-integer string to bigint. Rejects "1.5", "1e3", "" and " 1".
 *
 * One transport artefact is unwrapped first: a value arriving as `"\"123\""`,
 * a JSON string whose content is itself a quoted number. Models produce this
 * intermittently when a schema asks for a number carried in a string, and it
 * cost a live run. Stripping a matched pair of quote characters is not
 * repairing a number — the digits are untouched, and an unbalanced quote or
 * anything non-integral inside still fails.
 */
function toMinor(v: unknown): bigint | null {
  if (typeof v !== "string") return null;
  const unwrapped = v.length >= 2 && v.startsWith('"') && v.endsWith('"')
    ? v.slice(1, -1)
    : v;
  if (!/^-?\d+$/.test(unwrapped)) return null;
  try { return BigInt(unwrapped); } catch { return null; }
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
        throw new Error(`Agent did not call the submit_allocation tool (stop_reason ${res.stop_reason})`);
      }
      const proposal = parseProposal(block.input);
      if (proposal === null) {
        // A payload cut off at the token ceiling and a payload of the wrong
        // shape fail identically here and are fixed completely differently, so
        // the reason has to name which one happened.
        if (res.stop_reason === "max_tokens") {
          throw new Error(
            `Agent ran out of output tokens mid-proposal (max_tokens ${maxTokens}); ` +
            `the tool payload is incomplete`,
          );
        }
        throw new Error(
          `Agent returned an invalid proposal (stop_reason ${res.stop_reason}): ` +
          JSON.stringify(block.input),
        );
      }
      return proposal;
    },
  };
}
