import { loadDataset, migrate, openPglite } from "../src/foundation";
import { parseWorkbook } from "../src/foundation/workbook";
const db = await openPglite();
await migrate(db);
await loadDataset(db, await parseWorkbook("data/attendee-dataset.xlsx", "x"));
for (const sql of [
  "select * from metrics.reg_state('2025-04-20')",
  "select * from metrics.person_credit('2025-04-20')",
]) {
  const t = performance.now(); await db.query(sql); console.log(sql, Math.round(performance.now() - t), "ms");
}
const rows = await db.query<{ "QUERY PLAN": string }>(process.argv[2] ?? "explain analyze select * from metrics.person_credit('2025-04-20')");
console.log(rows.map((r) => r["QUERY PLAN"]).join("\n"));
await db.close();
