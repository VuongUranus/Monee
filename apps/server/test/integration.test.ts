import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  MarketQuotesResponse,
  UserDatabase,
  UserProfile,
} from "@chi-tieu/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { JsonUserRepository } from "../src/lib/repository.js";
import type { MarketService } from "../src/services/market.js";

const temporaryDirectories: string[] = [];
const profile: UserProfile = {
  sub: "integration-user",
  email: "integration@example.com",
  name: "Integration User",
  picture: "",
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function createDatabase(initialData: Record<string, unknown> = {}): Promise<{ directory: string; databasePath: string }> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "finance-integration-"));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, "data.json");
  const timestamp = new Date(0).toISOString();
  const database: UserDatabase = {
    schemaVersion: 3,
    users: {
      [profile.sub]: {
        profile,
        data: initialData,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
  };
  await fs.writeFile(databasePath, JSON.stringify(database), "utf8");
  return { directory, databasePath };
}

async function createAuthenticatedApp(options: {
  initialData?: Record<string, unknown>;
  marketService?: MarketService;
} = {}): Promise<{ app: FastifyInstance; cookie: string; databasePath: string; directory: string }> {
  const { directory, databasePath } = await createDatabase(options.initialData);
  const app = await buildApp({
    workspaceRoot: directory,
    databasePath,
    serveWeb: false,
    env: {
      SESSION_SECRET: "integration-session-secret-at-least-twenty-bytes",
      APP_BASE_URL: "http://127.0.0.1:3000",
    },
    ...(options.marketService ? { marketService: options.marketService } : {}),
  });
  const sessionId = app.finance.sessions.createSession(profile);
  const cookie = `finance_session=${app.finance.sessions.signedSessionValue(sessionId)}`;
  return { app, cookie, databasePath, directory };
}

describe("repository JSON", () => {
  it("tuần tự hóa ghi đồng thời, luôn để lại JSON hoàn chỉnh và không sót file tạm", async () => {
    const { databasePath, directory } = await createDatabase({ revision: -1 });
    let suffix = 0;
    const repository = new JsonUserRepository({
      databasePath,
      now: () => suffix,
      randomBytes: () => Buffer.from(String(suffix++).padStart(12, "0")),
    });

    await Promise.all(Array.from({ length: 20 }, (_, revision) =>
      repository.saveUserData(profile.sub, { revision, payload: "x".repeat(revision * 100) })));

    expect(await repository.getUserData(profile.sub)).toMatchObject({ revision: 19 });
    const stored = JSON.parse(await fs.readFile(databasePath, "utf8")) as UserDatabase;
    expect(stored.users[profile.sub]?.data).toMatchObject({ revision: 19 });
    expect((await fs.readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});

describe("Fastify data và market routes", () => {
  it("chia sẻ quỹ theo email, áp quyền và phát hiện xung đột revision", async () => {
    const initialData = {
      funds: [{ id: "joint", name: "Quỹ chung", color: "#123456", cat: "saving" }],
      years: { "2026": { income: new Array(12).fill(0), funds: { joint: new Array(12).fill(100) }, details: { joint: new Array(12).fill(null) }, notes: new Array(12).fill("") } },
      goals: { joint: { years: { "2026": 1000 }, all: 2000 } },
      financialProfile: { fundPlan: { joint: 50 }, openingBalances: { joint: 20 } },
    };
    const { app, cookie, databasePath } = await createAuthenticatedApp({ initialData });
    const bob: UserProfile = { sub: "integration-bob", email: "bob@example.com", name: "Bob", picture: "" };
    const database = JSON.parse(await fs.readFile(databasePath, "utf8")) as UserDatabase;
    database.users[bob.sub] = { profile: bob, data: { onboarding: { status: "pending", version: 1 } }, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() };
    await fs.writeFile(databasePath, JSON.stringify(database), "utf8");
    const bobSession = app.finance.sessions.createSession(bob);
    const bobCookie = `finance_session=${app.finance.sessions.signedSessionValue(bobSession)}`;
    try {
      const created = await app.inject({ method: "POST", url: "/api/shared-funds", headers: { cookie }, payload: { fundId: "joint", email: bob.email, role: "viewer" } });
      expect(created.statusCode).toBe(200);
      const shared = created.json();
      expect(shared.content.fund.id).toBe(shared.id);
      expect((await app.inject({ method: "GET", url: "/api/data", headers: { cookie } })).json().data.funds).toEqual([]);
      expect((await app.inject({ method: "GET", url: "/api/data", headers: { cookie: bobCookie } })).json().sharedFunds).toHaveLength(1);
      expect((await app.inject({ method: "PUT", url: `/api/shared-funds/${shared.id}`, headers: { cookie: bobCookie }, payload: { revision: 1, content: shared.content } })).statusCode).toBe(403);

      const upgraded = await app.inject({ method: "PUT", url: `/api/shared-funds/${shared.id}/members`, headers: { cookie }, payload: { email: bob.email, role: "editor" } });
      expect(upgraded.statusCode).toBe(200);
      const contribution = await app.inject({ method: "POST", url: `/api/shared-funds/${shared.id}/contributions`, headers: { cookie: bobCookie }, payload: { month: "2026-07", amount: 250_000, note: "Góp quỹ" } });
      expect(contribution.statusCode).toBe(200);
      expect(contribution.json().content.contributions["2026-07"]).toEqual([expect.objectContaining({ memberId: bob.sub, amount: 250_000, note: "Góp quỹ" })]);
      const editable = (await app.inject({ method: "GET", url: "/api/data", headers: { cookie: bobCookie } })).json().sharedFunds[0];
      const saved = await app.inject({ method: "PUT", url: `/api/shared-funds/${shared.id}`, headers: { cookie: bobCookie }, payload: { revision: editable.revision, content: editable.content } });
      expect(saved.statusCode).toBe(200);
      expect((await app.inject({ method: "PUT", url: `/api/shared-funds/${shared.id}`, headers: { cookie: bobCookie }, payload: { revision: editable.revision, content: editable.content } })).statusCode).toBe(409);
      expect((await app.inject({ method: "DELETE", url: `/api/shared-funds/${shared.id}/members/${bob.sub}`, headers: { cookie } })).statusCode).toBe(204);
      expect((await app.inject({ method: "GET", url: "/api/data", headers: { cookie: bobCookie } })).json().sharedFunds).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("chấp nhận object cũ, giữ thứ tự PUT và trả no-store", async () => {
    const { app, cookie } = await createAuthenticatedApp({ initialData: { revision: 0 } });
    try {
      const [first, second] = await Promise.all([
        app.inject({ method: "PUT", url: "/api/data", headers: { cookie }, payload: { revision: 1 } }),
        app.inject({ method: "PUT", url: "/api/data", headers: { cookie }, payload: { revision: 2 } }),
      ]);
      expect(first.statusCode).toBe(204);
      expect(second.statusCode).toBe(204);

      const read = await app.inject({ method: "GET", url: "/api/data", headers: { cookie } });
      expect(read.statusCode).toBe(200);
      expect(read.headers["cache-control"]).toBe("no-store");
      expect(read.json()).toEqual({ data: { revision: 2 }, sharedFunds: [] });
    } finally {
      await app.close();
    }
  });

  it("chặn JSON lỗi, payload không phải object, body quá 5 MiB và sai method", async () => {
    const { app, cookie } = await createAuthenticatedApp();
    try {
      const malformed = await app.inject({
        method: "PUT",
        url: "/api/data",
        headers: { cookie, "content-type": "application/json" },
        payload: "{\"broken\":",
      });
      expect(malformed.statusCode).toBe(400);
      expect(malformed.body).toBe("Invalid JSON");

      const array = await app.inject({ method: "PUT", url: "/api/data", headers: { cookie }, payload: [] });
      expect(array.statusCode).toBe(400);

      const oversized = await app.inject({
        method: "PUT",
        url: "/api/data",
        headers: { cookie, "content-type": "application/json" },
        payload: JSON.stringify({ value: "x".repeat(5 * 1024 * 1024) }),
      });
      expect(oversized.statusCode).toBe(413);
      expect(oversized.body).toBe("Request body is too large");

      const wrongMethod = await app.inject({ method: "POST", url: "/api/data", headers: { cookie }, payload: {} });
      expect(wrongMethod.statusCode).toBe(405);
    } finally {
      await app.close();
    }
  });

  it("chuyển request market đã xác thực tới service và giữ lỗi upstream trong response", async () => {
    let received: unknown;
    const response: MarketQuotesResponse = {
      fetchedAt: new Date(0).toISOString(),
      fx: null,
      gold: null,
      stocks: [],
      crypto: [],
      matches: {},
      errors: [{ key: "HOSE:VNM", code: "upstream", message: "Nguồn giá tạm thời lỗi." }],
    };
    const marketService: MarketService = {
      async getQuotes(request) {
        received = request;
        return response;
      },
    };
    const { app, cookie } = await createAuthenticatedApp({ marketService });
    try {
      const request = { assets: [{ type: "stock" as const, symbol: "VNM", exchange: "HOSE" }], force: true };
      const result = await app.inject({ method: "POST", url: "/api/market/quotes", headers: { cookie }, payload: request });
      expect(result.statusCode).toBe(200);
      expect(result.headers["cache-control"]).toBe("no-store");
      expect(received).toEqual(request);
      expect(result.json()).toEqual(response);
    } finally {
      await app.close();
    }
  });
});

describe("Fastify SPA production", () => {
  it("phục vụ bundle và deep link nhưng không lộ dotfile hay data.json", async () => {
    const { directory, databasePath } = await createDatabase();
    const webRoot = path.join(directory, "web");
    const distRoot = path.join(webRoot, "dist", "client");
    await fs.mkdir(path.join(distRoot, "assets"), { recursive: true });
    await fs.writeFile(path.join(distRoot, "index.html"), "<main>React production bundle</main>", "utf8");
    await fs.writeFile(path.join(distRoot, "assets", "app.js"), "globalThis.__APP__ = true;", "utf8");
    await fs.writeFile(path.join(distRoot, ".secret"), "not public", "utf8");

    const app = await buildApp({ workspaceRoot: directory, databasePath, webRoot, env: {} });
    try {
      for (const route of ["/funds", "/expenses", "/statistics"]) {
        const response = await app.inject({ method: "GET", url: route });
        expect(response.statusCode).toBe(200);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.body).toContain("React production bundle");
      }
      const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers["cache-control"]).toContain("immutable");
      expect((await app.inject({ method: "GET", url: "/.secret" })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/data.json" })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: "/outside.txt" })).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
