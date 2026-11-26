import { readFileSync } from "node:fs";
import path from "node:path";
import type { Db } from "./db";
import { sourceTablesDdl } from "./spec";

// Resolved from the project root so it works in tests, `next dev` and the built server alike.
const sqlFile = (name: string) => readFileSync(path.join(process.cwd(), "db", name), "utf8");

/** Creates every schema, table and metric function. Safe to run repeatedly. */
export async function migrate(db: Db): Promise<void> {
  await db.exec(sourceTablesDdl("original"));
  await db.exec(sourceTablesDdl("working"));
  await db.exec(sqlFile("app.sql"));
  await db.exec(sqlFile("metrics.sql"));
}
