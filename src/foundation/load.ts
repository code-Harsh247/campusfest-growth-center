import type { Db } from "./db";
import { convertValue } from "./convert";
import { TABLES, type TableSpec } from "./spec";

export type Row = Record<string, string | number | boolean | null>;

export interface TableLoadReport {
  table: string;
  rawRows: number;
  uniqueRows: number;
  repeatedRows: number;
  conflictingIds: number;
}

export interface ParsedDataset {
  source: string;
  tables: Map<string, Row[]>;
  report: TableLoadReport[];
}

export class DatasetError extends Error {
  constructor(public readonly problems: string[]) {
    super(`The dataset was refused: ${problems.length} problem(s).\n${problems.slice(0, 20).join("\n")}`);
  }
}

/**
 * A dataset as plain JSON: every source row exactly as read, import repeats
 * included, so loading it gives the same load report as the workbook.
 * Produced by scripts/export-dataset.ts; the app loads this instead of the
 * workbook, which keeps the spreadsheet library out of the server.
 */
export interface DatasetSnapshot {
  source: string;
  tables: Record<string, { columns: string[]; rows: unknown[][] }>;
}

export function parseSnapshot(snap: DatasetSnapshot): ParsedDataset {
  const problems: string[] = [];
  const raw = new Map<string, Record<string, unknown>[]>();
  for (const spec of TABLES) {
    const t = snap.tables[spec.table];
    if (!t) {
      problems.push(`Missing table "${spec.table}"`);
      continue;
    }
    for (const col of spec.columns) {
      if (!t.columns.includes(col.name)) problems.push(`Table "${spec.table}" has no column "${col.name}"`);
    }
    raw.set(spec.table, t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i]]))));
  }
  if (problems.length) throw new DatasetError(problems);
  return normalise(raw, snap.source);
}

/** Converts, validates and removes import repeats. Shared by every input format. */
export function normalise(raw: Map<string, Record<string, unknown>[]>, source: string): ParsedDataset {
  const problems: string[] = [];
  const tables = new Map<string, Row[]>();
  const report: TableLoadReport[] = [];

  for (const spec of TABLES) {
    const input = raw.get(spec.table) ?? [];
    const byId = new Map<string, { row: Row; json: string }>();
    let repeated = 0;
    const conflicting = new Set<string>();
    for (const rec of input) {
      const row: Row = {};
      try {
        for (const col of spec.columns) row[col.name] = convertValue(col, rec[col.name]);
      } catch (e) {
        problems.push(`${spec.sheet} row ${rec.__row ?? "?"}: ${(e as Error).message}`);
        continue;
      }
      const id = String(row[spec.key]);
      const json = JSON.stringify(row);
      const seen = byId.get(id);
      if (!seen) byId.set(id, { row, json });
      else if (seen.json === json) repeated++;
      else conflicting.add(id);
    }
    tables.set(spec.table, [...byId.values()].map((x) => x.row));
    report.push({
      table: spec.table,
      rawRows: input.length,
      uniqueRows: byId.size,
      repeatedRows: repeated,
      conflictingIds: conflicting.size,
    });
  }
  if (problems.length) throw new DatasetError(problems);
  return { source, tables, report };
}

async function insertRows(db: Db, schema: string, spec: TableSpec, rows: Row[]): Promise<void> {
  const cols = spec.columns.map((c) => c.name);
  const perChunk = Math.max(1, Math.floor(30_000 / cols.length));
  for (let i = 0; i < rows.length; i += perChunk) {
    const chunk = rows.slice(i, i + perChunk);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const slots = cols.map((c) => {
        params.push(row[c]);
        return `$${params.length}`;
      });
      return `(${slots.join(", ")})`;
    });
    await db.query(`insert into ${schema}.${spec.table} (${cols.join(", ")}) values ${tuples.join(", ")}`, params);
  }
}

/**
 * Replaces the original and working copies with a parsed dataset, records what
 * the loader removed, and logs the load. Tasks and assumptions are untouched.
 */
export async function loadDataset(db: Db, data: ParsedDataset, actor = "system"): Promise<void> {
  await db.transaction(async (tx) => {
    for (const spec of TABLES) {
      await tx.exec(`truncate original.${spec.table}; truncate working.${spec.table};`);
      await insertRows(tx, "original", spec, data.tables.get(spec.table) ?? []);
      await tx.exec(`insert into working.${spec.table} select * from original.${spec.table};`);
    }
    await tx.exec("truncate app.load_report;");
    for (const r of data.report) {
      await tx.query(
        `insert into app.load_report (table_name, source, raw_rows, unique_rows, repeated_rows, conflicting_ids)
         values ($1, $2, $3, $4, $5, $6)`,
        [r.table, data.source, r.rawRows, r.uniqueRows, r.repeatedRows, r.conflictingIds],
      );
    }
    await tx.exec(`
      insert into app.team (owner_id, name)
      select distinct on (owner_id) owner_id, owner_name from working.campaigns
      where owner_id is not null and owner_name is not null
      order by owner_id
      on conflict (owner_id) do nothing;`);
    await tx.query(
      `insert into app.edit_log (actor, action, note, after) values ($1, 'load', $2, $3)`,
      [actor, `Loaded ${data.source}`, JSON.stringify(data.report)],
    );
  });
  await refreshStatistics(db);
}

/**
 * Refreshes the planner's table statistics. Without this, freshly loaded tables
 * look empty to the planner, which then picks joins that are 60x slower.
 */
export async function refreshStatistics(db: Db): Promise<void> {
  await db.exec(TABLES.map((t) => `analyze working.${t.table};`).join(" "));
}
