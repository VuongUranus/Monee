import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyServerOptions } from "fastify";
import cookie from "@fastify/cookie";
import type { StoredFinancePayload } from "@chi-tieu/shared";
import "./context.js";
import { createConfig, type AppEnvironment } from "./lib/config.js";
import { JsonUserRepository, type UserDataRepository } from "./lib/repository.js";
import { SessionManager } from "./lib/session.js";
import { createMarketService, type FetchLike, type MarketService } from "./services/market.js";
import { authRoutes } from "./routes/auth.js";
import { dataRoutes } from "./routes/data.js";
import { marketRoutes } from "./routes/market.js";
import { webRoutes } from "./routes/web.js";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultWorkspaceRoot = path.resolve(sourceDirectory, "../../..");

export interface BuildAppOptions {
  workspaceRoot?: string;
  databasePath?: string;
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
    ...(options.databasePath ? { databasePath: options.databasePath } : {}),
    ...(options.webRoot ? { webRoot: options.webRoot } : {}),
    ...(options.host ? { host: options.host } : {}),
    ...(options.port !== undefined ? { port: options.port } : {}),
  });
  const now = options.now ?? (() => Date.now());
  const randomBytes = options.randomBytes ?? crypto.randomBytes;
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike);
  const repository = options.repository ?? new JsonUserRepository({
    databasePath: config.databasePath,
    now,
    randomBytes,
  });
  const sessions = new SessionManager({ config, now, randomBytes });
  const marketService = options.marketService ?? createMarketService({ fetchImpl, now });
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 5 * 1024 * 1024,
  });

  app.decorate("finance", { config, repository, sessions, marketService, fetchImpl });
  await app.register(cookie);
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    return payload;
  });
  app.setErrorHandler(async (caught, _request, reply) => {
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
      "/api/market/quotes",
    ]);
    if (known.has(request.url.split("?")[0] ?? "")) {
      return reply.code(405).type("text/plain").send("Method not allowed");
    }
    if (request.url === "/data.json") return reply.code(403).type("text/plain").send("Forbidden");
    return reply.code(404).type("text/plain").send("Not found");
  });

  return app;
}

export function asStoredPayload(value: unknown): StoredFinancePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Data must be a JSON object");
  return value as StoredFinancePayload;
}
