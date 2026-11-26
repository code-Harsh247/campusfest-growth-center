import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EditError, createFlagTask, describeImpact, getFlags, getSimulatorInputs, listAssumptions, listEdits, listTasks,
  loadDataset, openFlagTasks, parseSnapshot, savePlan, simulate, snapshotMetrics, undoEdit, updateAssumption,
  type Db,
} from "../src/foundation";
import { freshDb } from "./helpers";

let db: Db;
beforeAll(async () => { db = await freshDb(); });
afterAll(async () => { await db.close(); });

const FINAL = "2025-04-20";
const id = async (name: string) =>
  (await db.query<{ campaign_id: string }>("select campaign_id from working.campaigns where campaign_name = $1", [name]))[0].campaign_id;

describe("budget simulator", () => {
  it("keeps every number unchanged when the plan equals spend", async () => {
    const inputs = (await getSimulatorInputs(db, FINAL)).data;
    const r = simulate(inputs, {});
    expect(r.planned).toBe(274000);
    expect(r.spent).toBe(274000);
    expect(r.baseAttendees).toBe(2050); // every verified attendee, walk-ins included
    expect(r.attendees).toBeCloseTo(2050, 6);
    expect([r.attendeesLow, r.attendeesHigh].map((x) => Math.round(x))).toEqual([2050, 2050]);
    expect(Math.round(r.baseCostPerAttendee!)).toBe(134);
    expect(inputs.budget).toBe(300000);
    expect(inputs.campaigns).toHaveLength(7);
  });

  it("matches the design's example: ₹20,000 from Paid Social to Student Referrals", async () => {
    const inputs = (await getSimulatorInputs(db, FINAL)).data;
    const [ref, paid] = [await id("Student Referrals"), await id("Paid Social")];
    const spent = Object.fromEntries(inputs.campaigns.map((c) => [c.campaign_id, c.spent]));
    const r = simulate(inputs, { [ref]: spent[ref] + 20000, [paid]: spent[paid] - 20000 });
    expect(Math.round(r.attendees - r.baseAttendees)).toBe(127);
    expect(Math.round(r.attendeesLow - r.baseAttendees)).toBe(80);
    expect(Math.round(r.attendeesHigh - r.baseAttendees)).toBe(184); // the design mock said 183 (183.7, truncated)
    expect(Math.round(r.costPerAttendee!)).toBe(126);
    expect([r.costPerAttendeeLow, r.costPerAttendeeHigh].map((x) => Math.round(x!))).toEqual([123, 129]);
    expect(r.bendLow).toBe(0.5);
    expect(r.bendHigh).toBe(0.9);
  });

  it("follows the curve: doubling a budget gives 2^b times the attendees, zero gives none", () => {
    const input = {
      campaigns: [{ campaign_id: "X", campaign_name: "X", owner_id: null, owner_name: null, spent: 10000, attendees: 100 }],
      otherAttendees: 5, bend: 0.7,
    };
    const doubled = simulate(input, { X: 20000 });
    expect(doubled.rows[0].attendees).toBeCloseTo(100 * 2 ** 0.7, 9);
    expect(doubled.rows[0].attendeesLow).toBeCloseTo(100 * 2 ** 0.5, 9);
    expect(doubled.rows[0].attendeesHigh).toBeCloseTo(100 * 2 ** 0.9, 9);
    expect(doubled.rows[0].stretched).toBe(false);
    expect(simulate(input, { X: 25000 }).rows[0].stretched).toBe(true);
    const zero = simulate(input, { X: 0 });
    expect(zero.attendees).toBe(5);
    expect(zero.costPerAttendee).toBe(0);
  });

  it("before the event, uses confirmed registrations times the show-rate benchmark", async () => {
    const { data, receipt } = await getSimulatorInputs(db, "2025-03-15");
    expect(data.postEvent).toBe(false);
    expect(data.basis).toBe("confirmed x show-rate benchmark");
    expect(receipt.assumptions.map((a) => a.key)).toContain("show_rate_benchmark");
    const flags = (await getFlags(db, "2025-03-15")).data;
    for (const c of data.campaigns) {
      expect(c.attendees).toBeCloseTo(flags.find((f) => f.campaign_id === c.campaign_id)!.expected_attendees!, 9);
    }
  });
});

describe("saving a plan", () => {
  it("refuses a plan over budget, a negative amount and an unknown campaign", async () => {
    const paid = await id("Paid Social");
    await expect(savePlan(db, { asOf: FINAL, planned: { [paid]: 200000 }, actor: "test" })).rejects.toThrow(/over the ₹3,00,000 budget/);
    await expect(savePlan(db, { asOf: FINAL, planned: { [paid]: -5 }, actor: "test" })).rejects.toThrow(EditError);
    await expect(savePlan(db, { asOf: FINAL, planned: { NOPE: 5 }, actor: "test" })).rejects.toThrow(/NOPE/);
  });

  it("saves planned budgets, creates owner tasks, and undoes cleanly", async () => {
    const [ref, paid] = [await id("Student Referrals"), await id("Paid Social")];
    const inputs = (await getSimulatorInputs(db, FINAL)).data;
    const spent = Object.fromEntries(inputs.campaigns.map((c) => [c.campaign_id, c.spent]));
    const tasksBefore = (await listTasks(db, FINAL)).length;

    const saved = await savePlan(db, {
      asOf: FINAL, planned: { [ref]: spent[ref] + 20000, [paid]: spent[paid] - 20000 }, actor: "test", createTasks: true,
    });
    expect(saved.changed.map((c) => c.campaign_name).sort()).toEqual(["Paid Social", "Student Referrals"]);
    expect(saved.tasks).toHaveLength(2);
    const cut = saved.tasks.find((t) => t.campaign_id === paid)!;
    expect(cut.title).toBe("Cut Paid Social budget to ₹73,000 (−₹20,000)");
    expect(cut.owner_name).toBe("Arjun Verma");
    expect(cut.source).toBe("plan");
    expect(cut.due_date).toBe("2025-04-27");
    expect((await listTasks(db, FINAL)).length).toBe(tasksBefore + 2);

    const after = (await getSimulatorInputs(db, FINAL)).data.plan;
    expect(after).toHaveLength(7);
    expect(after.find((p) => p.campaign_id === ref)!.planned_inr).toBe(spent[ref] + 20000);
    expect((await listEdits(db, 3)).find((e) => e.edit_id === saved.editId)!.note).toMatch(/^Plan saved: .*Paid Social −₹20,000/);

    await undoEdit(db, saved.editId, "test");
    expect((await getSimulatorInputs(db, FINAL)).data.plan).toEqual([]);
  });
});

describe("flags to tasks", () => {
  it("creates one task per flagged campaign, owned by its owner, and refuses a duplicate", async () => {
    const paid = await id("Paid Social");
    const task = await createFlagTask(db, { campaignId: paid, asOf: FINAL, actor: "test" });
    expect(task.title).toBe("Stop Paid Social: 3.7 attendees per ₹1,000");
    expect(task.owner_name).toBe("Arjun Verma");
    expect(task.priority).toBe("high");
    expect(task.source).toBe("flag");
    expect((await openFlagTasks(db)).get(paid)).toBe(task.task_id);
    await expect(createFlagTask(db, { campaignId: paid, asOf: FINAL, actor: "test" })).rejects.toThrow(/already has an open flag task/);
  });
});

describe("assumptions", () => {
  it("validates values, including rules that tie two assumptions together", async () => {
    await expect(updateAssumption(db, { key: "show_rate_benchmark", value: "1.4", actor: "test" })).rejects.toThrow(/at most 1/);
    await expect(updateAssumption(db, { key: "flag_min_days", value: "3.5", actor: "test" })).rejects.toThrow(/whole number/);
    await expect(updateAssumption(db, { key: "pace_at_risk", value: "0.99", actor: "test" })).rejects.toThrow(/at-risk line/);
    await expect(updateAssumption(db, { key: "registration_close_date", value: "2025-02-30", actor: "test" })).rejects.toThrow(/not a real date/);
    await expect(updateAssumption(db, { key: "simulator_bend", value: "0.7", actor: "test" })).rejects.toThrow(/Nothing changed/);
    await expect(updateAssumption(db, { key: "flag_band", value: "0.3", basis: " ", actor: "test" })).rejects.toThrow(/based on/);
  });

  it("re-runs the flags when the band changes, says what moved, and undoes", async () => {
    const before = await snapshotMetrics(db, FINAL);
    const editId = await updateAssumption(db, { key: "flag_band", value: "0.4", basis: "Testing a wider band", actor: "test" });
    const after = await snapshotMetrics(db, FINAL);
    // Organic Search (+35%) is inside a ±40% band; Student Referrals (+41%) is still above it.
    const flags = (await getFlags(db, FINAL)).data;
    expect(flags.find((f) => f.campaign_name === "Organic Search")!.flag).toBe("change");
    expect(flags.find((f) => f.campaign_name === "Student Referrals")!.flag).toBe("scale");
    expect(flags.find((f) => f.campaign_name === "Organic Search")!.reason).toMatch(/Inside the ±40% band/);
    expect(describeImpact(before, after)).toContain("Flags: Organic Search scale → change");

    const row = (await listAssumptions(db)).find((a) => a.key === "flag_band")!;
    expect([row.value, row.basis, row.updated_by]).toEqual(["0.4", "Testing a wider band", "test"]);
    expect(row.updated_at_text).not.toBeNull();

    await undoEdit(db, editId, "test");
    const back = (await listAssumptions(db)).find((a) => a.key === "flag_band")!;
    expect([back.value, back.updated_by, back.updated_at_text]).toEqual(["0.25", "seed", null]);
    expect(describeImpact(before, await snapshotMetrics(db, FINAL))).toEqual([]);
  });

  it("a reset puts changed assumptions back to their defaults", async () => {
    await updateAssumption(db, { key: "show_rate_benchmark", value: "0.6", actor: "test" });
    const supplied = JSON.parse(readFileSync("data/attendee-dataset.json", "utf8"));
    await loadDataset(db, parseSnapshot(supplied), "test", { reset: true, clearTasks: true });
    expect((await listAssumptions(db)).find((a) => a.key === "show_rate_benchmark")!.value).toBe("0.70");
    expect((await listEdits(db, 1))[0].note).toBe("Reset to attendee-dataset.xlsx; tasks and plan cleared; 1 assumption back to default");
    expect(await listTasks(db, FINAL)).toEqual([]);
  });
});
