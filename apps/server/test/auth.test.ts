import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { createDefaultStore } from "@chi-tieu/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/application.js";
import { parseDotEnv } from "../src/lib/config.js";
import { SESSION_TTL_MS } from "../src/lib/session.js";
import type { FetchLike } from "../src/services/market.js";
import { createPostgresTestContext, type PostgresTestContext } from "./postgres.js";

const temporaryDirectories: string[] = [];
let lastTokenBody = "";
let postgres: PostgresTestContext;

beforeAll(async () => {
  postgres = await createPostgresTestContext();
}, 120_000);

afterAll(async () => {
  await postgres?.close();
}, 120_000);

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const fakeGoogleFetch: FetchLike = async (input, options = {}) => {
  const target = String(input);
  if (target === "https://oauth2.googleapis.com/token") {
    lastTokenBody = String(options.body);
    const code = new URLSearchParams(String(options.body)).get("code");
    return { ok: true, status: 200, json: async () => ({ access_token: code }) };
  }
  if (target === "https://openidconnect.googleapis.com/v1/userinfo") {
    const token = new Headers(options.headers).get("Authorization")?.replace("Bearer ", "") ?? "";
    const profiles: Record<string, unknown> = {
      alice: { sub: "google-alice", email: "alice@example.com", email_verified: true, name: "Alice" },
      bob: { sub: "google-bob", email: "bob@example.com", email_verified: true, name: "Bob" },
      unverified: { sub: "google-unverified", email: "no@example.com", email_verified: false },
    };
    const profile = profiles[token];
    return { ok: Boolean(profile), status: profile ? 200 : 404, json: async () => profile ?? {} };
  }
  throw new Error(`Unexpected Google request: ${target}`);
};

async function withApp(
  _initialData: unknown,
  run: (context: { app: FastifyInstance }) => Promise<void>,
  env: NodeJS.ProcessEnv = {},
  options: { now?: () => number } = {},
): Promise<void> {
  await postgres.reset();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "finance-auth-"));
  temporaryDirectories.push(directory);
  const app = await buildApp({
    workspaceRoot: directory,
    repository: postgres.repository,
    serveWeb: false,
    env: {
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      SESSION_SECRET: "test-session-secret",
      APP_BASE_URL: "http://127.0.0.1:3000",
      ...env,
    },
    fetchImpl: fakeGoogleFetch,
    ...(options.now ? { now: options.now } : {}),
  });
  try {
    await run({ app });
  } finally {
    await app.close();
  }
}

function cookiePair(header: string | string[] | undefined, name: string): string {
  const values = Array.isArray(header) ? header : [header ?? ""];
  const match = values.find((value) => value.startsWith(`${name}=`));
  if (!match) throw new Error(`Missing cookie ${name}`);
  return match.split(";")[0]!;
}

async function login(app: FastifyInstance, code: string, returnTo = "/funds"): Promise<string> {
  const start = await app.inject({ method: "GET", url: `/api/auth/google?returnTo=${encodeURIComponent(returnTo)}` });
  expect(start.statusCode).toBe(302);
  const state = new URL(start.headers.location!).searchParams.get("state")!;
  const stateCookie = cookiePair(start.headers["set-cookie"], "finance_oauth_state");
  const callback = await app.inject({
    method: "GET",
    url: `/api/auth/google/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`,
    headers: { cookie: stateCookie },
  });
  expect(callback.statusCode).toBe(302);
  return cookiePair(callback.headers["set-cookie"], "finance_session");
}

describe("Fastify API tương thích server cũ", () => {
  it("đọc cấu hình .env, giữ nguyên chuỗi có dấu # trong ngoặc kép", () => {
    expect(parseDotEnv("# ghi chú\nPORT=3100\nSESSION_SECRET='abc#123'\nAPP_BASE_URL=https://example.com # production\n")).toEqual({
      PORT: "3100",
      SESSION_SECRET: "abc#123",
      APP_BASE_URL: "https://example.com",
    });
  });

  it("dùng PKCE, cookie an toàn và chỉ cho phép returnTo trong whitelist", async () => {
    lastTokenBody = "";
    await withApp({ years: {} }, async ({ app }) => {
      const start = await app.inject({
        method: "GET",
        url: "/api/auth/google?returnTo=https%3A%2F%2Fevil.example",
      });
      const authorize = new URL(start.headers.location!);
      const challenge = authorize.searchParams.get("code_challenge")!;
      expect(authorize.origin).toBe("https://accounts.google.com");
      expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
      expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const state = authorize.searchParams.get("state")!;
      const stateHeaders = Array.isArray(start.headers["set-cookie"]) ? start.headers["set-cookie"] : [start.headers["set-cookie"]!];
      const stateHeader = stateHeaders.find((value) => value.startsWith("finance_oauth_state="))!;
      expect(stateHeader).toContain("HttpOnly");
      expect(stateHeader).toContain("SameSite=Lax");
      expect(stateHeader).toContain("Secure");
      expect(stateHeader).toContain("Max-Age=600");

      const callback = await app.inject({
        method: "GET",
        url: `/api/auth/google/callback?state=${encodeURIComponent(state)}&code=alice`,
        headers: { cookie: cookiePair(start.headers["set-cookie"], "finance_oauth_state") },
      });
      expect(callback.statusCode).toBe(302);
      expect(callback.headers.location).toBe("/expenses");
      const verifier = new URLSearchParams(lastTokenBody).get("code_verifier")!;
      expect(crypto.createHash("sha256").update(verifier).digest("base64url")).toBe(challenge);
      const sessionHeaders = Array.isArray(callback.headers["set-cookie"]) ? callback.headers["set-cookie"] : [callback.headers["set-cookie"]!];
      const sessionHeader = sessionHeaders.find((value) => value.startsWith("finance_session="))!;
      expect(sessionHeader).toContain("HttpOnly");
      expect(sessionHeader).toContain("SameSite=Lax");
      expect(sessionHeader).toContain("Secure");
      expect(sessionHeader).toContain(`Max-Age=${SESSION_TTL_MS / 1000}`);
    }, { APP_BASE_URL: "https://finance.example" });
  });

  it("từ chối cookie phiên bị sửa và phiên đã quá TTL", async () => {
    let clock = 10_000;
    await withApp({ years: {} }, async ({ app }) => {
      const id = app.finance.sessions.createSession({
        sub: "session-user",
        email: "session@example.com",
        name: "Session User",
        picture: "",
      });
      const signed = app.finance.sessions.signedSessionValue(id);
      const validCookie = `finance_session=${signed}`;
      expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: validCookie } })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: `${validCookie}x` } })).statusCode).toBe(401);
      clock += SESSION_TTL_MS;
      expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: validCookie } })).statusCode).toBe(401);
    }, {}, { now: () => clock });
  });

  it("chặn API riêng tư khi chưa đăng nhập và báo cấu hình OAuth thiếu", async () => {
    await withApp({ years: { "2026": {} } }, async ({ app }) => {
      const data = await app.inject({ method: "GET", url: "/api/data" });
      expect(data.statusCode).toBe(401);
      expect(data.json()).toEqual({ error: "unauthorized", message: "Vui lòng đăng nhập để tiếp tục." });
      expect((await app.inject({ method: "GET", url: "/data.json" })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: "/api/market/quotes", payload: {} })).statusCode).toBe(401);
    });
    await withApp({ years: {} }, async ({ app }) => {
      expect((await app.inject({ method: "GET", url: "/api/auth/google" })).statusCode).toBe(503);
    }, { SESSION_SECRET: "" });
  });

  it("trang gốc chuyển tới trang chi tiêu", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "finance-web-"));
    temporaryDirectories.push(directory);
    const webRoot = path.join(directory, "web");
    await fs.mkdir(path.join(webRoot, "dist", "client"), { recursive: true });
    await fs.writeFile(path.join(webRoot, "dist", "client", "index.html"), "<div data-page-link=\"statistics\"></div>");
    const app = await buildApp({
      workspaceRoot: directory,
      webRoot,
      repository: postgres.repository,
      env: {},
    });
    try {
      const response = await app.inject({ method: "GET", url: "/" });
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/expenses");
    } finally {
      await app.close();
    }
  });

  it("trang thống kê được phục vụ và giữ đường dẫn sau đăng nhập", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "finance-web-"));
    temporaryDirectories.push(directory);
    const webRoot = path.join(directory, "web");
    await fs.mkdir(path.join(webRoot, "dist", "client"), { recursive: true });
    await fs.writeFile(path.join(webRoot, "dist", "client", "index.html"), "<div data-page-link=\"statistics\"></div>");
    await postgres.reset();
    const app = await buildApp({
      workspaceRoot: directory,
      webRoot,
      repository: postgres.repository,
      env: {
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
        SESSION_SECRET: "test-session-secret",
        APP_BASE_URL: "http://127.0.0.1:3000",
      },
      fetchImpl: fakeGoogleFetch,
    });
    try {
      const statistics = await app.inject({ method: "GET", url: "/statistics" });
      expect(statistics.statusCode).toBe(200);
      expect(statistics.body).toContain("data-page-link=\"statistics\"");
      const start = await app.inject({ method: "GET", url: "/api/auth/google?returnTo=%2Fstatistics" });
      const state = new URL(start.headers.location!).searchParams.get("state")!;
      const callback = await app.inject({
        method: "GET",
        url: `/api/auth/google/callback?state=${state}&code=alice`,
        headers: { cookie: cookiePair(start.headers["set-cookie"], "finance_oauth_state") },
      });
      expect(callback.statusCode).toBe(302);
      expect(callback.headers.location).toBe("/statistics");
    } finally {
      await app.close();
    }
  });

  it("mỗi tài khoản Google có workspace PostgreSQL riêng và import dùng revision", async () => {
    const legacy = createDefaultStore();
    legacy.years["2026"]!.income[0] = 123;
    await withApp(legacy, async ({ app }) => {
      const aliceCookie = await login(app, "alice");
      const initialAlice = (await app.inject({ method: "GET", url: "/api/data", headers: { cookie: aliceCookie } })).json();
      expect(initialAlice.workspaceRevision).toBe(1);
      expect(initialAlice.user.email).toBe("alice@example.com");
      expect(initialAlice).not.toHaveProperty("data");
      expect(initialAlice).not.toHaveProperty("sharedFunds");
      expect(Buffer.byteLength(JSON.stringify(initialAlice))).toBeLessThan(5 * 1024);

      const imported = await app.inject({
        method: "PUT",
        url: "/api/data/import",
        headers: { cookie: aliceCookie },
        payload: { expectedRevision: initialAlice.workspaceRevision, data: legacy },
      });
      expect(imported.statusCode).toBe(200);
      expect(imported.json().workspaceRevision).toBe(2);
      expect(imported.json()).not.toHaveProperty("data");
      const aliceBackup = (await app.inject({
        method: "GET",
        url: "/api/backup/export",
        headers: { cookie: aliceCookie },
      })).json();
      expect(aliceBackup.years["2026"].income[0]).toBe(123);

      const bobCookie = await login(app, "bob", "/expenses");
      const bobWorkspace = (await app.inject({ method: "GET", url: "/api/data", headers: { cookie: bobCookie } })).json();
      expect(bobWorkspace.workspaceRevision).toBe(1);
      expect(bobWorkspace.preferences.onboarding.status).toBe("pending");
      const bobBackup = (await app.inject({
        method: "GET",
        url: "/api/backup/export",
        headers: { cookie: bobCookie },
      })).json();
      expect(bobBackup.years["2026"]?.income[0] ?? 0).toBe(0);
      expect((await app.inject({
        method: "GET",
        url: "/api/backup/export",
        headers: { cookie: aliceCookie },
      })).json().years["2026"].income[0]).toBe(123);

      expect((await app.inject({
        method: "PUT",
        url: "/api/data/import",
        headers: { cookie: aliceCookie },
        payload: { expectedRevision: 1, data: legacy },
      })).statusCode).toBe(409);
    });
  });

  it("xác thực state, email Google và logout", async () => {
    await withApp({ years: {} }, async ({ app }) => {
      expect((await app.inject({ method: "GET", url: "/api/auth/google/callback?state=nope&code=alice" })).statusCode).toBe(400);

      const deniedStart = await app.inject({ method: "GET", url: "/api/auth/google" });
      const deniedState = new URL(deniedStart.headers.location!).searchParams.get("state")!;
      const denied = await app.inject({
        method: "GET",
        url: `/api/auth/google/callback?state=${deniedState}&error=access_denied`,
        headers: { cookie: cookiePair(deniedStart.headers["set-cookie"], "finance_oauth_state") },
      });
      expect(denied.statusCode).toBe(400);

      const profileStart = await app.inject({ method: "GET", url: "/api/auth/google" });
      const state = new URL(profileStart.headers.location!).searchParams.get("state")!;
      const unverified = await app.inject({
        method: "GET",
        url: `/api/auth/google/callback?state=${state}&code=unverified`,
        headers: { cookie: cookiePair(profileStart.headers["set-cookie"], "finance_oauth_state") },
      });
      expect(unverified.statusCode).toBe(401);

      const sessionCookie = await login(app, "alice");
      expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: sessionCookie } })).json().user.email).toBe("alice@example.com");
      const logout = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: sessionCookie } });
      expect(logout.statusCode).toBe(204);
      expect(String(logout.headers["set-cookie"])).toContain("Max-Age=0");
      expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: sessionCookie } })).statusCode).toBe(401);
    });
  });
});
