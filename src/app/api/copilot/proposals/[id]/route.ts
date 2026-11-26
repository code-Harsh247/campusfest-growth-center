import { revalidatePath } from "next/cache";
import { EditError, decideAction } from "@/foundation";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The person's click on a task card: Create task (with their edits) or Discard. The model cannot call this. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Unknown proposal" }, { status: 404 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Response.json({ error: "Send JSON" }, { status: 400 }); }
  const s = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);
  try {
    const r = await decideAction(await getDb(), id,
      body.action === "accept"
        ? { accept: true, title: s("title"), campaign_id: s("campaign_id") ?? undefined, owner_id: s("owner_id") ?? undefined, due_date: s("due_date"), priority: s("priority"), description: s("description") }
        : { accept: false, reason: s("reason") ?? null },
      "App user (copilot card)");
    revalidatePath("/", "layout");
    return Response.json(r);
  } catch (e) {
    if (e instanceof EditError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
