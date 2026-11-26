import ExcelJS from "exceljs";
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

/** Reads the supplied workbook layout. Refuses the whole file if any row is invalid. */
export async function parseWorkbook(input: string | Buffer, source = "workbook"): Promise<ParsedDataset> {
  const wb = new ExcelJS.Workbook();
  if (typeof input === "string") await wb.xlsx.readFile(input);
  else await wb.xlsx.load(input as unknown as ArrayBuffer);

  const problems: string[] = [];
  const raw = new Map<string, Record<string, unknown>[]>();

  for (const spec of TABLES) {
    const ws = wb.getWorksheet(spec.sheet);
    if (!ws) {
      problems.push(`Missing sheet "${spec.sheet}"`);
      continue;
    }
    // exceljs returns a sparse, 1-based array; Array.from fills the gaps.
    const header = Array.from(ws.getRow(1).values as unknown[], (h) => (h == null ? "" : String(h).trim()));
    const colIndex = new Map(header.map((h, i) => [h, i]));
    for (const col of spec.columns) {
      if (!colIndex.has(col.name)) problems.push(`Sheet "${spec.sheet}" has no column "${col.name}"`);
    }
    const rows: Record<string, unknown>[] = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n === 1) return;
      const values = row.values as unknown[];
      const rec: Record<string, unknown> = {};
      for (const col of spec.columns) rec[col.name] = values[colIndex.get(col.name) ?? -1];
      if (Object.values(rec).every((x) => x == null || x === "")) return;
      rec.__row = n;
      rows.push(rec);
    });
    raw.set(spec.table, rows);
  }
  if (problems.length) throw new DatasetError(problems);
  return normalise(raw, source);
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
    await tx.query(
      `insert into app.edit_log (actor, action, note, after) values ($1, 'load', $2, $3)`,
      [actor, `Loaded ${data.source}`, JSON.stringify(data.report)],
    );
  });
}
