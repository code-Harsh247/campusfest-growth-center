import ExcelJS from "exceljs";
import { cellToJson } from "./convert";
import { DatasetError, normalise, parseSnapshot, type DatasetSnapshot, type ParsedDataset } from "./load";
import { TABLES } from "./spec";

/**
 * Reads the supplied workbook layout into a snapshot. Used by scripts and
 * tests only: it is deliberately not exported from the foundation index, so
 * the spreadsheet library never enters the server bundle.
 */
export async function readWorkbookSnapshot(input: string | Buffer, source = "workbook"): Promise<DatasetSnapshot> {
  const wb = new ExcelJS.Workbook();
  if (typeof input === "string") await wb.xlsx.readFile(input);
  else await wb.xlsx.load(input as unknown as ArrayBuffer);

  const problems: string[] = [];
  const tables: DatasetSnapshot["tables"] = {};
  for (const spec of TABLES) {
    const ws = wb.getWorksheet(spec.sheet);
    if (!ws) {
      problems.push(`Missing sheet "${spec.sheet}"`);
      continue;
    }
    // exceljs returns a sparse, 1-based array; Array.from fills the gaps.
    const header = Array.from(ws.getRow(1).values as unknown[], (h) => (h == null ? "" : String(h).trim()));
    const colIndex = new Map(header.map((h, i) => [h, i]));
    const columns = spec.columns.map((c) => c.name);
    for (const c of columns) if (!colIndex.has(c)) problems.push(`Sheet "${spec.sheet}" has no column "${c}"`);
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

/** Reads and validates a workbook in one step. */
export async function parseWorkbook(input: string | Buffer, source = "workbook"): Promise<ParsedDataset> {
  return parseSnapshot(await readWorkbookSnapshot(input, source));
}

export { normalise };
