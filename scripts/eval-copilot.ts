/**
 * The copilot's test set, run against the real model. Each run costs money
 * (well under a cent a question on Haiku 5.5; about 8 cents on Opus 5.5), so it is never part of `npm test`.
 *
 *   OPENROUTER_API_KEY=... npm run eval:copilot -- --only=3,7   (or ANTHROPIC_API_KEY)
 *
 * Expected answers come from the PRD, which took them from the independent
 * pandas check, not from this app. A question passes when every expected
 * figure appears, nothing forbidden appears, every number traces to a tool
 * result (the grounding check), and the shape is right (a refusal for
 * unanswerable questions, a card and no new task for execution questions).
 * Pass bar: 95% overall, 100% on refusal and execution questions.
 */
import { copilotSettings, makeClient, providerName } from "../src/copilot/provider";
import { listTasks, loadDataset, migrate, openPglite, parseSnapshot, updateRecord, type Db } from "../src/foundation";
import { runCopilot, type ChatTurn, type CopilotEvent } from "../src/copilot/run";
import { parseAnswer } from "../src/lib/answer";
import { readFileSync } from "node:fs";

interface Case {
  q: string;
  asOf?: string;
  kind: "lookup" | "ranking" | "past" | "followup" | "refusal" | "execution" | "changed";
  expect?: (string | RegExp)[];
  forbid?: RegExp[];
  history?: ChatTurn[];
  before?: (db: Db) => Promise<void>;
}

const CASES: Case[] = [
  { kind: "ranking", q: "Which campaign had the lowest cost per verified attendee?", expect: ["Student Referrals", "₹69"] },
  { kind: "followup", q: "And the highest?", history: [{ role: "user", content: "Which campaign had the lowest cost per verified attendee?" }, { role: "assistant", content: "Student Referrals, at ₹69 per verified attendee." }], expect: ["Creator Partners", "₹337"] },
  { kind: "lookup", q: "How many people attended on day two?", expect: ["1,345"] },
  { kind: "lookup", q: "How many people came on both days?", expect: ["725"] },
  { kind: "lookup", q: "What was Paid Social's show rate?", expect: ["58.6%", "50.0%"] },
  { kind: "lookup", q: "How many registrations did Organic Search get?", expect: ["250"] },
  { kind: "ranking", q: "Whose campaigns spent the most?", expect: ["Arjun Verma", "₹1,07,000"] },
  { kind: "ranking", q: "Which week had the most registrations?", expect: [/24.{0,3}30 Mar/, "354"] },
  { kind: "lookup", q: "How much budget is left?", expect: ["₹26,000", "₹3,00,000"] },
  { kind: "past", q: "What was the attendee target?", asOf: "2025-03-14", expect: ["1,800"] },
  { kind: "ranking", q: "Which campaign had the most cancellations?", expect: ["Paid Social", "60"] },
  { kind: "refusal", q: "What share of attendees were women?" },
  { kind: "refusal", q: "Which sponsor drove the most attendees?" },
  { kind: "refusal", q: "Is the venue big enough for 3,200?", asOf: "2025-03-15" },
  { kind: "refusal", q: "How many people came in 2026?" },
  { kind: "past", q: "Are we on track for registrations?", asOf: "2025-03-15", expect: ["1,562", "3,200", "48.8%"] },
  { kind: "past", q: "Which campaign is dragging on cost per registration?", asOf: "2025-03-15", expect: ["Creator Partners", "₹237"] },
  { kind: "followup", q: "And Paid Social?", asOf: "2025-03-15", history: [{ role: "user", content: "Which campaign is dragging on cost per registration?" }, { role: "assistant", content: "Creator Partners, at ₹237 per registration so far." }], expect: ["₹122"] },
  { kind: "execution", q: "Create a task to pause Paid Social" },
  { kind: "execution", q: "Draft a task to move Creator Partners to pay per verified attendee.", asOf: "2025-03-15", expect: ["Nisha Rao"] },
  {
    kind: "changed", q: "What's Paid Social's cost per attendee now?", expect: ["₹303"], forbid: [/₹274(?!.*₹303)/],
    before: async (db) => {
      const [row] = await db.query<{ activity_id: string; marketing_spend_inr: number }>(
        "select activity_id, marketing_spend_inr from working.daily_marketing d join working.campaigns c using (campaign_id) where c.campaign_name = 'Paid Social' order by activity_date limit 1");
      await updateRecord(db, { table: "daily_marketing", id: row.activity_id, changes: { marketing_spend_inr: row.marketing_spend_inr + 10000 }, actor: "eval" });
    },
  },
];

async function freshDb(): Promise<Db> {
  const db = await openPglite();
  await migrate(db);
  await loadDataset(db, parseSnapshot(JSON.parse(readFileSync("data/attendee-dataset.json", "utf8"))));
  return db;
}

async function main() {
  if (!providerName()) throw new Error("Set OPENROUTER_API_KEY or ANTHROPIC_API_KEY to run the eval (it costs money).");
  console.log(`Model: ${copilotSettings().model} via ${providerName()}, effort ${copilotSettings().effort}`);
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",").map(Number);
  const client = makeClient();
  const rows: { n: number; kind: string; pass: boolean; why: string[] }[] = [];
  for (const [i, c] of CASES.entries()) {
    if (only && !only.includes(i + 1)) continue;
    const db = await freshDb();
    await c.before?.(db);
    const tasksBefore = (await listTasks(db, "2025-04-20")).length;
    const events: CopilotEvent[] = [];
    await runCopilot({ client, db, history: c.history ?? [], question: c.q, asOf: c.asOf ?? "2025-04-20", screen: "/", visitor: "eval" }, (e) => events.push(e));
    const done = events.find((e) => e.type === "done");
    const answer = done?.type === "done" ? done.answer : "";
    const why: string[] = [];
    if (!done) why.push(`no answer (${JSON.stringify(events.find((e) => e.type === "error"))})`);
    for (const x of c.expect ?? []) if (!(typeof x === "string" ? answer.includes(x) : x.test(answer))) why.push(`missing ${x}`);
    for (const x of c.forbid ?? []) if (x.test(answer)) why.push(`has ${x}`);
    if (done?.type === "done" && done.ungrounded.length) why.push(`ungrounded: ${done.ungrounded.join(", ")}`);
    if (c.kind === "refusal" && parseAnswer(answer).kind !== "cannot") why.push("not a refusal");
    if (c.kind === "execution") {
      if (!events.some((e) => e.type === "proposal")) why.push("no task card");
      if ((await listTasks(db, "2025-04-20")).length !== tasksBefore) why.push("a task was created without a click");
    }
    rows.push({ n: i + 1, kind: c.kind, pass: why.length === 0, why });
    console.log(`${why.length ? "FAIL" : "pass"} ${i + 1}. ${c.q}${why.length ? `\n     ${why.join("; ")}\n     ${answer.replace(/\n/g, " | ").slice(0, 300)}` : ""}`);
    await db.close();
  }
  const passed = rows.filter((r) => r.pass).length;
  const strict = rows.filter((r) => r.kind === "refusal" || r.kind === "execution");
  console.log(`\n${passed}/${rows.length} passed (${Math.round((passed / rows.length) * 100)}%); refusal and execution ${strict.filter((r) => r.pass).length}/${strict.length}`);
  process.exitCode = passed / rows.length >= 0.95 && strict.every((r) => r.pass) ? 0 : 1;
}

main();
