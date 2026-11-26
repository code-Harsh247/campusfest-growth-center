import { readFileSync } from "node:fs";
import path from "node:path";
import { parseSnapshot, type ParsedDataset } from "@/foundation";

/** The supplied CampusFest 2025 dataset, as bundled with the app. */
export const SUPPLIED_SOURCE = "attendee-dataset.xlsx";

export function suppliedDataset(): ParsedDataset {
  const file = path.join(process.cwd(), "data", "attendee-dataset.json");
  return parseSnapshot(JSON.parse(readFileSync(file, "utf8")));
}
