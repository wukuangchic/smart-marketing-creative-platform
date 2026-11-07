import "dotenv/config";
import { Pool, type QueryResultRow } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var creativePool: Pool | undefined;
}

export const pool = globalThis.creativePool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 12,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: true } : undefined,
});

if (process.env.NODE_ENV !== "production") globalThis.creativePool = pool;

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
  return pool.query<T>(text, values);
}
