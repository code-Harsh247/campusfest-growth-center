import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EditError, createTask, listTasks, listTeam, resetWorkingCopy, updateTask, type Db } from "../src/foundation";
import { freshDb } from "./helpers";

let db: Db;
beforeAll(async () => { db = await freshDb(); });
afterAll(async () => { await db.close(); });

describe("team and tasks", () => {
  it("seeds the team from the four campaign owners", async () => {
    expect((await listTeam(db)).map((m) => m.name)).toEqual(["Arjun Verma", "Dev Malhotra", "Meera Iyer", "Nisha Rao"]);
  });

  it("creates a task and judges overdue against the selected date", async () => {
    const t = await createTask(db, {
      title: "Move Creator Partners to pay per verified attendee",
      campaign_id: "C03", owner_id: "T05", due_date: "2025-03-22", priority: "high",
    }, "test");
    expect(t).toMatchObject({ campaign_name: "Creator Partners", owner_name: "Nisha Rao", status: "to do" });
    const on = async (d: string) => (await listTasks(db, d)).find((x) => x.task_id === t.task_id)!.overdue;
    expect([await on("2025-03-20"), await on("2025-03-22"), await on("2025-03-23")]).toEqual([false, false, true]);

    await updateTask(db, t.task_id, { status: "done" }, "test");
    expect(await on("2025-04-20")).toBe(false);
    const [log] = await db.query<{ action: string; table_name: string }>(
      "select action, table_name from app.edit_log order by edit_id desc limit 1");
    expect(log).toEqual({ action: "update", table_name: "app.tasks" });
  });

  it("refuses bad task input", async () => {
    await expect(createTask(db, { title: "  " }, "test")).rejects.toThrow(/needs a title/);
    await expect(createTask(db, { title: "x", campaign_id: "C99" }, "test")).rejects.toBeInstanceOf(EditError);
    await expect(createTask(db, { title: "x", status: "someday" }, "test")).rejects.toThrow(/Unknown status/);
    await expect(createTask(db, { title: "x", due_date: "next week" }, "test")).rejects.toThrow(/not a date/);
  });

  it("keeps tasks through a data reset", async () => {
    const n = (await listTasks(db, "2025-04-20")).length;
    await resetWorkingCopy(db, "test");
    expect((await listTasks(db, "2025-04-20")).length).toBe(n);
  });
});
