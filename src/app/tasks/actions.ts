"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { EditError, createTask, updateTask } from "@/foundation";
import { getDb } from "@/server/db";

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : "";
};

const back = (asOf: string, extra = "") => `/tasks?asOf=${encodeURIComponent(asOf)}${extra}`;

export async function createTaskAction(form: FormData) {
  const asOf = str(form, "asOf");
  try {
    await createTask(
      await getDb(),
      {
        title: str(form, "title"),
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
    if (e instanceof EditError) redirect(back(asOf, `&error=${encodeURIComponent(e.message)}`));
    throw e;
  }
  revalidatePath("/", "layout");
  redirect(back(asOf, "&saved=1"));
}

export async function updateTaskStatusAction(form: FormData) {
  const asOf = str(form, "asOf");
  try {
    await updateTask(await getDb(), Number(str(form, "task_id")), { status: str(form, "status") }, "app user");
  } catch (e) {
    if (e instanceof EditError) redirect(back(asOf, `&error=${encodeURIComponent(e.message)}`));
    throw e;
  }
  revalidatePath("/", "layout");
  redirect(back(asOf));
}
