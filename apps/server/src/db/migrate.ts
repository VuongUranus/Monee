import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabaseClient } from "./client.js";
import { loadEnvironment } from "../lib/config.js";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(sourceDirectory, "../../../..");
const migrationsFolder = path.resolve(sourceDirectory, "../../drizzle");
const env = loadEnvironment(workspaceRoot);
const connectionString = env.DATABASE_MIGRATION_URL;

if (!connectionString) throw new Error("DATABASE_MIGRATION_URL direct là bắt buộc.");

const { db, pool } = createDatabaseClient(connectionString);
try {
  await migrate(db, { migrationsFolder });
  console.log("Đã áp dụng migration PostgreSQL.");
} finally {
  await pool.end();
}
