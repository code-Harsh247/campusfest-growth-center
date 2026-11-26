"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { EditError, createTask, updateTask } from "@/foundation";
import { getDb } from "@/server/db";

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : "";
};

const back = (form: FormData, extra: Record<string, string>) => {
  const params = new URLSearchParams({ asOf: str(form, "asOf") });
  const show = str(form, "show");
  if (show) params.set("show", show);
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return `/tasks?${params.toString()}`;
};

export async function createTaskAction(form: FormData) {
  const title = str(form, "title").trim();
  try {
    await createTask(
      await getDb(),
      {
        title,
        description: str(form, "description"),
        campaign_id: str(form, "campaign_id"),
        owner_id: str(form, "owner_id"),
        due_date: str(form, "due_date"),
        priority: str(form, "priority") || "medium",
        source: "manual",
      },
      "app user",
    );
  } catch (e) {
    if (e instanceof EditError) redirect(back(form, { error: e.message }));
    throw e;
  }
  revalidatePath("/", "layout");
  redirect(back(form, { toast: `Task created: ${title}` }));
}

export async function updateTaskStatusAction(form: FormData) {
  const status = str(form, "status");
  try {
    await updateTask(await getDb(), Number(str(form, "task_id")), { status }, "app user");
  } catch (e) {
    if (e instanceof EditError) redirect(back(form, { error: e.message }));
    throw e;
  }
  revalidatePath("/", "layout");
  redirect(back(form, { toast: `Saved · status changed to ${status}` }));
}
