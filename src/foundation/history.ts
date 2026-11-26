import type { Db } from "./db";

/** The edit log as people read it: newest first, with before and after values. */

export interface EditEntry {
  edit_id: number;
  actor: string;
  action: "load" | "insert" | "update" | "delete" | "reset" | "undo";
  table_name: string | null;
  record_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  note: string | null;
  undone_by: number | null;
  /** India time, e.g. "26 Nov 2026, 14:05". */
  at_text: string;
  seconds_ago: number;
}

export async function listEdits(db: Db, limit = 50): Promise<EditEntry[]> {
  return db.query<EditEntry>(
    `select edit_id::int as edit_id, actor, action, table_name, record_id, before, after, note,
            undone_by::int as undone_by,
            to_char(at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH24:MI') as at_text,
            extract(epoch from (now() - at))::int as seconds_ago
     from app.edit_log
     order by edit_id desc
     limit $1`,
    [limit],
  );
}

/** Changes to the data since the last load or reset that are still in effect. */
export async function countLiveEdits(db: Db): Promise<number> {
  const [r] = await db.query<{ n: number }>(
    `select count(*)::int as n from app.edit_log
     where edit_id > coalesce((select max(edit_id) from app.edit_log where action in ('load', 'reset')), 0)
       and action in ('insert', 'update', 'delete')
       and table_name not like 'app.%'
       and undone_by is null`,
  );
  return r.n;
}

/** Whether the loaded dataset is something other than the supplied one (an upload). */
export async function currentSource(db: Db): Promise<string | null> {
  const [r] = await db.query<{ source: string }>("select source from app.load_report limit 1");
  return r?.source ?? null;
}
