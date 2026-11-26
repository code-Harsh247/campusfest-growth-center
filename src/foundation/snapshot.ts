import { cellToJson } from "./convert";
import { DatasetError, type DatasetSnapshot } from "./load";
import { TABLES } from "./spec";

/**
 * Turns an uploaded file into a dataset snapshot. Pure code with no Node or
 * spreadsheet-library imports, so it runs in the browser (the Data screen's
 * upload) as well as in scripts and tests. The server re-checks every value.
 */

/** The parts of an exceljs workbook this needs. */
export interface WorkbookLike {
  getWorksheet(name: string): {
    getRow(n: number): { values: unknown };
    eachRow(opts: { includeEmpty: boolean }, cb: (row: { values: unknown }, n: number) => void): void;
  } | undefined;
}

export function snapshotFromWorkbook(wb: WorkbookLike, source: string): DatasetSnapshot {
  const problems: string[] = [];
  const tables: DatasetSnapshot["tables"] = {};
  for (const spec of TABLES) {
    const ws = wb.getWorksheet(spec.sheet);
    if (!ws) {
      problems.push(`Missing sheet "${spec.sheet}".`);
      continue;
    }
    // exceljs returns a sparse, 1-based array; Array.from fills the gaps.
    const header = Array.from(ws.getRow(1).values as unknown[], (h) => (h == null ? "" : String(h).trim()));
    const colIndex = new Map(header.map((h, i) => [h, i]));
    const columns = spec.columns.map((c) => c.name);
    for (const c of columns) if (!colIndex.has(c)) problems.push(`Sheet "${spec.sheet}" has no column "${c}".`);
    const rows: unknown[][] = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n === 1) return;
      const values = row.values as unknown[];
      const rec = columns.map((c) => cellToJson(values[colIndex.get(c) ?? -1]));
      if (rec.every((x) => x === null || x === "")) return;
      rows.push([...rec, n]);
    });
    tables[spec.table] = { columns: [...columns, "__row"], rows };
  }
  if (problems.length) throw new DatasetError(problems);
  return { source, tables };
}

/** File names of the dataset's CSV copy, by table. */
export const CSV_FILES: Record<string, string> = {
  "event.csv": "event",
  "targets.csv": "targets",
  "campaigns.csv": "campaigns",
  "campaign_daily.csv": "daily_marketing",
  "people.csv": "people",
  "lead_interactions.csv": "interactions",
  "registrations.csv": "registrations",
  "registration_history.csv": "registration_history",
  "checkins.csv": "checkins",
};

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

/** The CSV copy: one file per table, named as in CSV_FILES. All nine are required. */
export function snapshotFromCsv(files: { name: string; text: string }[], source: string): DatasetSnapshot {
  const problems: string[] = [];
  const tables: DatasetSnapshot["tables"] = {};
  const byTable = new Map<string, { name: string; text: string }>();
  for (const f of files) {
    const table = CSV_FILES[f.name.toLowerCase().split(/[\\/]/).pop() ?? ""];
    if (!table) problems.push(`"${f.name}" is not one of the dataset's CSV files (${Object.keys(CSV_FILES).join(", ")}).`);
    else byTable.set(table, f);
  }
  for (const spec of TABLES) {
    const f = byTable.get(spec.table);
    const fileName = Object.keys(CSV_FILES).find((k) => CSV_FILES[k] === spec.table)!;
    if (!f) {
      problems.push(`Missing ${fileName}.`);
      continue;
    }
    const [header = [], ...body] = parseCsv(f.text);
    const colIndex = new Map(header.map((h, i) => [h.trim(), i]));
    const columns = spec.columns.map((c) => c.name);
    for (const c of columns) if (!colIndex.has(c)) problems.push(`${fileName} has no column "${c}".`);
    tables[spec.table] = {
      columns: [...columns, "__row"],
      rows: body.map((r, i) => [...columns.map((c) => r[colIndex.get(c) ?? -1] ?? null), i + 2]),
    };
  }
  if (problems.length) throw new DatasetError(problems);
  return { source, tables };
}
