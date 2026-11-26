import Anthropic from "@anthropic-ai/sdk";
import { logCopilot, type ActionItem, type Db, type Receipt } from "@/foundation";
import { ungroundedNumbers } from "@/lib/grounding";
import { SYSTEM_PROMPT, TOOL_LABEL } from "./prompt";
import { MAX_TOOL_CALLS, makeTools, type ToolContext } from "./tools";

/**
 * One copilot question: the model calls read tools until it has the numbers,
 * then answers. Runs on our server with the SDK's tool runner, streaming, so
 * the panel can show which tool is running and the answer as it is written.
 */

export const MODEL = process.env.COPILOT_MODEL || "claude-opus-5-5";
const EFFORT = (process.env.COPILOT_EFFORT || "medium") as "low" | "medium" | "high";

export const copilotEnabled = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ReceiptSummary {
  asOf: string[];
  filters: string[];
  metrics: string[];
  sources: string[];
  assumptions: string[];
  warnings: string[];
  tools: string[];
}

export type CopilotEvent =
  | { type: "status"; tool: string; label: string }
  | { type: "tool_done"; tool: string; label: string; ok: boolean }
  | { type: "text"; delta: string }
  | { type: "reset_text" }
  | { type: "proposal"; item: ActionItem }
  | { type: "done"; answer: string; receipt: ReceiptSummary; ungrounded: string[]; stopReason: string | null }
  | { type: "error"; message: string; retryable: boolean };

export interface RunArgs {
  client: Anthropic;
  db: Db;
  history: ChatTurn[];
  question: string;
  asOf: string;
  screen: string;
  /** From an "Ask about this" button: the card's metric, campaign and date range. */
  focus?: string | null;
  visitor: string | null;
  signal?: AbortSignal;
}

const SCREEN_NAMES: Record<string, string> = { "/": "Overview", "/campaigns": "Campaigns", "/plan": "Plan", "/tasks": "Tasks", "/data": "Data" };

function turnContext(a: RunArgs): string {
  const screen = SCREEN_NAMES[a.screen] ?? a.screen;
  return [
    `Date on screen: ${a.asOf}. Use it unless the person names another date.`,
    `Screen: ${screen}.`,
    a.focus ? `The person pressed "Ask about this" on: ${a.focus}` : "",
    "Fetch every number fresh with tools; do not reuse numbers from earlier turns.",
  ].filter(Boolean).join("\n");
}

export function summariseReceipts(receipts: Receipt[], tools: string[]): ReceiptSummary {
  const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  return {
    asOf: uniq(receipts.map((r) => r.asOf)),
    filters: uniq(receipts.flatMap((r) => Object.entries(r.filters).filter(([k, v]) => v != null && k !== "sql").map(([k, v]) => `${k}: ${v}`))),
    metrics: uniq(receipts.flatMap((r) => r.metrics)),
    sources: uniq(receipts.flatMap((r) => r.sources)),
    assumptions: uniq(receipts.flatMap((r) => r.assumptions.map((x) => `${x.label}: ${x.value} (${x.tag})`))),
    warnings: uniq(receipts.flatMap((r) => r.warnings)),
    tools: uniq(tools.map((t) => TOOL_LABEL[t]?.replace(/^(Reading|Checking|Running|Looking up|Drafting) (the )?/, "") ?? t)),
  };
}

export async function runCopilot(a: RunArgs, emit: (e: CopilotEvent) => void): Promise<void> {
  const started = Date.now();
  const ctx: ToolContext = {
    db: a.db, asOf: a.asOf, calls: [], receipts: [], results: [], proposals: [],
    onToolDone: (name, ok) => emit({ type: "tool_done", tool: name, label: TOOL_LABEL[name] ?? name, ok }),
    onProposal: (item) => emit({ type: "proposal", item }),
  };
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...a.history.map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: a.question },
    { role: "system", content: turnContext(a) },
  ];
  const usage = { input: 0, output: 0, cacheRead: 0 };
  let answer = "";
  let stopReason: string | null = null;
  let error: string | null = null;

  let runner = a.client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    max_iterations: MAX_TOOL_CALLS + 2,
    output_config: { effort: EFFORT },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: makeTools(ctx),
    messages,
    // Send the whole (short) conversation each turn rather than a server-held thread:
    // the briefing is cached anyway, and the loop then behaves the same everywhere.
    thread: false,
    stream: true,
  }, { signal: a.signal });

  try {
    for (let attempt = 0; ; attempt++) {
      try {
        for await (const turn of runner) {
          let text = "";
          for await (const ev of turn) {
            if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
              const name = ev.content_block.name;
              emit({ type: "status", tool: name, label: TOOL_LABEL[name] ?? name });
            } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
              if (!text && answer) emit({ type: "reset_text" }); // text from an earlier step was not the answer
              text += ev.delta.text;
              emit({ type: "text", delta: ev.delta.text });
            }
          }
          const message = await turn.finalMessage();
          attempt = 0;
          usage.input += message.usage.input_tokens ?? 0;
          usage.output += message.usage.output_tokens ?? 0;
          usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
          stopReason = message.stop_reason;
          const hasToolUse = message.content.some((b) => b.type === "tool_use");
          if (text) answer = text;
          if (message.stop_reason === "refusal") break;
          if (message.stop_reason === "max_tokens" && hasToolUse) throw new Error("The reply was cut off mid-step");
        }
        break;
      } catch (err) {
        if (err instanceof Anthropic.APIError || a.signal?.aborted || attempt >= 1) throw err;
        runner = a.client.beta.messages.toolRunner({ ...runner.params, stream: true }, { signal: a.signal });
      }
    }
    if (stopReason === "refusal" && !answer.trim()) {
      answer = "Can't answer: this request was declined by the model's safety checks.\nNext: Ask about the campaign data instead.";
      emit({ type: "text", delta: answer });
    }
    const ungrounded = ungroundedNumbers(answer, ctx.results);
    emit({ type: "done", answer, receipt: summariseReceipts(ctx.receipts, ctx.calls.map((c) => c.name)), ungrounded, stopReason });
    await log(a, ctx, { answer, stopReason, ungrounded, error, started, usage });
  } catch (err) {
    error = describeError(err, a.signal);
    emit({ type: "error", message: error, retryable: !(err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.BadRequestError) });
    await log(a, ctx, { answer: answer || null, stopReason, ungrounded: null, error, started, usage });
  }
}

function describeError(err: unknown, signal?: AbortSignal): string {
  if (signal?.aborted) return "Stopped.";
  if (err instanceof Anthropic.RateLimitError) return "The AI service is busy right now. Try again in a minute.";
  if (err instanceof Anthropic.AuthenticationError) return "The AI key for this app is not valid, so the copilot can't answer.";
  if (err instanceof Anthropic.APIConnectionError) return "The connection dropped before the reply finished.";
  if (err instanceof Anthropic.InternalServerError) return "The AI service had an error. Try again.";
  if (err instanceof Anthropic.APIError) return `The AI service returned an error (${err.status}).`;
  return "Something went wrong while answering.";
}

async function log(
  a: RunArgs, ctx: ToolContext,
  r: { answer: string | null; stopReason: string | null; ungrounded: string[] | null; error: string | null; started: number; usage: { input: number; output: number; cacheRead: number } },
) {
  try {
    await logCopilot(a.db, {
      visitor: a.visitor, question: a.question, as_of: a.asOf, screen: a.screen, tool_calls: ctx.calls,
      answer: r.answer, stop_reason: r.stopReason, ungrounded: r.ungrounded, error: r.error, ms: Date.now() - r.started,
      input_tokens: r.usage.input, output_tokens: r.usage.output, cache_read_tokens: r.usage.cacheRead,
    });
  } catch {
    // Logging must never break an answer.
  }
}
