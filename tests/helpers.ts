import { openWithDataset, type Db } from "../src/foundation";

export const WORKBOOK = "data/attendee-dataset.xlsx";

export const freshDb = (): Promise<Db> => openWithDataset(WORKBOOK);

export const round = (x: number | null | undefined, digits = 0): number | null =>
  x == null ? null : Math.round(x * 10 ** digits) / 10 ** digits;
