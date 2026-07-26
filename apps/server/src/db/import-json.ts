import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabaseClient } from "./client.js";
import { importUserDatabase, verifyUserDatabase } from "./data-migration.js";
import { loadEnvironment } from "../lib/config.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(directory, "../../../..");
const env = loadEnvironment(workspaceRoot);
const connectionString = env.DATABASE_MIGRATION_URL;
if (!connectionString) throw new Error("DATABASE_MIGRATION_URL direct là bắt buộc.");
const fileFlag = process.argv.indexOf("--file");
const fileArgument = fileFlag >= 0 ? process.argv[fileFlag + 1] ?? "" : "data.json";
const sourcePath = path.isAbsolute(fileArgument) ? fileArgument : path.resolve(workspaceRoot, fileArgument);
const source = await fs.readFile(sourcePath, "utf8");
const { db, pool } = createDatabaseClient(connectionString);
try {
  const summary = await importUserDatabase(db, source, sourcePath);
  const verification = await verifyUserDatabase(db, source);
  if (!verification.ok) throw new Error(`Đối soát thất bại: ${verification.differences.join(", ")}`);
  console.log(JSON.stringify({ ...summary, verified: true }, null, 2));
} finally {
  await pool.end();
}
