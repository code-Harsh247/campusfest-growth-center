import { openPglite } from "../src/foundation/db";
import { migrate } from "../src/foundation/schema";
import { parseWorkbook, loadDataset } from "../src/foundation/load";

const t0 = Date.now();
const db = await openPglite();
await migrate(db);
const data = await parseWorkbook("data/attendee-dataset.xlsx", "attendee-dataset.xlsx");
console.log("parsed", Date.now() - t0, "ms");
await loadDataset(db, data);
console.log("loaded", Date.now() - t0, "ms");
console.table(data.report);
for (const d of ["2025-03-15", "2025-04-12", "2025-04-20"]) {
  const t = Date.now();
  console.log(d, (await db.query("select * from metrics.funnel($1)", [d]))[0], Date.now() - t, "ms");
}
console.log((await db.query("select checkins.occurred_at from working.checkins order by event_id limit 3")));
await db.close();
