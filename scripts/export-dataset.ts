// Converts the supplied workbook into data/attendee-dataset.json, which the app loads.
// Run after replacing the workbook: npx tsx scripts/export-dataset.ts
import { writeFileSync } from "node:fs";
import { readWorkbookSnapshot } from "../src/foundation/workbook";

const snap = await readWorkbookSnapshot("data/attendee-dataset.xlsx", "attendee-dataset.xlsx");
writeFileSync("data/attendee-dataset.json", JSON.stringify(snap));
console.log(Object.entries(snap.tables).map(([t, v]) => `${t}: ${v.rows.length}`).join("\n"));
