import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

/**
 * The only database surface the foundation uses. Tests and local runs use
 * PGlite (Postgres compiled to WebAssembly, same SQL); the hosted app will
 * plug in node-postgres behind this same interface.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs one or more statements with no parameters. */
  exec(sql: string): Promise<void>;
  /** Runs `fn` in one transaction; rolls back if it throws. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// Postgres type OIDs whose default parsing we override: dates and timestamps
// stay as plain strings (India wall-clock), never shifted by a JS time zone.
const DATE_OID = 1082;
const TIMESTAMP_OID = 1114;
const INT8_OID = 20;
const NUMERIC_OID = 1700;

interface Conn {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}

function wrap(conn: Conn, root?: PGlite): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await conn.query<T>(sql, params);
      return res.rows;
    },
    async exec(sql: string) {
      await conn.exec(sql);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      if (!root) return fn(wrap(conn)); // already inside a transaction
      return root.transaction((tx) => fn(wrap(tx)));
    },
    async close() {
      if (root) await root.close();
    },
  };
}

/** An in-memory Postgres for tests, or a persistent one when `dataDir` is given. */
export async function openPglite(dataDir?: string): Promise<Db> {
  const lite = await PGlite.create(dataDir, {
    parsers: {
      [DATE_OID]: (v: string) => v,
      [TIMESTAMP_OID]: (v: string) => v,
      [INT8_OID]: (v: string) => Number(v),
      [NUMERIC_OID]: (v: string) => Number(v),
    },
  });
  return wrap(lite, lite);
}

/** A PostgreSQL server (the hosted app). Same parsing rules as PGlite. */
export async function openPostgres(connectionString: string): Promise<Db> {
  const pool = new pg.Pool({ connectionString, max: 5 });
  const types = {
    getTypeParser(oid: number, format?: "text" | "binary") {
      if (oid === DATE_OID || oid === TIMESTAMP_OID) return (v: string) => v;
      if (oid === INT8_OID || oid === NUMERIC_OID) return (v: string) => Number(v);
      return pg.types.getTypeParser(oid, format);
    },
  } as pg.CustomTypesConfig;

  const make = (client: pg.Pool | pg.PoolClient, inTransaction: boolean): Db => ({
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await client.query({ text: sql, values: params, types });
      return res.rows as T[];
    },
    async exec(sql: string) {
      // No values: node-postgres uses the simple protocol, which allows several statements.
      await client.query({ text: sql, types });
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      if (inTransaction) return fn(make(client, true));
      const c = await pool.connect();
      try {
        await c.query("begin");
        const out = await fn(make(c, true));
        await c.query("commit");
        return out;
      } catch (e) {
        await c.query("rollback");
        throw e;
      } finally {
        c.release();
      }
    },
    async close() {
      await pool.end();
    },
  });
  await pool.query("select 1"); // fail fast on a bad connection string
  return make(pool, false);
}
