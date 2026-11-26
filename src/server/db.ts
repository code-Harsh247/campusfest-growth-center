import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadDataset, migrate, openPglite, openPostgres, parseSnapshot, refreshStatistics, type Db } from "@/foundation";

function localDir(): string {
  const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  mkdirSync(path.dirname(dir), { recursive: true }); // PGlite creates the folder, not its parents
  return dir;
}

/**
 * One shared database for the server. With DATABASE_URL set it is PostgreSQL;
 * otherwise a PGlite database persisted under .data/ for local runs. On first
 * start the schema is created and the supplied dataset is loaded.
 */
const globalForDb = globalThis as unknown as { __growthDb?: Promise<Db> };

async function init(): Promise<Db> {
  const db = process.env.DATABASE_URL
    ? await openPostgres(process.env.DATABASE_URL)
    : await openPglite(localDir());
  await migrate(db);
  await refreshStatistics(db); // statistics may be missing after a restart
  const [{ n }] = await db.query<{ n: number }>("select count(*)::int as n from original.event");
  if (n === 0) {
    const file = path.join(process.cwd(), "data", "attendee-dataset.json");
    await loadDataset(db, parseSnapshot(JSON.parse(readFileSync(file, "utf8"))), "system");
  }
  return db;
}

export function getDb(): Promise<Db> {
  if (!globalForDb.__growthDb) {
    globalForDb.__growthDb = init().catch((e) => {
      globalForDb.__growthDb = undefined; // allow a retry on the next request
      throw e;
    });
  }
  return globalForDb.__growthDb;
}
