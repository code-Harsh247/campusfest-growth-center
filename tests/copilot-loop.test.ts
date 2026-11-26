import Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listActionItems, listTasks, type Db } from "../src/foundation";
import { runCopilot, type CopilotEvent } from "../src/copilot/run";
import { offersTask, parseAnswer } from "../src/lib/answer";
import { numbersIn, ungroundedNumbers } from "../src/lib/grounding";
import { demoReply, startFake, type Recorded } from "../scripts/fake-anthropic";
import { freshDb } from "./helpers";

let db: Db;
let fake: Awaited<ReturnType<typeof startFake>>;
let client: Anthropic;
beforeAll(async () => {
  db = await freshDb();
  fake = await startFake((body) => demoReply(body));
  client = new Anthropic({ apiKey: "fake-key-for-tests", baseURL: fake.url, maxRetries: 0 });
});
afterAll(async () => { fake.server.close(); await db.close(); });

async function ask(question: string, history: { role: "user" | "assistant"; content: string }[] = []) {
  const events: CopilotEvent[] = [];
  const from = fake.requests.length;
  await runCopilot({ client, db, history, question, asOf: "2025-04-20", screen: "/campaigns", visitor: "test" }, (e) => events.push(e));
  return { events, requests: fake.requests.slice(from) as Recorded[] };
}

describe("the copilot loop, against a scripted Messages API", () => {
  it("calls tools, streams the answer, and every number in it traces to a tool result", async () => {
    const { events, requests } = await ask("Which campaign should we cut?");
    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === "status")).toHaveLength(2);
    expect(events.filter((e) => e.type === "tool_done").every((e) => e.type === "tool_done" && e.ok)).toBe(true);
    const done = events.find((e) => e.type === "done");
    expect(done && done.type === "done" && done.ungrounded).toEqual([]);
    expect(done && done.type === "done" && done.answer).toMatch(/^Cut Paid Social/);
    expect(done && done.type === "done" && done.receipt.asOf).toEqual(["2025-04-20"]);

    // What we sent: the model, effort, cached briefing, fallback, strict tools, and the date in a system message.
    const first = requests[0];
    expect(first.body).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "medium" }, fallbacks: "default" });
    expect(String(first.headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
    expect((first.body.system as { cache_control?: unknown }[])[0].cache_control).toEqual({ type: "ephemeral" });
    const msgs = first.body.messages as { role: string; content: unknown }[];
    expect(msgs.at(-1)).toMatchObject({ role: "system" });
    expect(String(msgs.at(-1)!.content)).toContain("Date on screen: 2025-04-20");
    const tools = first.body.tools as { name: string; strict?: boolean }[];
    expect(tools.map((t) => t.name)).toContain("propose_task");
    expect(tools.every((t) => t.strict === true)).toBe(true);
    expect(first.body).not.toHaveProperty("thinking"); // always on for this model; effort is the control
    expect(first.body).not.toHaveProperty("thread"); // the full conversation goes each turn

    // The second request carries both tool results back.
    const results = (requests[1].body.messages as { role: string; content: { type: string }[] | string }[])
      .flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((c) => c.type === "tool_result");
    expect(results).toHaveLength(2);

    const [log] = await db.query<{ question: string; tool_calls: unknown[]; ungrounded: unknown; cache_read_tokens: number }>(
      "select question, tool_calls, ungrounded, cache_read_tokens from app.copilot_log order by log_id desc limit 1");
    expect(log.question).toBe("Which campaign should we cut?");
    expect(log.tool_calls).toHaveLength(2);
    expect(log.cache_read_tokens).toBe(2000);
  });

  it("a follow-up drafts a card; no task exists until someone clicks", async () => {
    const before = (await listTasks(db, "2025-04-20")).length;
    const { events, requests } = await ask("Yes, draft that task.", [
      { role: "user", content: "Which campaign should we cut?" }, { role: "assistant", content: "Cut Paid Social prospecting first." },
    ]);
    const card = events.find((e) => e.type === "proposal");
    expect(card && card.type === "proposal" && card.item).toMatchObject({ owner_name: "Arjun Verma", due_date: "2025-04-27", status: "proposed" });
    expect((await listTasks(db, "2025-04-20")).length).toBe(before);
    expect((await listActionItems(db, "proposed")).length).toBe(1);
    const sent = requests[0].body.messages as { role: string }[];
    expect(sent.map((m) => m.role)).toEqual(["user", "assistant", "user", "system"]);
  });

  it("an unanswerable question gets the can't-answer shape", async () => {
    const { events } = await ask("Is the venue big enough for 3,200?");
    const done = events.find((e) => e.type === "done");
    const p = parseAnswer(done && done.type === "done" ? done.answer : "");
    expect(p.kind).toBe("cannot");
    expect(p.needed).toMatch(/capacity/);
  });

  it("an API failure becomes a plain error event, and the log keeps it", async () => {
    const broken = new Anthropic({ apiKey: "x", baseURL: "http://127.0.0.1:9", maxRetries: 0 });
    const events: CopilotEvent[] = [];
    await runCopilot({ client: broken, db, history: [], question: "Anything?", asOf: "2025-04-20", screen: "/", visitor: "t" }, (e) => events.push(e));
    expect(events.at(-1)).toMatchObject({ type: "error", retryable: true });
    const [log] = await db.query<{ error: string }>("select error from app.copilot_log order by log_id desc limit 1");
    expect(log.error).toMatch(/connection/);
  });
});

describe("reading answers", () => {
  it("parses the five-part answer, half-written or whole", () => {
    const text = demoReply({ messages: [{ role: "user", content: "cut?" }, { role: "user", content: [{ type: "tool_result" }] }] }).blocks[0];
    const p = parseAnswer((text as { text: string }).text);
    expect(p.kind).toBe("answer");
    expect(p.headline).toBe("Cut Paid Social prospecting first; Creator Partners is next.");
    expect(p.bullets).toHaveLength(3);
    expect([p.measured, p.judgement?.slice(0, 10)]).toEqual(["Costs, attendees and show rates.", "That the m"]);
    expect(offersTask(p.next)).toBe(true);
    expect(parseAnswer("Cut Paid Social pro").headline).toBe("Cut Paid Social pro");
    expect(offersTask("Next: check the Plan screen.")).toBe(false);
  });

  it("the grounding check skips dates and IDs and catches a number from nowhere", () => {
    expect(numbersIn("As of 20 Apr 2025, C02 spent ₹93,000 over 7 days; 58.6% came; week 24–30 Mar").map((n) => n.text)).toEqual(["₹93,000".slice(1), "58.6%"]);
    const results = [JSON.stringify({ data: [{ spend: 93000, show_rate: 0.5862, cost_per_attendee: 273.53 }] })];
    expect(ungroundedNumbers("Paid Social: ₹93,000, ₹274 each, 58.6% came.", results)).toEqual([]);
    expect(ungroundedNumbers("Paid Social: ₹93,000 and 412 attendees.", results)).toEqual(["412"]);
  });
});

describe("rate limits", async () => {
  const { take } = await import("../src/server/ratelimit");
  it("allows 20 questions an hour per visitor, then says how long to wait", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 20; i++) expect(take("visitor-a", t0 + i).ok).toBe(true);
    const blocked = take("visitor-a", t0 + 100);
    expect(blocked).toMatchObject({ ok: false });
    expect(!blocked.ok && blocked.retryAfter).toBe(3600);
    expect(take("visitor-b", t0 + 100).ok).toBe(true);
    expect(take("visitor-a", t0 + 3600_000).ok).toBe(true);
  });
});
