import ExcelJS from "exceljs";
import { normalise, parseSnapshot, type DatasetSnapshot, type ParsedDataset } from "./load";
import { snapshotFromWorkbook, type WorkbookLike } from "./snapshot";

/**
 * Reads the supplied workbook layout from disk into a snapshot. Used by
 * scripts and tests only: it is deliberately not exported from the foundation
 * index, so the spreadsheet library never enters the server bundle.
 */
export async function readWorkbookSnapshot(input: string | Buffer, source = "workbook"): Promise<DatasetSnapshot> {
  const wb = new ExcelJS.Workbook();
  if (typeof input === "string") await wb.xlsx.readFile(input);
  else await wb.xlsx.load(input as unknown as ArrayBuffer);
  return snapshotFromWorkbook(wb as unknown as WorkbookLike, source);
}

/** Reads and validates a workbook in one step. */
export async function parseWorkbook(input: string | Buffer, source = "workbook"): Promise<ParsedDataset> {
  return parseSnapshot(await readWorkbookSnapshot(input, source));
}

export { normalise };
