import { readFileSync } from "node:fs";
import type { Db } from "./db";
import { sourceTablesDdl } from "./spec";

const sqlFile = (name: string) => readFileSync(new URL(`../../db/${name}`, import.meta.url), "utf8");

/** Creates every schema, table and metric function. Safe to run repeatedly. */
export async function migrate(db: Db): Promise<void> {
  await db.exec(sourceTablesDdl("original"));
  await db.exec(sourceTablesDdl("working"));
  await db.exec(sqlFile("app.sql"));
  await db.exec(sqlFile("metrics.sql"));
}
