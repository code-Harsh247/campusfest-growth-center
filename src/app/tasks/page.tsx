import Link from "next/link";
import { Suspense } from "react";
import {
  TASK_PRIORITIES, TASK_STATUSES, dataWindow, getCampaignTable, listTasks, listTeam,
  type Db, type Task,
} from "@/foundation";
import { ClipboardIcon } from "@/components/icons";
import { Pill, Shell, toneFor } from "@/components/Shell";
import { TasksSkeleton } from "@/components/Skeletons";
import { StatusSelect } from "@/components/StatusSelect";
import { Toast } from "@/components/Toast";
import { resolveAsOf } from "@/lib/asof";
import { day } from "@/lib/format";
import { getDb } from "@/server/db";
import { createTaskAction, updateTaskStatusAction } from "./actions";

export const dynamic = "force-dynamic";

type Show = "open" | "done" | "all";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string; error?: string; toast?: string; show?: string }>;
}) {
  const sp = await searchParams;
  const db = await getDb();
  const w = await dataWindow(db);
  const { asOf, notice } = resolveAsOf(sp.asOf, w);
  const show: Show = sp.show === "done" || sp.show === "all" ? sp.show : "open";
  return (
    <Shell asOf={asOf} window={w} notice={notice}>
      <Suspense key={`${asOf}-${show}`} fallback={<TasksSkeleton />}>
        <Tasks db={db} asOf={asOf} show={show} error={sp.error} />
      </Suspense>
      <Toast message={sp.toast} />
    </Shell>
  );
}

async function Tasks({ db, asOf, show, error }: { db: Db; asOf: string; show: Show; error?: string }) {
  const all = await listTasks(db, asOf);
  const team = await listTeam(db);
  const campaigns = (await getCampaignTable(db, asOf)).data.filter((c) => c.campaign_id);

  const open = all.filter((t) => t.status !== "done");
  const overdue = open.filter((t) => t.overdue).length;
  const shown = show === "open" ? open : show === "done" ? all.filter((t) => t.status === "done") : all;
  const titleError = !!error && /title/i.test(error);
  const filterHref = (s: Show) => `/tasks?asOf=${asOf}${s === "open" ? "" : `&show=${s}`}`;

  return (
    <div className="stack fade-in" style={{ gap: 24 }}>
      <header className="page-head">
        <div>
          <h1>What are we doing about it?</h1>
          <p>
            {all.length === 0 ? `No tasks as of ${day(asOf)}.` : `${open.length} open, ${overdue} overdue as of ${day(asOf)}.`}{" "}
            Deadlines are judged against the selected date.
          </p>
        </div>
      </header>

      <div className="tasks-layout">
        <section aria-labelledby="new-h" className="card new-task">
          <h2 id="new-h">New task</h2>
          {error && <div className="banner error" role="alert">{error}</div>}
          <form action={createTaskAction} className="stack" style={{ gap: 14 }}>
            <input type="hidden" name="asOf" value={asOf} />
            <input type="hidden" name="show" value={show === "open" ? "" : show} />
            <label className="field">
              Title
              <input name="title" maxLength={200} placeholder="What needs doing?" aria-invalid={titleError} />
            </label>
            <div className="form-grid">
              <label className="field">
                Campaign
                <select name="campaign_id" defaultValue="">
                  <option value="">None</option>
                  {campaigns.map((c) => <option key={c.campaign_id!} value={c.campaign_id!}>{c.campaign_name}</option>)}
                </select>
              </label>
              <label className="field">
                Owner
                <select name="owner_id" defaultValue="">
                  <option value="">Unassigned</option>
                  {team.map((m) => <option key={m.owner_id} value={m.owner_id}>{m.name}</option>)}
                </select>
              </label>
              <label className="field">
                Due date
                <input type="date" name="due_date" />
              </label>
              <fieldset className="plain">
                <legend>Priority</legend>
                <div className="segmented">
                  {TASK_PRIORITIES.map((p) => (
                    <label key={p}>
                      <input type="radio" name="priority" value={p} defaultChecked={p === "medium"} />
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <label className="field">
              Notes
              <textarea name="description" rows={3} placeholder="Context, numbers, links" />
            </label>
            <button type="submit" className="btn" style={{ alignSelf: "flex-start" }}>Create task</button>
          </form>
        </section>

        <section aria-labelledby="list-h" className="task-list">
          <div className="row-between" style={{ alignItems: "center" }}>
            <h2 id="list-h" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Tasks</h2>
            <nav className="filter" aria-label="Filter tasks">
              {(["open", "done", "all"] as Show[]).map((s) => (
                <Link key={s} href={filterHref(s)} aria-current={show === s ? "true" : undefined}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </Link>
              ))}
            </nav>
          </div>

          {all.length === 0 ? (
            <div className="empty">
              <ClipboardIcon />
              <h3>No tasks yet</h3>
              <p>Create one here, or start from a flagged campaign.</p>
              <Link className="btn secondary" href={`/campaigns?asOf=${asOf}`} style={{ marginTop: 4 }}>Go to campaign flags</Link>
            </div>
          ) : shown.length === 0 ? (
            <div className="empty">
              <h3>No {show} tasks</h3>
              <p>{show === "done" ? "Nothing has been marked done yet." : "Every task is done."}</p>
            </div>
          ) : (
            shown.map((t) => <TaskCard key={t.task_id} t={t} asOf={asOf} show={show} />)
          )}
        </section>
      </div>
    </div>
  );
}

function TaskCard({ t, asOf, show }: { t: Task; asOf: string; show: Show }) {
  return (
    <article className={`task${t.status === "done" ? " done" : ""}`}>
      <div className="row-between" style={{ alignItems: "flex-start", gap: 12 }}>
        <h3>{t.title}</h3>
        <form action={updateTaskStatusAction} className="status-select">
          <input type="hidden" name="asOf" value={asOf} />
          <input type="hidden" name="show" value={show === "open" ? "" : show} />
          <input type="hidden" name="task_id" value={t.task_id} />
          <span aria-hidden="true">Status</span>
          <StatusSelect name="status" defaultValue={t.status} options={TASK_STATUSES} label={`Status of ${t.title}`} />
          <noscript><button type="submit" className="btn secondary">Save</button></noscript>
        </form>
      </div>
      {t.description && <p>{t.description}</p>}
      <dl>
        <div>
          <dt>Campaign</dt>
          <dd>{t.campaign_name
            ? <Link href={`/campaigns?asOf=${asOf}`} style={{ fontWeight: 500, textUnderlineOffset: 3 }}>{t.campaign_name}</Link>
            : "None"}</dd>
        </div>
        <div><dt>Owner</dt><dd>{t.owner_name ?? "Unassigned"}</dd></div>
        <div>
          <dt>Due</dt>
          <dd>{day(t.due_date)}{t.overdue && <Pill tone="bad">overdue</Pill>}</dd>
        </div>
        <div><dt>Priority</dt><dd><Pill tone={toneFor(t.priority)}>{t.priority}</Pill></dd></div>
        <div><dt>Source</dt><dd>{t.source}</dd></div>
      </dl>
    </article>
  );
}
