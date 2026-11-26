import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QueryRefused, decideAction, listActionItems, listTasks, readonlyQuery, type Db } from "../src/foundation";
import { MAX_TOOL_CALLS, makeTools, type ToolContext } from "../src/copilot/tools";
import { freshDb } from "./helpers";

let db: Db;
beforeAll(async () => { db = await freshDb(); });
afterAll(async () => { await db.close(); });

const FINAL = "2025-04-20";
const ctxFor = (asOf = FINAL): ToolContext => ({ db, asOf, calls: [], receipts: [], results: [], proposals: [] });

/** Runs one tool by name the way the runner would, and parses its JSON result. */
async function call(name: string, input: Record<string, unknown>, ctx = ctxFor()) {
  const tool = makeTools(ctx).find((t) => t.name === name)!;
  const text = await tool.run(input as never);
  return JSON.parse(text as string);
}
type Row = Record<string, number | string | null>;
const byName = (rows: Row[], name: string) => rows.find((r) => r.campaign === name)!;
const r0 = (x: unknown) => Math.round(x as number);
const r1 = (x: unknown) => Math.round((x as number) * 1000) / 10; // a ratio as a one-decimal percentage

describe("PRD sample questions, answered by the tools (20 Apr 2025 unless stated)", () => {
  it("lowest and highest cost per verified attendee", async () => {
    const { data } = await call("compare_campaigns", { as_of: null, group_by: null });
    const ranked = (data as Row[]).filter((r) => r.campaign_id && r.cost_per_attendee != null)
      .sort((a, b) => (a.cost_per_attendee as number) - (b.cost_per_attendee as number));
    expect([ranked[0].campaign, r0(ranked[0].cost_per_attendee)]).toEqual(["Student Referrals", 69]);
    expect([ranked.at(-1)!.campaign, r0(ranked.at(-1)!.cost_per_attendee)]).toEqual(["Creator Partners", 337]);
  });

  it("Paid Social: both show-rate readings, spend, attendees, cancellations", async () => {
    const { data } = await call("compare_campaigns", { as_of: null, group_by: null });
    const ps = byName(data, "Paid Social");
    expect([r1(ps.show_rate), r1(ps.attendance_yield), ps.spend, ps.attendees, r0(ps.cost_per_attendee)]).toEqual([58.6, 50, 93000, 340, 274]);
    const mostCancelled = (data as Row[]).sort((a, b) => (b.cancelled as number) - (a.cancelled as number))[0];
    expect([mostCancelled.campaign, mostCancelled.cancelled]).toEqual(["Paid Social", 60]);
    expect(byName(data, "Organic Search").registered).toBe(250);
  });

  it("whose campaigns spent the most (grouped by owner)", async () => {
    const { data } = await call("compare_campaigns", { as_of: null, group_by: "owner" });
    expect([data[0].owner_name, data[0].spend]).toEqual(["Arjun Verma", 107000]);
    expect(data[0].campaigns.sort()).toEqual(["Organic Search", "Paid Social"]);
  });

  it("the week with the most registrations", async () => {
    const { data } = await call("get_trend", { as_of: null, grain: "weekly", from: null, to: null, campaign_id: null });
    const top = (data as Row[]).sort((a, b) => (b.registrations as number) - (a.registrations as number))[0];
    expect([top.week_start, top.week_end, top.registrations]).toEqual(["2025-03-24", "2025-03-30", 354]);
  });

  it("budget left, and the attendee target in force on 14 Mar", async () => {
    const { data } = await call("get_targets", { as_of: null });
    const budget = (data as Row[]).find((t) => t.target === "marketing_budget")!;
    expect([budget.goal, budget.actual]).toEqual([300000, 274000]);
    const early = await call("get_targets", { as_of: "2025-03-14" });
    expect((early.data as Row[]).find((t) => t.target === "verified_attendees")!.goal).toBe(1800);
  });

  it("people per day and on both days, through the read-only query", async () => {
    const perDay = await call("run_readonly_query", { sql: "select day, count(distinct person_id) as people from metrics.admissions('2025-04-20') group by day order by day" });
    expect(perDay.data.rows.map((r: Row) => r.people)).toEqual([expect.any(Number), 1345]);
    const both = await call("run_readonly_query", { sql: "select count(*) as n from (select person_id from admissions('2025-04-20') group by person_id having count(*) = 2) x" });
    expect(both.data.rows[0].n).toBe(725);
  });

  it("the CTR drop the PRD cites, as two period totals", async () => {
    const [{ campaign_id: paid }] = await db.query<{ campaign_id: string }>("select campaign_id from working.campaigns where campaign_name = 'Paid Social'");
    const { data: a } = await call("get_trend", { as_of: null, grain: "period", from: "2025-02-15", to: "2025-03-14", campaign_id: paid });
    const { data: b } = await call("get_trend", { as_of: null, grain: "period", from: "2025-03-15", to: "2025-04-12", campaign_id: paid });
    const pct2 = (x: number) => Math.round(x * 10000) / 100;
    expect([pct2(a.ctr), pct2(b.ctr)]).toEqual([2.47, 1.28]);
  });
});

describe("the 15 Mar demo thread", () => {
  it("registrations against target, and cost per registration by campaign", async () => {
    const ctx = ctxFor("2025-03-15");
    const t = await call("get_targets", { as_of: null }, ctx);
    const regs = (t.data as Row[]).find((x) => x.target === "registrations")!;
    expect([regs.actual, regs.goal, r1(regs.attainment), regs.status]).toEqual([1562, 3200, 48.8, "behind"]);
    const { data } = await call("compare_campaigns", { as_of: null, group_by: null }, ctx);
    expect(r0(byName(data, "Creator Partners").cost_per_registration)).toBe(237);
    expect(r0(byName(data, "Organic Search").cost_per_registration)).toBe(58);
    expect(r0(byName(data, "Paid Social").cost_per_registration)).toBe(122);
    expect(ctx.receipts.every((r) => r.asOf === "2025-03-15")).toBe(true);
  });
});

describe("guardrails", () => {
  it("the query tool refuses writes, other schemas, several statements and comments", async () => {
    for (const sql of [
      "delete from working.people", "select 1; select 2", "select * from app.tasks", "select * from original.people",
      "select * from pg_catalog.pg_tables", "select pg_sleep(5)", "select 1 -- hi", "with x as (delete from working.people returning 1) select * from x",
    ]) await expect(readonlyQuery(db, sql), sql).rejects.toThrow(QueryRefused);
    const big = await readonlyQuery(db, "select person_id from working.people");
    expect([big.rows.length, big.truncated]).toEqual([200, true]);
  });

  it("caps a question at eight tool calls, with an error the model can read", async () => {
    const ctx = ctxFor();
    for (let i = 0; i < MAX_TOOL_CALLS; i++) await call("explain_metric", { name: "show_rate" }, ctx);
    await expect(call("explain_metric", { name: "show_rate" }, ctx)).rejects.toThrow(/limit of 8 tool calls/);
  });

  it("a bad date comes back as a readable error, not an empty success", async () => {
    await expect(call("get_funnel", { as_of: "2026-01-01", campaign_id: null })).rejects.toThrow(/outside it/);
  });
});

describe("from proposal to task", () => {
  it("propose_task saves a proposal, never a task; only the click creates one", async () => {
    const ctx = ctxFor("2025-03-15");
    const before = (await listTasks(db, FINAL)).length;
    const r = await call("propose_task", {
      title: "Move Creator Partners to pay per verified attendee", campaign_id: "Creator Partners", owner: null, due_date: null,
      priority: "high", reason: "₹237 per registration against ₹58 for Organic Search (15 Mar 2025)",
      metric_name: "cost_per_registration", metric_value: 237,
    }, ctx);
    expect(r.data).toMatchObject({ owner: "Nisha Rao", due_date: "2025-03-22", campaign: "Creator Partners" });
    expect(r.note).toMatch(/Nothing is saved until/);
    expect((await listTasks(db, FINAL)).length).toBe(before);
    expect(ctx.proposals).toHaveLength(1);

    const { task, item } = await decideAction(db, r.data.proposal_id, { accept: true }, "test");
    expect([task!.source, task!.owner_name, task!.due_date, item.status, item.task_id]).toEqual(["chatbot", "Nisha Rao", "2025-03-22", "accepted", task!.task_id]);
    await expect(decideAction(db, r.data.proposal_id, { accept: false }, "test")).rejects.toThrow(/already accepted/);

    const r2 = await call("propose_task", { title: "Pause Paid Social", campaign_id: "C06", owner: null, due_date: null, priority: null, reason: "₹274 per attendee", metric_name: null, metric_value: null });
    const d = await decideAction(db, r2.data.proposal_id, { accept: false, reason: "Not now" }, "test");
    expect([d.task, d.item.status, d.item.dismiss_reason]).toEqual([null, "dismissed", "Not now"]);
    expect((await listActionItems(db, "proposed")).length).toBe(0);
  });
});
