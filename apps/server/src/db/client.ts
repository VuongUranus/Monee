import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export type FinanceDatabase = NodePgDatabase<typeof schema>;

export interface DatabaseClient {
  pool: Pool;
  db: FinanceDatabase;
}

export function createDatabaseClient(connectionString: string): DatabaseClient {
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return { pool, db: drizzle({ client: pool, schema }) };
}
