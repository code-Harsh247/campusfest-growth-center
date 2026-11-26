"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  EditError, deleteRecord, describeImpact, insertRecord, loadDataset, snapshotMetrics, undoEdit, updateRecord,
  type Db,
} from "@/foundation";
import { getDb } from "@/server/db";
import { suppliedDataset } from "@/server/dataset";

const ACTOR = "App user";

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};

/** Where to send the person back: same tab and selection, plus the outcome. */
function back(form: FormData, extra: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const k of ["asOf", "tab", "campaign", "day", "version", "cid", "reg", "event"]) {
    const v = str(form, `nav_${k}`);
    if (v) params.set(k, v);
  }
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return `/data?${params.toString()}#edit`;
}

/** Runs one change and describes what it moved at the selected date. */
async function withImpact(form: FormData, change: (db: Db) => Promise<number>): Promise<never> {
  const asOf = str(form, "nav_asOf");
  const db = await getDb();
  let target: string;
  try {
    const before = await snapshotMetrics(db, asOf);
    const editId = await change(db);
    const after = await snapshotMetrics(db, asOf);
    target = back(form, {
      edit: String(editId),
      moved: describeImpact(before, after).join("\n") || "-",
      done: str(form, "undo") ? "undo" : "save",
    });
  } catch (e) {
    if (e instanceof EditError) redirect(back(form, { error: e.message }));
    throw e;
  }
  revalidatePath("/", "layout");
  redirect(target);
}

const tsFromLocal = (v: string) => (v ? v.replace("T", " ") : "");
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36).toUpperCase()}`;

// ---------------------------------------------------------------- daily marketing

export async function saveDailyAction(form: FormData) {
  await withImpact(form, async (db) => {
    const counts = {
      marketing_spend_inr: str(form, "spend"),
      impressions: str(form, "impressions"),
      clicks: str(form, "clicks"),
      landing_page_sessions: str(form, "sessions"),
      registration_starts: str(form, "form_starts"),
    };
    const id = str(form, "activity_id");
    if (id) return (await updateRecord(db, { table: "daily_marketing", id, changes: counts, actor: ACTOR })).editId;

    const cid = str(form, "campaign_id");
    const day = str(form, "day");
    const [c] = await db.query<{ campaign_name: string; owner_id: string | null; owner_name: string | null }>(
      "select campaign_name, owner_id, owner_name from working.campaigns where campaign_id = $1", [cid],
    );
    if (!c) throw new EditError(`Campaign ${cid} does not exist`);
    let activityId = `AD-${cid}-${day.slice(5, 7)}${day.slice(8, 10)}`;
    if ((await db.query("select 1 from working.daily_marketing where activity_id = $1", [activityId])).length) activityId = newId(`AD-${cid}`);
    return (await insertRecord(db, {
      table: "daily_marketing",
      values: {
        activity_id: activityId, campaign_id: cid, campaign_name: c.campaign_name, owner_id: c.owner_id,
        owner_name: c.owner_name, activity_date: day, reported_reach: 0, platform: "entered in Growth Center", ...counts,
      },
      actor: ACTOR,
    })).editId;
  });
}

// ---------------------------------------------------------------- targets

export async function saveTargetAction(form: FormData) {
  await withImpact(form, async (db) => {
    const values = {
      target_version: str(form, "target_version"),
      identified_external_people_goal: str(form, "people"),
      registration_goal: str(form, "registrations"),
      unique_external_visitors_goal: str(form, "attendees"),
      marketing_budget_inr: str(form, "budget"),
    };
    const existing = str(form, "existing");
    if (existing) return (await updateRecord(db, { table: "targets", id: existing, changes: values, actor: ACTOR })).editId;
    return (await insertRecord(db, {
      table: "targets", values: { ...values, effective_at: tsFromLocal(str(form, "effective_at")) }, actor: ACTOR,
    })).editId;
  });
}

// ---------------------------------------------------------------- campaigns

export async function saveCampaignAction(form: FormData) {
  await withImpact(form, async (db) => {
    const ownerId = str(form, "owner_id");
    const [owner] = ownerId ? await db.query<{ name: string }>("select name from app.team where owner_id = $1", [ownerId]) : [];
    const values = {
      campaign_name: str(form, "campaign_name"),
      channel: str(form, "channel"),
      owner_id: ownerId || null,
      owner_name: owner?.name ?? null,
      target_audience: str(form, "target_audience") || null,
      objective: str(form, "objective") || null,
      planned_start_at: str(form, "planned_start") ? `${str(form, "planned_start")} 09:00` : null,
      planned_end_at: str(form, "planned_end") ? `${str(form, "planned_end")} 20:00` : null,
    };
    const existing = str(form, "existing");
    if (existing) return (await updateRecord(db, { table: "campaigns", id: existing, changes: values, actor: ACTOR })).editId;
    const cid = str(form, "campaign_id").toUpperCase();
    if (!cid) throw new EditError("A new campaign needs an ID, such as C08");
    form.set("nav_cid", cid);
    return (await insertRecord(db, {
      table: "campaigns",
      values: { ...values, campaign_id: cid, created_at: `${str(form, "nav_asOf")} 09:00` },
      actor: ACTOR,
    })).editId;
  });
}

// ---------------------------------------------------------------- registration status

export async function addStatusAction(form: FormData) {
  await withImpact(form, async (db) => {
    const regId = str(form, "registration_id");
    const [r] = await db.query<{ person_id: string; person_name: string | null; campaign_id: string | null; campaign_name: string | null; owner_id: string | null; owner_name: string | null }>(
      "select person_id, person_name, campaign_id, campaign_name, owner_id, owner_name from working.registrations where registration_id = $1",
      [regId],
    );
    if (!r) throw new EditError(`Registration ${regId} does not exist`);
    return (await insertRecord(db, {
      table: "registration_history",
      values: { ...r, history_id: newId("RH"), registration_id: regId, effective_at: tsFromLocal(str(form, "effective_at")), status: str(form, "status") },
      actor: ACTOR,
    })).editId;
  });
}

// ---------------------------------------------------------------- check-ins

export async function addCheckinAction(form: FormData) {
  await withImpact(form, async (db) => {
    const personId = str(form, "person_id");
    const regId = str(form, "registration_id") || null;
    const [p] = await db.query<{ person_name: string | null }>("select person_name from working.people where person_id = $1", [personId]);
    const [r] = regId
      ? await db.query<{ campaign_id: string | null; campaign_name: string | null; owner_id: string | null; owner_name: string | null }>(
        "select campaign_id, campaign_name, owner_id, owner_name from working.registrations where registration_id = $1", [regId])
      : [];
    const eventId = newId("CHK");
    form.set("nav_event", eventId);
    return (await insertRecord(db, {
      table: "checkins",
      values: {
        event_id: eventId, person_id: personId, person_name: p?.person_name ?? null, registration_id: regId,
        campaign_id: r?.campaign_id ?? null, campaign_name: r?.campaign_name ?? null, owner_id: r?.owner_id ?? null,
        owner_name: r?.owner_name ?? null, occurred_at: tsFromLocal(str(form, "occurred_at")),
        result: str(form, "result"), verification: str(form, "verification"), source: str(form, "source"),
      },
      actor: ACTOR,
    })).editId;
  });
}

export async function voidCheckinAction(form: FormData) {
  await withImpact(form, async (db) =>
    (await deleteRecord(db, { table: "checkins", id: str(form, "event_id"), actor: ACTOR, note: "Voided admission" })).editId);
}

// ---------------------------------------------------------------- undo and reset

export async function undoAction(form: FormData) {
  form.set("undo", "1");
  await withImpact(form, async (db) => (await undoEdit(db, Number(str(form, "edit_id")), ACTOR)).editId);
}

export async function resetAction(form: FormData) {
  const clearTasks = form.get("clear_tasks") === "on";
  await loadDataset(await getDb(), suppliedDataset(), ACTOR, { reset: true, clearTasks });
  revalidatePath("/", "layout");
  const params = new URLSearchParams({ asOf: str(form, "nav_asOf"), toast: `Data reset to the original CampusFest 2025 dataset${clearTasks ? "; tasks and plan cleared" : ""}` });
  redirect(`/data?${params.toString()}`);
}
