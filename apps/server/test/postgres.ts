import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { Pool } from "pg";
import type { StoredFinancePayload, UserProfile } from "@chi-tieu/shared";
import { createDatabaseClient, type DatabaseClient } from "../src/db/client.js";
import { PostgresUserRepository } from "../src/lib/postgres-repository.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(directory, "../drizzle");
let containerPromise: Promise<StartedTestContainer> | undefined;

async function connectionString(): Promise<string> {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  containerPromise ??= new GenericContainer("postgres:17-alpine")
    .withEnvironment({
      POSTGRES_USER: "postgres",
      POSTGRES_PASSWORD: "test",
      POSTGRES_DB: "chi_tieu_test",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage("database system is ready to accept connections", 2))
    .start();
  const container = await containerPromise;
  return `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/chi_tieu_test`;
}

export interface PostgresTestContext {
  client: DatabaseClient;
  repository: PostgresUserRepository;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createPostgresTestContext(): Promise<PostgresTestContext> {
  const adminUrl = await connectionString();
  const databaseName = `finance_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const adminPool = new Pool({ connectionString: adminUrl, max: 1 });
  await adminPool.query(`create database "${databaseName}"`);
  const targetUrl = new URL(adminUrl);
  targetUrl.pathname = `/${databaseName}`;
  const client = createDatabaseClient(targetUrl.toString());
  await migrate(client.db, { migrationsFolder });
  return {
    client,
    repository: new PostgresUserRepository({ db: client.db }),
    async reset() {
      const result = await client.pool.query<{ tablename: string }>(
        "select tablename from pg_tables where schemaname = 'public'",
      );
      if (result.rows.length) {
        const names = result.rows.map((row) => `"${row.tablename.replaceAll("\"", "\"\"")}"`).join(", ");
        await client.pool.query(`truncate table ${names} restart identity cascade`);
      }
    },
    async close() {
      await client.pool.end();
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const active = await adminPool.query<{ count: string }>(
          "select count(*) from pg_stat_activity where datname = $1",
          [databaseName],
        );
        if (Number(active.rows[0]?.count ?? 0) === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await adminPool.query(`drop database if exists "${databaseName}"`);
      await adminPool.end();
    },
  };
}

export async function seedUser(
  context: PostgresTestContext,
  profile: UserProfile,
  data: StoredFinancePayload,
): Promise<number> {
  await context.repository.provisionUser(profile);
  await context.repository.replaceUserData(profile.sub, 1, data);
  return 2;
}
