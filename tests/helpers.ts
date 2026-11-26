import { loadDataset, migrate, openPglite, type Db } from "../src/foundation";
import { parseWorkbook } from "../src/foundation/workbook";

export const WORKBOOK = "data/attendee-dataset.xlsx";

/** A fresh in-memory database loaded from the supplied workbook. */
export async function freshDb(): Promise<Db> {
  const db = await openPglite();
  await migrate(db);
  await loadDataset(db, await parseWorkbook(WORKBOOK, "attendee-dataset.xlsx"));
  return db;
}

export const round = (x: number | null | undefined, digits = 0): number | null =>
  x == null ? null : Math.round(x * 10 ** digits) / 10 ** digits;
