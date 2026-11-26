export * from "./db";
export * from "./spec";
export * from "./schema";
export * from "./load";
export * from "./edits";
export * from "./metrics";
export * from "./catalog";

import { openPglite, type Db } from "./db";
import { migrate } from "./schema";
import { parseWorkbook, loadDataset } from "./load";

/** Opens a database, creates the schema and loads the supplied workbook. */
export async function openWithDataset(workbookPath: string, dataDir?: string): Promise<Db> {
  const db = await openPglite(dataDir);
  await migrate(db);
  await loadDataset(db, await parseWorkbook(workbookPath, workbookPath.split(/[\\/]/).pop()));
  return db;
}
