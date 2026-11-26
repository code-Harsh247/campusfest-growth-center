import { checkAsOf, dataVersion, listTeam, AsOfError } from "@/foundation";
import { copilotEnabled, runCopilot, type ChatTurn, type CopilotEvent } from "@/copilot/run";
import { makeClient } from "@/copilot/provider";
import { getDb } from "@/server/db";
import { take, visitorId } from "@/server/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** What the panel needs before the first question: whether chat is on, and the pickers for task cards. */
export async function GET() {
  const db = await getDb();
  const campaigns = await db.query<{ campaign_id: string; campaign_name: string; owner_id: string | null }>(
    "select campaign_id, campaign_name, owner_id from working.campaigns order by campaign_name",
  );
  return Response.json({ enabled: copilotEnabled(), dataVersion: await dataVersion(db), team: await listTeam(db), campaigns });
}

function cleanHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns = raw
    .filter((t): t is ChatTurn => !!t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim() !== "")
    .map((t) => ({ role: t.role, content: t.content.slice(0, 4000) }))
    .slice(-12);
  while (turns.length && turns[0].role !== "user") turns.shift();
  // Keep strict user/assistant alternation; drop a dangling question that never got an answer.
  const out: ChatTurn[] = [];
  for (const t of turns) if (!out.length || out[out.length - 1].role !== t.role) out.push(t);
  if (out.length && out[out.length - 1].role === "user") out.pop();
  return out;
}

export async function POST(req: Request) {
  if (!copilotEnabled()) return Response.json({ error: "off" }, { status: 503 });
  let body: { question?: unknown; history?: unknown; asOf?: unknown; screen?: unknown; focus?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "Send JSON" }, { status: 400 }); }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question || question.length > 1000) return Response.json({ error: "Ask a question of up to 1,000 characters" }, { status: 400 });
  const db = await getDb();
  const asOf = typeof body.asOf === "string" ? body.asOf : "";
  try { await checkAsOf(db, asOf); } catch (e) {
    if (e instanceof AsOfError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
  const visitor = visitorId(req.headers);
  const allowed = take(visitor);
  if (!allowed.ok) return Response.json({ error: "rate", retryAfter: allowed.retryAfter }, { status: 429, headers: { "Retry-After": String(allowed.retryAfter) } });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: CopilotEvent) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { /* the reader left */ }
      };
      await runCopilot({
        client: makeClient(), db, history: cleanHistory(body.history), question, asOf,
        screen: typeof body.screen === "string" ? body.screen.slice(0, 40) : "/",
        focus: typeof body.focus === "string" ? body.focus.slice(0, 300) : null,
        visitor, signal: req.signal,
      }, emit);
      try { controller.close(); } catch { /* already closed */ }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}
