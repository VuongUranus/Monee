import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";
import { loadEnvironment } from "./src/lib/config.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(directory, "../..");
const env = loadEnvironment(workspaceRoot);
const url = env.DATABASE_MIGRATION_URL || env.DATABASE_URL;

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Schema generation is local-only; migrate/import scripts still require a real direct URL.
  dbCredentials: { url: url || "postgresql://localhost/schema_generation_only" },
  strict: true,
  verbose: true,
});
