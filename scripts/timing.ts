// Times each metric function on PGlite: npx tsx scripts/timing.ts
import { loadDataset, migrate, openPglite } from "../src/foundation";
import { parseWorkbook } from "../src/foundation/workbook";

const db = await openPglite();
await migrate(db);
await loadDataset(db, await parseWorkbook("data/attendee-dataset.xlsx", "x"));
await db.exec("analyze");
console.log("analyzed");
if (process.argv[2] === "hints") {
  await db.exec(`alter function metrics.ext_people(date) rows 4000; alter function metrics.reg_state(date) rows 3000;
    alter function metrics.admissions(date) rows 3000; alter function metrics.person_credit(date) rows 4000;`);
  console.log("with row hints");
}
const calls: [string, string, unknown[]][] = [
  ["ext_people", "select count(*) from metrics.ext_people($1)", ["2025-04-20"]],
  ["reg_state", "select count(*) from metrics.reg_state($1)", ["2025-04-20"]],
  ["admissions", "select count(*) from metrics.admissions($1)", ["2025-04-20"]],
  ["person_credit", "select count(*) from metrics.person_credit($1)", ["2025-04-20"]],
  ["funnel", "select * from metrics.funnel($1)", ["2025-04-20"]],
  ["campaign_table", "select * from metrics.campaign_table($1)", ["2025-04-20"]],
  ["target_status", "select * from metrics.target_status($1)", ["2025-04-20"]],
  ["flag_reads", "select * from metrics.flag_reads($1)", ["2025-04-20"]],
  ["flags", "select * from metrics.flags($1)", ["2025-04-20"]],
  ["projection post", "select * from metrics.projection($1)", ["2025-04-20"]],
  ["projection pre", "select * from metrics.projection($1)", ["2025-03-15"]],
  ["weekly", "select * from metrics.weekly($1)", ["2025-04-20"]],
];
for (const [name, sql, params] of calls) {
  await db.query(sql, params); // warm
  const t = performance.now();
  await db.query(sql, params);
  console.log(name.padEnd(18), Math.round(performance.now() - t), "ms");
}
await db.close();
