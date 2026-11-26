import type { Db } from "./db";
import { EditError } from "./edits";

export const TASK_STATUSES = ["to do", "in progress", "blocked", "done"] as const;
export const TASK_PRIORITIES = ["high", "medium", "low"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface Task {
  task_id: number;
  title: string;
  description: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  owner_id: string | null;
  owner_name: string | null;
  due_date: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  source: string;
  outcome_note: string | null;
  /** Due before the selected date and not done. Deadlines are judged against the selected date. */
  overdue: boolean;
}

export interface TeamMember {
  owner_id: string;
  name: string;
  role: string;
}

export async function listTeam(db: Db): Promise<TeamMember[]> {
  return db.query<TeamMember>("select owner_id, name, role from app.team order by name");
}

export async function listTasks(db: Db, asOf: string): Promise<Task[]> {
  return db.query<Task>(
    `select t.task_id::int as task_id, t.title, t.description, t.campaign_id, c.campaign_name,
            t.owner_id, m.name as owner_name, t.due_date, t.status, t.priority, t.source, t.outcome_note,
            (t.due_date is not null and t.due_date < $1::date and t.status <> 'done') as overdue
     from app.tasks t
     left join working.campaigns c on c.campaign_id = t.campaign_id
     left join app.team m on m.owner_id = t.owner_id
     order by (t.status = 'done'), t.due_date nulls last, t.task_id`,
    [asOf],
  );
}

export interface TaskInput {
  title: string;
  description?: string | null;
  campaign_id?: string | null;
  owner_id?: string | null;
  due_date?: string | null;
  status?: string;
  priority?: string;
  source?: "manual" | "flag" | "chatbot" | "seed";
  metric_snapshot?: unknown;
}

const blankToNull = (v: string | null | undefined) => (v == null || v.trim() === "" ? null : v.trim());

async function cleanTask(db: Db, input: TaskInput) {
  const title = input.title?.trim() ?? "";
  if (!title) throw new EditError("A task needs a title");
  if (title.length > 200) throw new EditError("Keep the title under 200 characters");
  const status = input.status ?? "to do";
  if (!(TASK_STATUSES as readonly string[]).includes(status)) throw new EditError(`Unknown status "${status}"`);
  const priority = input.priority ?? "medium";
  if (!(TASK_PRIORITIES as readonly string[]).includes(priority)) throw new EditError(`Unknown priority "${priority}"`);
  const campaign_id = blankToNull(input.campaign_id);
  if (campaign_id && !(await db.query("select 1 from working.campaigns where campaign_id = $1", [campaign_id])).length) {
    throw new EditError(`Campaign ${campaign_id} does not exist`);
  }
  const owner_id = blankToNull(input.owner_id);
  if (owner_id && !(await db.query("select 1 from app.team where owner_id = $1", [owner_id])).length) {
    throw new EditError(`Team member ${owner_id} does not exist`);
  }
  const due_date = blankToNull(input.due_date);
  if (due_date && (!/^\d{4}-\d{2}-\d{2}$/.test(due_date) || Number.isNaN(Date.parse(due_date)))) {
    throw new EditError(`"${due_date}" is not a date`);
  }
  return { title, description: blankToNull(input.description), campaign_id, owner_id, due_date, status, priority };
}

export async function createTask(db: Db, input: TaskInput, actor: string): Promise<Task> {
  return db.transaction(async (tx) => {
    const t = await cleanTask(tx, input);
    const [{ task_id }] = await tx.query<{ task_id: number }>(
      `insert into app.tasks (title, description, campaign_id, owner_id, due_date, status, priority, source, metric_snapshot)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning task_id::int`,
      [t.title, t.description, t.campaign_id, t.owner_id, t.due_date, t.status, t.priority,
        input.source ?? "manual", input.metric_snapshot ? JSON.stringify(input.metric_snapshot) : null],
    );
    await tx.query(
      `insert into app.edit_log (actor, action, table_name, record_id, after) values ($1, 'insert', 'app.tasks', $2, $3)`,
      [actor, String(task_id), JSON.stringify(t)],
    );
    // Overdue depends on the date being viewed; the caller re-lists with it.
    const [task] = (await listTasks(tx, "1900-01-01")).filter((x) => x.task_id === task_id);
    return task;
  });
}

export async function updateTask(
  db: Db,
  taskId: number,
  changes: Partial<TaskInput> & { outcome_note?: string | null },
  actor: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx.query<Record<string, unknown>>(
      `select title, description, campaign_id, owner_id, due_date, status, priority, outcome_note
       from app.tasks where task_id = $1`,
      [taskId],
    );
    if (!before) throw new EditError(`Task ${taskId} does not exist`);
    const merged = { ...before, ...changes } as TaskInput & { outcome_note?: string | null };
    const t = await cleanTask(tx, merged);
    const outcome = blankToNull(merged.outcome_note ?? null);
    await tx.query(
      `update app.tasks set title = $2, description = $3, campaign_id = $4, owner_id = $5, due_date = $6,
              status = $7, priority = $8, outcome_note = $9, updated_at = now()
       where task_id = $1`,
      [taskId, t.title, t.description, t.campaign_id, t.owner_id, t.due_date, t.status, t.priority, outcome],
    );
    await tx.query(
      `insert into app.edit_log (actor, action, table_name, record_id, before, after) values ($1, 'update', 'app.tasks', $2, $3, $4)`,
      [actor, String(taskId), JSON.stringify(before), JSON.stringify({ ...t, outcome_note: outcome })],
    );
  });
}
