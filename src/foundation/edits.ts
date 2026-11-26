import type { Db } from "./db";
import { convertValue } from "./convert";
import { refreshStatistics, type Row } from "./load";
import { TABLE_BY_NAME, TABLES, type TableSpec } from "./spec";

/**
 * Edits change only the `working` copy. Every change is validated, applied in
 * one transaction, and written to app.edit_log with before and after values so
 * it can be undone. The `original` copy is never edited.
 */

export class EditError extends Error {}

/** Columns that must point to an existing record. Campaign IDs may be new. */
const REFERENCES: Record<string, Record<string, string>> = {
  registrations: { person_id: "people" },
  registration_history: { registration_id: "registrations", person_id: "people" },
  checkins: { person_id: "people", registration_id: "registrations" },
  interactions: { person_id: "people" },
};

const ALLOWED: Record<string, Record<string, string[]>> = {
  people: {
    person_type: ["external", "internal", "staff", "test"],
    first_touch_source: ["campaign", "internal_registration", "walk_in", "event_access"],
  },
  registration_history: { status: ["interested", "confirmed", "cancelled", "waitlisted"] },
  checkins: {
    result: ["admitted", "denied", "pending"],
    verification: ["verified", "unverified"],
    source: ["scanner", "manual"],
  },
};

export interface EditResult {
  editId: number;
  before: Row | null;
  after: Row | null;
}

function specFor(table: string): TableSpec {
  const spec = TABLE_BY_NAME.get(table);
  if (!spec) throw new EditError(`Unknown table "${table}"`);
  return spec;
}

async function dataWindow(db: Db): Promise<{ start: string; end: string }> {
  const [w] = await db.query<{ start: string; end: string }>(
    "select history_start as start, history_end as end from working.event limit 1",
  );
  if (!w) throw new EditError("No event record: load a dataset first");
  return w;
}

function normaliseRow(spec: TableSpec, input: Record<string, unknown>): Row {
  const unknown = Object.keys(input).filter((k) => !spec.columns.some((c) => c.name === k));
  if (unknown.length) throw new EditError(`${spec.table} has no column(s): ${unknown.join(", ")}`);
  const row: Row = {};
  for (const col of spec.columns) {
    try {
      row[col.name] = convertValue(col, input[col.name]);
    } catch (e) {
      throw new EditError((e as Error).message);
    }
  }
  return row;
}

async function validate(db: Db, spec: TableSpec, row: Row): Promise<void> {
  for (const [col, values] of Object.entries(ALLOWED[spec.table] ?? {})) {
    const v = row[col];
    if (v !== null && !values.includes(String(v))) {
      throw new EditError(`${col} must be one of ${values.join(", ")}; got "${v}"`);
    }
  }
  if (spec.table !== "event") {
    const { start, end } = await dataWindow(db);
    for (const col of spec.columns) {
      const v = row[col.name];
      if (v === null || (col.type !== "date" && col.type !== "ts")) continue;
      const day = String(v).slice(0, 10);
      if (col.name.startsWith("planned_")) continue; // plans may fall outside the data window
      if (day < start || day > end) {
        throw new EditError(`${col.name} ${day} is outside the data window (${start} to ${end})`);
      }
    }
  }
  for (const [col, target] of Object.entries(REFERENCES[spec.table] ?? {})) {
    const v = row[col];
    if (v === null) continue;
    const targetSpec = specFor(target);
    const found = await db.query(`select 1 from working.${target} where ${targetSpec.key} = $1`, [v]);
    if (!found.length) throw new EditError(`${col} "${v}" does not exist in ${target}`);
  }
}

/** Refuses to delete a record that other records still point to. */
async function assertNotReferenced(db: Db, spec: TableSpec, id: string): Promise<void> {
  for (const [table, refs] of Object.entries(REFERENCES)) {
    for (const [col, target] of Object.entries(refs)) {
      if (target !== spec.table) continue;
      const [{ n }] = await db.query<{ n: number }>(
        `select count(*)::int as n from working.${table} where ${col} = $1`,
        [id],
      );
      if (n > 0) throw new EditError(`${n} ${table} record(s) still point to ${spec.table} ${id}`);
    }
  }
}

async function fetchRow(db: Db, spec: TableSpec, id: string): Promise<Row | null> {
  const rows = await db.query<Row>(`select * from working.${spec.table} where ${spec.key} = $1`, [id]);
  return rows[0] ?? null;
}

async function writeRow(db: Db, spec: TableSpec, row: Row, mode: "insert" | "update"): Promise<void> {
  const cols = spec.columns.map((c) => c.name);
  const params = cols.map((c) => row[c]);
  if (mode === "insert") {
    const slots = cols.map((_, i) => `$${i + 1}`);
    await db.query(`insert into working.${spec.table} (${cols.join(", ")}) values (${slots.join(", ")})`, params);
  } else {
    const sets = cols.map((c, i) => `${c} = $${i + 1}`);
    await db.query(
      `update working.${spec.table} set ${sets.join(", ")} where ${spec.key} = $${cols.length + 1}`,
      [...params, row[spec.key]],
    );
  }
}

async function log(
  db: Db,
  entry: { actor: string; action: string; table?: string; id?: string; before?: Row | null; after?: Row | null; note?: string },
): Promise<number> {
  const [{ edit_id }] = await db.query<{ edit_id: number }>(
    `insert into app.edit_log (actor, action, table_name, record_id, before, after, note)
     values ($1, $2, $3, $4, $5, $6, $7) returning edit_id`,
    [
      entry.actor,
      entry.action,
      entry.table ?? null,
      entry.id ?? null,
      entry.before ? JSON.stringify(entry.before) : null,
      entry.after ? JSON.stringify(entry.after) : null,
      entry.note ?? null,
    ],
  );
  return Number(edit_id);
}

export async function updateRecord(
  db: Db,
  args: { table: string; id: string; changes: Record<string, unknown>; actor: string; note?: string },
): Promise<EditResult> {
  const spec = specFor(args.table);
  if (spec.key in args.changes && String(args.changes[spec.key]) !== args.id) {
    throw new EditError("A record's ID cannot be changed; add a new record instead");
  }
  return db.transaction(async (tx) => {
    const before = await fetchRow(tx, spec, args.id);
    if (!before) throw new EditError(`${spec.table} ${args.id} does not exist`);
    const after = normaliseRow(spec, { ...before, ...args.changes });
    await validate(tx, spec, after);
    await writeRow(tx, spec, after, "update");
    const editId = await log(tx, { actor: args.actor, action: "update", table: spec.table, id: args.id, before, after, note: args.note });
    return { editId, before, after };
  });
}

export async function insertRecord(
  db: Db,
  args: { table: string; values: Record<string, unknown>; actor: string; note?: string },
): Promise<EditResult> {
  const spec = specFor(args.table);
  return db.transaction(async (tx) => {
    const after = normaliseRow(spec, args.values);
    const id = String(after[spec.key]);
    if (await fetchRow(tx, spec, id)) throw new EditError(`${spec.table} ${id} already exists`);
    await validate(tx, spec, after);
    await writeRow(tx, spec, after, "insert");
    const editId = await log(tx, { actor: args.actor, action: "insert", table: spec.table, id, after, note: args.note });
    return { editId, before: null, after };
  });
}

export async function deleteRecord(
  db: Db,
  args: { table: string; id: string; actor: string; note?: string },
): Promise<EditResult> {
  const spec = specFor(args.table);
  return db.transaction(async (tx) => {
    const before = await fetchRow(tx, spec, args.id);
    if (!before) throw new EditError(`${spec.table} ${args.id} does not exist`);
    await assertNotReferenced(tx, spec, args.id);
    await tx.query(`delete from working.${spec.table} where ${spec.key} = $1`, [args.id]);
    const editId = await log(tx, { actor: args.actor, action: "delete", table: spec.table, id: args.id, before, note: args.note });
    return { editId, before, after: null };
  });
}

/** Reverses one edit, provided nothing has changed the record since. */
export async function undoEdit(db: Db, editId: number, actor: string): Promise<EditResult> {
  return db.transaction(async (tx) => {
    const [entry] = await tx.query<{
      action: string; table_name: string; record_id: string; before: Row | null; after: Row | null; undone_by: number | null;
    }>("select action, table_name, record_id, before, after, undone_by from app.edit_log where edit_id = $1", [editId]);
    if (!entry) throw new EditError(`Edit ${editId} does not exist`);
    if (entry.undone_by) throw new EditError(`Edit ${editId} was already undone`);
    if (!["insert", "update", "delete"].includes(entry.action)) {
      throw new EditError(`A ${entry.action} cannot be undone; reset or reload instead`);
    }
    const spec = specFor(entry.table_name);
    const current = await fetchRow(tx, spec, entry.record_id);
    const expected = entry.after ? normaliseRow(spec, entry.after) : null;
    if (JSON.stringify(current) !== JSON.stringify(expected)) {
      throw new EditError(`${spec.table} ${entry.record_id} has changed since edit ${editId}; undo the later edit first`);
    }
    if (entry.action === "insert") {
      await assertNotReferenced(tx, spec, entry.record_id);
      await tx.query(`delete from working.${spec.table} where ${spec.key} = $1`, [entry.record_id]);
    } else {
      const restored = normaliseRow(spec, entry.before!);
      await writeRow(tx, spec, restored, entry.action === "delete" ? "insert" : "update");
    }
    const undoId = await log(tx, {
      actor, action: "undo", table: spec.table, id: entry.record_id,
      before: current, after: entry.before, note: `Undo of edit ${editId}`,
    });
    await tx.query("update app.edit_log set undone_by = $1 where edit_id = $2", [undoId, editId]);
    return { editId: undoId, before: current, after: entry.before };
  });
}

/** Restores every source table's working copy from the original. Tasks are kept. */
export async function resetWorkingCopy(db: Db, actor: string): Promise<number> {
  const editId = await db.transaction(async (tx) => {
    for (const spec of TABLES) {
      await tx.exec(`truncate working.${spec.table}; insert into working.${spec.table} select * from original.${spec.table};`);
    }
    return log(tx, { actor, action: "reset", note: "Working copy restored from the original dataset" });
  });
  await refreshStatistics(db);
  return editId;
}
