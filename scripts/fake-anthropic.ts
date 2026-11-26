import { createServer, type IncomingMessage, type Server } from "node:http";

/**
 * A stand-in for the Messages API that streams scripted replies, so the copilot
 * loop and panel can be tested without a key or any cost. It speaks the same
 * server-sent events the SDK reads. Never used in production.
 *
 *   npx tsx scripts/fake-anthropic.ts        # listens on :4010 with demo scripts
 *   ANTHROPIC_BASE_URL=http://localhost:4010 ANTHROPIC_API_KEY=fake npm run dev
 */

export type Block = { type: "text"; text: string } | { type: "tool_use"; name: string; input: unknown };
export interface Reply { blocks: Block[]; stop?: "end_turn" | "tool_use" | "refusal" }
export interface Recorded { headers: IncomingMessage["headers"]; body: Record<string, unknown> }

function sse(res: import("node:http").ServerResponse, reply: Reply, n: number) {
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const stop = reply.stop ?? (reply.blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn");
  send("message_start", { type: "message_start", message: { id: `msg_fake_${n}`, type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 0, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 } } });
  reply.blocks.forEach((b, i) => {
    if (b.type === "text") {
      send("content_block_start", { type: "content_block_start", index: i, content_block: { type: "text", text: "" } });
      for (const piece of b.text.match(/[\s\S]{1,24}/g) ?? []) send("content_block_delta", { type: "content_block_delta", index: i, delta: { type: "text_delta", text: piece } });
    } else {
      send("content_block_start", { type: "content_block_start", index: i, content_block: { type: "tool_use", id: `toolu_fake_${n}_${i}`, name: b.name, input: {} } });
      send("content_block_delta", { type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    }
    send("content_block_stop", { type: "content_block_stop", index: i });
  });
  send("message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 80 } });
  send("message_stop", { type: "message_stop" });
  res.end();
}

/** Starts the fake. `next` picks the reply for each request (it sees the request body). */
export async function startFake(next: (body: Record<string, unknown>, n: number) => Reply, port = 0, delayMs = 0): Promise<{ url: string; requests: Recorded[]; server: Server }> {
  const requests: Recorded[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      const body = raw ? JSON.parse(raw) : {};
      requests.push({ headers: req.headers, body });
      if (!req.url?.startsWith("/v1/messages")) { res.writeHead(404).end(); return; }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      sse(res, next(body, requests.length), requests.length);
    });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const addr = server.address();
  return { url: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : port}`, requests, server };
}

// ---------------------------------------------------------------- demo scripts for the browser

/** The last user question and whether tool results came back since. */
function lastQuestion(body: Record<string, unknown>): { q: string; afterTools: boolean } {
  const msgs = (body.messages as { role: string; content: unknown }[]) ?? [];
  let q = "", afterTools = false;
  for (const m of msgs) {
    if (m.role !== "user") continue;
    if (typeof m.content === "string") { q = m.content; afterTools = false; }
    else if (Array.isArray(m.content) && m.content.some((c: { type: string }) => c.type === "tool_result")) afterTools = true;
    else if (Array.isArray(m.content)) { q = m.content.map((c: { text?: string }) => c.text ?? "").join(" "); afterTools = false; }
  }
  return { q: q.toLowerCase(), afterTools };
}

export function demoReply(body: Record<string, unknown>): Reply {
  const { q, afterTools } = lastQuestion(body);
  if (/venue|capacity|big enough/.test(q)) {
    if (!afterTools) return { blocks: [{ type: "tool_use", name: "explain_metric", input: { name: "unanswerable" } }] };
    return { blocks: [{ type: "text", text: "Can't answer: the data has entry scans but no exit scans and no venue limit.\nNeeded: The venue's capacity and exit counts.\nNext: Shall I draft a task to get the venue's limit?" }] };
  }
  if (/draft|yes/.test(q)) {
    // Fetch the numbers first: a card's reason may only cite figures a tool returned this turn.
    const msgs = (body.messages as { role: string; content: unknown }[]) ?? [];
    const proposed = msgs.some((m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((c: { type: string; name?: string }) => c.type === "tool_use" && c.name === "propose_task"));
    if (!afterTools) return { blocks: [{ type: "tool_use", name: "compare_campaigns", input: { as_of: null, group_by: null } }, { type: "tool_use", name: "get_flags", input: { as_of: null } }] };
    if (!proposed) return { blocks: [{ type: "tool_use", name: "propose_task", input: { title: "Move Paid Social to retargeting only", campaign_id: "C02", owner: null, due_date: null, priority: "high", reason: "Paid Social: ₹93,000 for 340 verified attendees (₹274 each) against a median of 10.3 attendees per ₹1,000, as of 20 Apr 2025", metric_name: "cost_per_attendee", metric_value: 274 } }] };
    return { blocks: [{ type: "text", text: "The task card is waiting for your confirmation: move Paid Social to retargeting only, for Arjun Verma, due 27 Apr 2025." }] };
  }
  if (!afterTools) return { blocks: [{ type: "tool_use", name: "compare_campaigns", input: { as_of: null, group_by: null } }, { type: "tool_use", name: "get_flags", input: { as_of: null } }] };
  return {
    blocks: [{ type: "text", text: [
      "Cut Paid Social prospecting first; Creator Partners is next.",
      "- Paid Social: ₹93,000 spent, 340 verified attendees, ₹274 each; 58.6% of confirmed registrants came.",
      "- Creator Partners: ₹59,000, 175 attendees, ₹337 each.",
      "- The median campaign made 10.3 attendees per ₹1,000; these made 3.7 and 3.0.",
      "Measured: Costs, attendees and show rates.",
      "Judgement: That the money would do better elsewhere, since the data shows average cost, not the cost of the next attendee.",
      "Next: Shall I draft a task for Arjun Verma to move Paid Social to retargeting only?",
    ].join("\n") }],
  };
}

if (process.argv[1]?.endsWith("fake-anthropic.ts")) {
  const port = Number(process.env.FAKE_PORT || 4010);
  startFake((b) => demoReply(b), port, 600).then(({ url }) => console.log(`Fake Messages API on ${url}`));
}
