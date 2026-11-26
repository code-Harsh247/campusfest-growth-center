"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  EditError, createFlagTask, describeImpact, savePlan, snapshotMetrics, undoEdit, updateAssumption,
} from "@/foundation";
import { getDb } from "@/server/db";

const ACTOR = "App user";

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};

/** Back to the Plan screen at the same date and section, with the outcome. */
function back(form: FormData, extra: Record<string, string>, anchor: string): string {
  const params = new URLSearchParams({ asOf: str(form, "nav_asOf") });
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return `/plan?${params.toString()}#${anchor}`;
}

async function run(form: FormData, anchor: string, fn: () => Promise<Record<string, string>>): Promise<never> {
  let target: string;
  try {
    target = back(form, { ...(await fn()), at: anchor }, anchor);
  } catch (e) {
    if (e instanceof EditError) redirect(back(form, { error: e.message, at: anchor, ...(str(form, "key") ? { assumption: str(form, "key") } : {}) }, anchor));
    throw e;
  }
  revalidatePath("/", "layout");
  redirect(target);
}

export async function createFlagTaskAction(form: FormData) {
  await run(form, "flags", async () => {
    const task = await createFlagTask(await getDb(), { campaignId: str(form, "campaign_id"), asOf: str(form, "nav_asOf"), actor: ACTOR });
    return { toast: `Task created for ${task.owner_name ?? "the team"}: ${task.title}` };
  });
}

export async function savePlanAction(form: FormData) {
  await run(form, "sim", async () => {
    let planned: Record<string, unknown>;
    try {
      planned = JSON.parse(str(form, "planned") || "{}");
    } catch {
      throw new EditError("The plan could not be read; reload the page and try again");
    }
    const r = await savePlan(await getDb(), {
      asOf: str(form, "nav_asOf"), planned, actor: ACTOR, createTasks: form.get("create_tasks") === "on",
    });
    const lines = r.changed.map((c) => `${c.campaign_name}: ₹${c.from.toLocaleString("en-IN")} → ₹${c.to.toLocaleString("en-IN")}`);
    if (r.tasks.length) lines.push(`${r.tasks.length} follow-up task${r.tasks.length === 1 ? "" : "s"} created for the owners`);
    return { edit: String(r.editId), moved: lines.join("\n") || "-", done: "plan" };
  });
}

export async function saveAssumptionAction(form: FormData) {
  const key = str(form, "key");
  await run(form, "assumptions", async () => {
    const db = await getDb();
    const asOf = str(form, "nav_asOf");
    const before = await snapshotMetrics(db, asOf);
    const editId = await updateAssumption(db, {
      key, value: str(form, "value"), tag: str(form, "tag"), basis: str(form, "basis"), actor: ACTOR,
    });
    const after = await snapshotMetrics(db, asOf);
    return { edit: String(editId), moved: describeImpact(before, after).join("\n") || "-", done: "assumption" };
  });
}

export async function undoPlanAction(form: FormData) {
  const anchor = str(form, "anchor") === "sim" ? "sim" : "assumptions";
  await run(form, anchor, async () => {
    const db = await getDb();
    const asOf = str(form, "nav_asOf");
    const before = await snapshotMetrics(db, asOf);
    const r = await undoEdit(db, Number(str(form, "edit_id")), ACTOR);
    const after = await snapshotMetrics(db, asOf);
    const lines = anchor === "sim" ? ["The earlier plan is back"] : describeImpact(before, after);
    return { edit: String(r.editId), moved: lines.join("\n") || "-", done: "undo" };
  });
}
