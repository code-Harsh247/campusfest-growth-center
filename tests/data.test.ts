import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DatasetError, countLiveEdits, createTask, currentSource, describeImpact, listEdits, listTasks, loadDataset,
  parseCsv, parseSnapshot, snapshotFromCsv, snapshotMetrics, undoEdit, updateRecord,
  type DatasetSnapshot, type Db,
} from "../src/foundation";
import { freshDb } from "./helpers";

let db: Db;
let supplied: DatasetSnapshot;
beforeAll(async () => {
  db = await freshDb();
  supplied = JSON.parse(readFileSync("data/attendee-dataset.json", "utf8"));
});
afterAll(async () => { await db.close(); });

describe("what moved", () => {
  it("describes a Paid Social spend edit the way the design shows it", async () => {
    const [row] = await db.query<{ activity_id: string; marketing_spend_inr: number }>(
      "select activity_id, marketing_spend_inr from working.daily_marketing where campaign_id = 'C02' order by activity_date limit 1");
    const before = await snapshotMetrics(db, "2025-04-20");
    const edit = await updateRecord(db, {
      table: "daily_marketing", id: row.activity_id, changes: { marketing_spend_inr: row.marketing_spend_inr + 10000 }, actor: "test",
    });
    const after = await snapshotMetrics(db, "2025-04-20");
    const lines = describeImpact(before, after);
    expect(lines[0]).toBe("Paid Social spend +₹10,000; cost per attendee ₹274 → ₹303; attendees per ₹1,000 3.7 → 3.3");
    expect(lines).toContain("All campaigns: spend ₹2,74,000 → ₹2,84,000");
    expect(lines).toContain("Budget left ₹26,000 → ₹16,000");
    expect(await countLiveEdits(db)).toBe(1);

    await undoEdit(db, edit.editId, "test");
    expect(describeImpact(before, await snapshotMetrics(db, "2025-04-20"))).toEqual([]);
    expect(await countLiveEdits(db)).toBe(0);
    const [undo, original] = await listEdits(db, 2);
    expect([undo.action, original.action, original.undone_by]).toEqual(["undo", "update", undo.edit_id]);
  });

  it("says nothing moved when the change is dated after the selected day", async () => {
    const before = await snapshotMetrics(db, "2025-03-01");
    const edit = await updateRecord(db, { table: "daily_marketing", id: "AD-C06-0120", changes: { clicks: 999 }, actor: "test" });
    expect(describeImpact(before, await snapshotMetrics(db, "2025-03-01"))).toEqual([]);
    await undoEdit(db, edit.editId, "test");
  });
});

describe("reset", () => {
  it("reloads the supplied data, keeps tasks unless asked, and logs it", async () => {
    await createTask(db, { title: "Keep me" }, "test");
    await updateRecord(db, { table: "targets", id: "2025-03-15 09:00:00", changes: { unique_external_visitors_goal: 2500 }, actor: "test" });
    await loadDataset(db, parseSnapshot(supplied), "test", { reset: true });
    expect((await listTasks(db, "2025-04-20")).length).toBe(1);
    expect(await countLiveEdits(db)).toBe(0);
    expect((await listEdits(db, 1))[0]).toMatchObject({ action: "reset", note: "Reset to attendee-dataset.xlsx; tasks kept" });

    await loadDataset(db, parseSnapshot(supplied), "test", { reset: true, clearTasks: true });
    expect((await listTasks(db, "2025-04-20")).length).toBe(0);
    expect(await currentSource(db)).toBe("attendee-dataset.xlsx");
  });
});

describe("uploads", () => {
  const toCsv = (columns: string[], rows: unknown[][]) =>
    [columns, ...rows].map((r) => r.map((v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(",")).join("\r\n");
  const NAMES: Record<string, string> = {
    event: "event.csv", targets: "targets.csv", campaigns: "campaigns.csv", daily_marketing: "campaign_daily.csv",
    people: "people.csv", interactions: "lead_interactions.csv", registrations: "registrations.csv",
    registration_history: "registration_history.csv", checkins: "checkins.csv",
  };
  const csvFiles = (snap: DatasetSnapshot) =>
    Object.entries(snap.tables).map(([t, v]) => ({
      name: NAMES[t],
      text: toCsv(v.columns.slice(0, -1), v.rows.map((r) => r.slice(0, -1))),
    }));

  it("parses quoted CSV fields", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });

  it("the CSV copy gives the same data and load report as the workbook", () => {
    const fromCsv = parseSnapshot(snapshotFromCsv(csvFiles(supplied), "9 CSV files"));
    const fromJson = parseSnapshot(supplied);
    expect(fromCsv.report).toEqual(fromJson.report);
    expect(fromCsv.tables).toEqual(fromJson.tables);
  });

  it("refuses a missing file, an impossible date and broken references, with reasons", () => {
    const files = csvFiles(supplied);
    expect(() => snapshotFromCsv(files.slice(1), "x")).toThrow(/Missing event\.csv/);

    const bad: DatasetSnapshot = JSON.parse(JSON.stringify(supplied));
    const ci = bad.tables.checkins;
    ci.rows[30][ci.columns.indexOf("occurred_at")] = "2025-02-30 10:00:00";
    const reg = bad.tables.registrations;
    reg.rows[5][reg.columns.indexOf("person_id")] = "NOBODY";
    let problems: string[] = [];
    try { parseSnapshot(bad); } catch (e) { problems = (e as DatasetError).problems; }
    expect(problems.join("\n")).toMatch(/2025-02-30 is not a real date/);

    bad.tables.checkins.rows[30][ci.columns.indexOf("occurred_at")] = "2025-04-12 10:00:00";
    try { parseSnapshot(bad); problems = []; } catch (e) { problems = (e as DatasetError).problems; }
    expect(problems.join("\n")).toMatch(/registrations: 1 row\(s\) point to a person_id not in people \("NOBODY"\)/);
  });
});
