import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyServerOptions } from "fastify";
import cookie from "@fastify/cookie";
import compress from "@fastify/compress";
import type { StoredFinancePayload } from "@chi-tieu/shared";
import "./context.js";
import { createConfig, type AppEnvironment } from "./lib/config.js";
import { SharedFundError, type UserDataRepository } from "./lib/repository.js";
import { PostgresUserRepository } from "./lib/postgres-repository.js";
import { createDatabaseClient } from "./db/client.js";
import { SessionManager } from "./lib/session.js";
import { createMarketService, type FetchLike, type MarketService } from "./services/market.js";
import { authRoutes } from "./routes/auth.js";
import { dataRoutes } from "./routes/data.js";
import { marketRoutes } from "./routes/market.js";
import { webRoutes } from "./routes/web.js";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultWorkspaceRoot = path.resolve(sourceDirectory, "../../..");

function isDirectNeonUrl(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    return url.hostname.endsWith(".neon.tech") && !url.hostname.split(".")[0]?.endsWith("-pooler");
  } catch {
    return false;
  }
}

export interface BuildAppOptions {
  app?: FastifyInstance;
  workspaceRoot?: string;
  databaseUrl?: string;
  webRoot?: string;
  host?: string;
  port?: number;
  env?: AppEnvironment;
  fetchImpl?: FetchLike;
  marketService?: MarketService;
  repository?: UserDataRepository;
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
  logger?: FastifyServerOptions["logger"];
  serveWeb?: boolean;
  development?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const workspaceRoot = options.workspaceRoot ?? defaultWorkspaceRoot;
  const env = options.env ?? process.env;
  const config = createConfig(workspaceRoot, env, {
    ...(options.databaseUrl ? { databaseUrl: options.databaseUrl } : {}),
    ...(options.webRoot ? { webRoot: options.webRoot } : {}),
    ...(options.host ? { host: options.host } : {}),
    ...(options.port !== undefined ? { port: options.port } : {}),
  });
  const now = options.now ?? (() => Date.now());
  const randomBytes = options.randomBytes ?? crypto.randomBytes;
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike);
  const databaseClient = options.repository ? null : (() => {
    if (!config.databaseUrl) throw new Error("DATABASE_URL là bắt buộc khi không truyền repository.");
    return createDatabaseClient(config.databaseUrl);
  })();
  const repository = options.repository ?? new PostgresUserRepository({
    db: databaseClient!.db,
    now,
    randomBytes,
  });
  const requestMetrics = new AsyncLocalStorage<{ dbDurationMs: number }>();
  const measuredRepository = new Proxy(repository, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        const startedAt = performance.now();
        try {
          return await value.apply(target, args);
        } finally {
          const metrics = requestMetrics.getStore();
          if (metrics) metrics.dbDurationMs += performance.now() - startedAt;
        }
      };
    },
  }) as UserDataRepository;
  const sessions = new SessionManager({ config, now, randomBytes });
  const marketService = options.marketService ?? createMarketService({ fetchImpl, now });
  const app = options.app ?? Fastify({
    logger: options.logger ?? false,
    bodyLimit: 5 * 1024 * 1024,
  });
  const requestStartedAt = new WeakMap<object, number>();
  if (databaseClient && isDirectNeonUrl(config.databaseUrl)) {
    app.log.warn("DATABASE_URL đang dùng Neon direct endpoint; hãy dùng hostname có -pooler cho Fastify runtime.");
  }

  app.decorate("finance", { config, repository: measuredRepository, sessions, marketService, fetchImpl });
  if (databaseClient) {
    app.addHook("onReady", async () => {
      await databaseClient.pool.query("select 1");
    });
    app.addHook("onClose", async () => {
      await databaseClient.pool.end();
    });
  }
  await app.register(cookie);
  await app.register(compress, {
    threshold: 1024,
    encodings: ["br", "gzip", "deflate"],
  });
  app.addHook("onRequest", (request, _reply, done) => {
    requestStartedAt.set(request, performance.now());
    requestMetrics.run({ dbDurationMs: 0 }, done);
  });
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/api/")) {
      const duration = performance.now() - (requestStartedAt.get(request) ?? performance.now());
      const dbDuration = requestMetrics.getStore()?.dbDurationMs ?? 0;
      reply.header("Cache-Control", "no-store");
      reply.header("Server-Timing", `db;dur=${dbDuration.toFixed(1)}, app;dur=${duration.toFixed(1)}`);
      if (typeof payload === "string" || Buffer.isBuffer(payload)) {
        reply.header("X-Response-Bytes", String(Buffer.byteLength(payload)));
      }
    }
    return payload;
  });
  app.addHook("onResponse", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    const duration = performance.now() - (requestStartedAt.get(request) ?? performance.now());
    const dbDuration = requestMetrics.getStore()?.dbDurationMs ?? 0;
    app.log.info({
      route: request.routeOptions.url,
      statusCode: reply.statusCode,
      durationMs: Number(duration.toFixed(1)),
      dbDurationMs: Number(dbDuration.toFixed(1)),
      responseBytes: Number(reply.getHeader("X-Response-Bytes") ?? 0),
    }, "api_request_complete");
  });
  app.setErrorHandler(async (caught, _request, reply) => {
    if (caught instanceof SharedFundError) {
      return reply.code(caught.statusCode).send({ error: caught.code, message: caught.message });
    }
    const error = caught as FastifyError;
    if (error.statusCode === 413) return reply.code(413).type("text/plain").send("Request body is too large");
    if (error.statusCode === 400) return reply.code(400).type("text/plain").send("Invalid JSON");
    app.log.error(error);
    return reply.code(500).type("text/plain").send("Internal server error");
  });
  await app.register(authRoutes);
  await app.register(dataRoutes);
  await app.register(marketRoutes);

  if (options.serveWeb !== false) {
    await app.register(webRoutes, { development: options.development === true });
  }

  app.setNotFoundHandler(async (request, reply) => {
    const known = new Set([
      "/api/auth/me",
      "/api/auth/google",
      "/api/auth/google/callback",
      "/api/auth/logout",
      "/api/data",
      "/api/data/import",
      "/api/backup/export",
      "/api/expenses/config",
      "/api/expenses/summary",
      "/api/transactions",
      "/api/funds/overview",
      "/api/statistics",
      "/api/shared-funds",
      "/api/market/quotes",
    ]);
    if (known.has(request.url.split("?")[0] ?? "")) {
      return reply.code(405).type("text/plain").send("Method not allowed");
    }
    return reply.code(404).type("text/plain").send("Not found");
  });

  return app;
}

export function asStoredPayload(value: unknown): StoredFinancePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Data must be a JSON object");
  return value as StoredFinancePayload;
}
