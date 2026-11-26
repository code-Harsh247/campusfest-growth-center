import { TASK_PRIORITIES, TASK_STATUSES, dataWindow, getCampaignTable, listTasks, listTeam } from "@/foundation";
import { Chip, Shell, toneFor } from "@/components/Shell";
import { resolveAsOf } from "@/lib/asof";
import { day } from "@/lib/format";
import { getDb } from "@/server/db";
import { createTaskAction, updateTaskStatusAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string; error?: string; saved?: string }>;
}) {
  const sp = await searchParams;
  const db = await getDb();
  const w = await dataWindow(db);
  const { asOf, notice } = resolveAsOf(sp.asOf, w);

  const tasks = await listTasks(db, asOf);
  const team = await listTeam(db);
  const campaigns = (await getCampaignTable(db, asOf)).data.filter((c) => c.campaign_id);

  const open = tasks.filter((t) => t.status !== "done");
  const overdue = open.filter((t) => t.overdue).length;

  return (
    <Shell active="/tasks" asOf={asOf} window={w} notice={notice}>
      <div className="page-head">
        <h1>What are we doing about it?</h1>
        <div className="muted">
          {open.length} open, {overdue} overdue as of {day(asOf)}. Deadlines are judged against the selected date.
        </div>
      </div>

      {sp.error && <div className="error" role="alert">{sp.error}</div>}
      {sp.saved && <div className="notice" role="status">Task saved.</div>}

      <section className="card">
        <h2>New task</h2>
        <form action={createTaskAction} className="stack">
          <input type="hidden" name="asOf" value={asOf} />
          <label>
            Title
            <input name="title" required maxLength={200} placeholder="e.g. Move Paid Social to retargeting only" />
          </label>
          <div className="form-row">
            <label>
              Campaign
              <select name="campaign_id" defaultValue="">
                <option value="">None (cross-campaign)</option>
                {campaigns.map((c) => <option key={c.campaign_id!} value={c.campaign_id!}>{c.campaign_name}</option>)}
              </select>
            </label>
            <label>
              Owner
              <select name="owner_id" defaultValue="">
                <option value="">Unassigned</option>
                {team.map((m) => <option key={m.owner_id} value={m.owner_id}>{m.name}</option>)}
              </select>
            </label>
            <label>
              Due date
              <input type="date" name="due_date" />
            </label>
            <label>
              Priority
              <select name="priority" defaultValue="medium">
                {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          </div>
          <label>
            Notes
            <textarea name="description" placeholder="Why this task exists, with the numbers behind it" />
          </label>
          <button type="submit">Create task</button>
        </form>
      </section>

      <section className="card section">
        <h2>Tasks</h2>
        {tasks.length === 0 ? (
          <p className="muted small">No tasks yet. Create one above, or from a flag on the Campaigns page once that is built.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Task</th><th>Campaign</th><th>Owner</th><th>Due</th><th>Priority</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.task_id} className={t.status === "done" ? "subtle" : undefined}>
                    <td>
                      <strong>{t.title}</strong>
                      {t.description && <div className="small muted">{t.description}</div>}
                    </td>
                    <td>{t.campaign_name ?? "–"}</td>
                    <td>{t.owner_name ?? "Unassigned"}</td>
                    <td>
                      {day(t.due_date)}
                      {t.overdue && <> <Chip tone="bad">overdue</Chip></>}
                    </td>
                    <td>{t.priority}</td>
                    <td>
                      <form action={updateTaskStatusAction} className="inline-form">
                        <input type="hidden" name="asOf" value={asOf} />
                        <input type="hidden" name="task_id" value={t.task_id} />
                        <Chip tone={toneFor(t.status)}>{t.status}</Chip>
                        <select name="status" defaultValue={t.status} aria-label={`Change status of ${t.title}`}>
                          {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <button type="submit" className="secondary">Save</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Shell>
  );
}
