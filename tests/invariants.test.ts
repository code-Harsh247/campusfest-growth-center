/**
 * Behaviour the evaluators may probe: totals that add up, no leakage of later
 * outcomes into earlier dates, edits that move only what they should, undo,
 * reset, and refusals for bad input.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EditError, TABLES, deleteRecord, getCampaignTable, getFlags, getFunnel, getProjection,
  getTargetStatus, getWeekly, insertRecord, loadDataset, resetWorkingCopy,
  undoEdit, updateRecord, type Db,
} from "../src/foundation";
import { parseWorkbook } from "../src/foundation/workbook";
import { WORKBOOK, freshDb, round } from "./helpers";

let db: Db;
beforeAll(async () => { db = await freshDb(); });
afterAll(async () => { await db.close(); });

const DATES = ["2025-02-01", "2025-03-15", "2025-04-12", "2025-04-20"];

describe("totals add up", () => {
  it.each(DATES)("campaign rows plus Unattributed equal the totals on %s", async (d) => {
    const { data: f } = await getFunnel(db, d);
    const { data: rows } = await getCampaignTable(db, d);
    const sum = (k: "identified" | "registered" | "confirmed" | "attendees") => rows.reduce((s, r) => s + r[k], 0);
    expect([sum("identified"), sum("registered"), sum("confirmed"), sum("attendees")])
      .toEqual([f.identified, f.registered, f.confirmed, f.attendees]);
    expect(rows.reduce((s, r) => s + (r.spend ?? 0), 0)).toBe(f.spend);
    expect(f.attendees).toBeLessThanOrEqual(f.identified);
    expect(f.registered).toBeLessThanOrEqual(f.identified);
  });
});

describe("loading", () => {
  it("loading the same file twice gives the same numbers", async () => {
    const before = (await getFunnel(db, "2025-04-20")).data;
    await loadDataset(db, await parseWorkbook(WORKBOOK, "reload"));
    expect((await getFunnel(db, "2025-04-20")).data).toEqual(before);
  });
});

describe("no leakage", () => {
  it("deleting every row after 15 Mar leaves the 15 Mar results unchanged", async () => {
    const d = "2025-03-15";
    const snapshot = async () => ({
      funnel: (await getFunnel(db, d)).data,
      campaigns: (await getCampaignTable(db, d)).data,
      targets: (await getTargetStatus(db, d)).data,
      flags: (await getFlags(db, d)).data,
      weekly: (await getWeekly(db, d)).data,
      projection: (await getProjection(db, d)).data,
    });
    const before = await snapshot();
    let deleted = 0;
    for (const t of TABLES) {
      if (!t.timeColumn || t.table === "event") continue;
      const col = t.columns.find((c) => c.name === t.timeColumn)!;
      const cond = col.type === "date" ? `${t.timeColumn} > $1::date` : `${t.timeColumn} >= ($1::date + 1)::timestamp`;
      const gone = await db.query(`delete from working.${t.table} where ${cond} returning 1`, [d]);
      deleted += gone.length;
    }
    expect(deleted).toBeGreaterThan(10000); // the test must remove real later data to mean anything
    expect(await snapshot()).toEqual(before);
    await resetWorkingCopy(db, "test");
  });
});

describe("edits", () => {
  it("adding Rs 10,000 to one Paid Social day moves only Paid Social and the totals", async () => {
    const before = (await getCampaignTable(db, "2025-04-20")).data;
    const [row] = await db.query<{ activity_id: string; marketing_spend_inr: number }>(
      "select activity_id, marketing_spend_inr from working.daily_marketing where campaign_id = 'C02' order by activity_date limit 1",
    );
    const edit = await updateRecord(db, {
      table: "daily_marketing", id: row.activity_id,
      changes: { marketing_spend_inr: row.marketing_spend_inr + 10000 }, actor: "test",
    });
    const after = (await getCampaignTable(db, "2025-04-20")).data;
    expect(round(after.find((r) => r.campaign_id === "C02")!.cost_per_attendee)).toBe(303);
    for (const r of after.filter((x) => x.campaign_id !== "C02")) {
      expect(r).toEqual(before.find((b) => b.campaign_id === r.campaign_id));
    }
    expect((await getFunnel(db, "2025-04-20")).data.spend).toBe(284000);
    const budget = (await getTargetStatus(db, "2025-04-20")).data.find((t) => t.target === "marketing_budget")!;
    expect(budget.goal - budget.actual).toBe(16000);

    await undoEdit(db, edit.editId, "test");
    expect((await getCampaignTable(db, "2025-04-20")).data).toEqual(before);
    await expect(undoEdit(db, edit.editId, "test")).rejects.toThrow(/already undone/);
  });

  it("raising the attendee target changes attainment", async () => {
    await updateRecord(db, {
      table: "targets", id: "2025-03-15 09:00:00", changes: { unique_external_visitors_goal: 2500 }, actor: "test",
    });
    const t = (await getTargetStatus(db, "2025-04-20")).data.find((x) => x.target === "verified_attendees")!;
    expect(round(t.attainment, 3)).toBe(0.82);
    await resetWorkingCopy(db, "test");
  });

  it("a new campaign flows through every view", async () => {
    await insertRecord(db, {
      table: "campaigns",
      values: { campaign_id: "C08", campaign_name: "Campus Radio", channel: "radio", created_at: "2025-04-01 09:00", owner_id: "T04", owner_name: "Arjun Verma" },
      actor: "test",
    });
    await insertRecord(db, {
      table: "daily_marketing",
      values: {
        activity_id: "AD-C08-0402", campaign_id: "C08", activity_date: "2025-04-02", impressions: 1000, clicks: 30,
        reported_reach: 600, landing_page_sessions: 20, registration_starts: 5, marketing_spend_inr: 5000,
      },
      actor: "test",
    });
    const rows = (await getCampaignTable(db, "2025-04-20")).data;
    expect(rows.find((r) => r.campaign_id === "C08")).toMatchObject({ campaign_name: "Campus Radio", spend: 5000, attendees: 0 });
    expect((await getFunnel(db, "2025-04-20")).data.spend).toBe(279000);
    expect((await getFlags(db, "2025-04-20")).data.find((r) => r.campaign_id === "C08")!.flag).toBe("change");
    await resetWorkingCopy(db, "test");
  });

  it("cancelling a confirmed registration lowers confirmed but not attendance", async () => {
    const [reg] = await db.query<{ registration_id: string; person_id: string }>(
      "select registration_id, person_id from metrics.reg_state('2025-04-20') where status = 'confirmed' order by registration_id limit 1",
    );
    await insertRecord(db, {
      table: "registration_history",
      values: {
        history_id: "RH-TEST-1", registration_id: reg.registration_id, person_id: reg.person_id,
        effective_at: "2025-04-11 18:00", status: "cancelled",
      },
      actor: "test",
    });
    const f = (await getFunnel(db, "2025-04-20")).data;
    expect([f.confirmed, f.cancelled, f.attendees]).toEqual([2499, 184, 2050]);
    await resetWorkingCopy(db, "test");
  });

  it("reset restores every reference value", async () => {
    await updateRecord(db, { table: "daily_marketing", id: "AD-C06-0120", changes: { marketing_spend_inr: 999999 }, actor: "test" });
    await resetWorkingCopy(db, "test");
    expect((await getFunnel(db, "2025-04-20")).data).toMatchObject({
      identified: 3625, registered: 2800, confirmed: 2500, attendees: 2050, spend: 274000,
    });
    const [last] = await db.query<{ action: string }>("select action from app.edit_log order by edit_id desc limit 1");
    expect(last.action).toBe("reset");
  });
});

describe("refusals", () => {
  it("refuses bad values with a reason", async () => {
    await expect(updateRecord(db, { table: "registration_history", id: "RH000001", changes: { status: "maybe" }, actor: "test" }))
      .rejects.toThrow(/status must be one of/);
    await expect(updateRecord(db, { table: "daily_marketing", id: "AD-C06-0120", changes: { activity_date: "2026-01-01" }, actor: "test" }))
      .rejects.toThrow(/outside the data window/);
    await expect(updateRecord(db, { table: "daily_marketing", id: "AD-C06-0120", changes: { clicks: 2.5 }, actor: "test" }))
      .rejects.toThrow(/whole number/);
    await expect(insertRecord(db, {
      table: "registrations",
      values: { registration_id: "R9999", person_id: "NOBODY", registered_at: "2025-03-01 10:00" },
      actor: "test",
    })).rejects.toThrow(/does not exist in people/);
    await expect(deleteRecord(db, { table: "people", id: "E0001", actor: "test" })).rejects.toThrow(/still point to/);
    await expect(updateRecord(db, { table: "people", id: "E0001", changes: { person_id: "E9999" }, actor: "test" }))
      .rejects.toBeInstanceOf(EditError);
    expect((await getFunnel(db, "2025-04-20")).data.spend).toBe(274000);
  });
});
