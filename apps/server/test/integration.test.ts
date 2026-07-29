import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  MarketQuotesResponse,
  StoredFinancePayload,
  UserDatabase,
  UserProfile,
} from "@chi-tieu/shared";
import { createDefaultStore } from "@chi-tieu/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/application.js";
import { importUserDatabase, verifyUserDatabase } from "../src/db/data-migration.js";
import * as schema from "../src/db/schema.js";
import type { MarketService } from "../src/services/market.js";
import type { AssistantService } from "../src/services/assistant.js";
import {
  createPostgresTestContext,
  seedUser,
  type PostgresTestContext,
} from "./postgres.js";

const profile: UserProfile = {
  sub: "integration-user",
  email: "integration@example.com",
  name: "Integration User",
  picture: "",
};
let postgres: PostgresTestContext;

beforeAll(async () => {
  postgres = await createPostgresTestContext();
}, 120_000);

afterAll(async () => {
  await postgres?.close();
}, 120_000);

async function createAuthenticatedApp(options: {
  initialData?: StoredFinancePayload;
  marketService?: MarketService;
  assistantService?: AssistantService;
} = {}): Promise<{ app: FastifyInstance; cookie: string }> {
  await postgres.reset();
  const initial = options.initialData ?? createDefaultStore() as unknown as StoredFinancePayload;
  await seedUser(postgres, profile, initial);
  const app = await buildApp({
    repository: postgres.repository,
    database: postgres.client.db,
    serveWeb: false,
    env: {
      SESSION_SECRET: "integration-session-secret-at-least-twenty-bytes",
      APP_BASE_URL: "http://127.0.0.1:3000",
      ...(options.assistantService ? { AI_ASSISTANT_ENABLED: "true" } : {}),
    },
    ...(options.marketService ? { marketService: options.marketService } : {}),
    ...(options.assistantService ? { assistantService: options.assistantService } : {}),
  });
  const sessionId = await app.finance.sessions.createSession(profile);
  const cookie = `finance_session=${app.finance.sessions.signedSessionValue(sessionId)}`;
  return { app, cookie };
}

describe("PostgreSQL repository", () => {
  it("khóa workspace revision để chỉ một mutation đồng thời được ghi", async () => {
    await postgres.reset();
    await postgres.repository.provisionUser(profile);
    const first = createDefaultStore();
    first.showGoals = true;
    const second = createDefaultStore();
    second.showGoals = false;

    const writes = await Promise.allSettled([
      postgres.repository.replaceUserData(profile.sub, 1, first as unknown as StoredFinancePayload),
      postgres.repository.replaceUserData(profile.sub, 1, second as unknown as StoredFinancePayload),
    ]);

    expect(writes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(writes.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await postgres.repository.getBootstrap(profile.sub)).toMatchObject({ workspaceRevision: 2 });
  });

  it("import JSON idempotent, đối soát semantic và từ chối checksum khác", async () => {
    await postgres.reset();
    const timestamp = new Date(0).toISOString();
    const database: UserDatabase = {
      schemaVersion: 4,
      users: {
        [profile.sub]: {
          profile,
          data: createDefaultStore() as unknown as StoredFinancePayload,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
      sharedFunds: {},
    };
    const source = JSON.stringify(database);
    const first = await importUserDatabase(postgres.client.db, source, "fixture.json");
    expect(first).toMatchObject({ alreadyImported: false, users: 1, funds: 4, transactions: 0 });
    expect(await verifyUserDatabase(postgres.client.db, source)).toEqual({ ok: true, differences: [] });
    expect(await importUserDatabase(postgres.client.db, source, "fixture.json")).toMatchObject({
      alreadyImported: true,
      checksum: first.checksum,
    });
    await expect(importUserDatabase(
      postgres.client.db,
      JSON.stringify({ ...database, schemaVersion: 3 }),
      "different.json",
    )).rejects.toThrow("từ chối ghi đè");
  });

  it("rollback toàn bộ batch khi một lệnh phía sau không hợp lệ", async () => {
    await postgres.reset();
    const initial = createDefaultStore();
    initial.expense.cats = [{ id: "food", name: "Ăn uống", color: "#E4572E", budget: 5_000_000 }];
    initial.expense.txns = [];
    await seedUser(postgres, profile, initial as unknown as StoredFinancePayload);
    const before = await postgres.repository.getBootstrap(profile.sub);
    await expect(postgres.repository.mutatePersonalResources(
      profile.sub,
      before.workspaceRevision,
      [
        {
          kind: "createTransaction",
          transaction: {
            id: "4a14a27e-c30d-437b-a918-53c1db4e0712",
            date: "2026-07-27",
            type: "expense",
            cat: "food",
            amount: 30_000,
            note: "Ăn sáng",
          },
        },
        {
          kind: "createTransaction",
          transaction: {
            id: "76258b67-a79c-413c-93f2-cf5bb6fe874c",
            date: "2026-07-27",
            type: "expense",
            cat: "missing-category",
            amount: 45_000,
            note: "Kem đánh răng",
          },
        },
      ],
    )).rejects.toMatchObject({ code: "category_not_found" });
    const [transactions, after] = await Promise.all([
      postgres.repository.getTransactions(profile.sub, {
        from: "2026-07-01",
        to: "2026-07-31",
        page: 1,
        pageSize: 10,
      }),
      postgres.repository.getBootstrap(profile.sub),
    ]);
    expect(transactions.total).toBe(0);
    expect(after.workspaceRevision).toBe(before.workspaceRevision);
  });
});

describe("Fastify CRUD, sharing và market routes", () => {
  it("tổng hợp overview nhiều năm mà không đổi contract và khử asset trùng", async () => {
    const initialData = createDefaultStore();
    initialData.funds = [
      { id: "reserve", name: "Dự phòng", color: "#3f7d5c", cat: "saving" },
      { id: "stocks", name: "Cổ phiếu", color: "#3b6ea5", cat: "stock" },
      { id: "gold", name: "Vàng", color: "#c8963e", cat: "gold" },
    ];
    initialData.years["2025"] = {
      income: new Array(12).fill(0),
      funds: {
        reserve: [100, ...new Array(11).fill(0)],
        stocks: [...new Array(11).fill(0), 400],
        gold: new Array(12).fill(0),
      },
      details: {
        reserve: new Array(12).fill(null),
        stocks: [...new Array(11).fill(null), { type: "hold", lots: [{ ticker: "VNM", exchange: "HOSE", qty: 1 }] }],
        gold: new Array(12).fill(null),
      },
      notes: new Array(12).fill(""),
    };
    initialData.years["2026"] = {
      income: new Array(12).fill(0),
      funds: {
        reserve: [200, ...new Array(11).fill(0)],
        stocks: [...new Array(6).fill(0), 500, ...new Array(5).fill(0)],
        gold: [...new Array(6).fill(0), 300, ...new Array(5).fill(0)],
      },
      details: {
        reserve: new Array(12).fill(null),
        stocks: [...new Array(6).fill(null), { type: "hold", lots: [{ ticker: "VNM", exchange: "HOSE", qty: 2 }] }, ...new Array(5).fill(null)],
        gold: [...new Array(6).fill(null), { type: "gold", lots: [{ chi: 1 }] }, ...new Array(5).fill(null)],
      },
      notes: new Array(12).fill(""),
    };
    const { app, cookie } = await createAuthenticatedApp({ initialData: initialData as unknown as StoredFinancePayload });
    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/funds/overview?year=2026&month=7",
        headers: { cookie },
      });
      expect(response.statusCode).toBe(200);
      const overview = response.json();
      expect(overview).toMatchObject({ year: 2026, month: 7, yearActiveMonths: 2, allTimeActiveMonths: 4 });
      expect(overview.funds).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "reserve", yearTotal: 200, allTimeTotal: 300 }),
        expect.objectContaining({ id: "stocks", yearTotal: 500, allTimeTotal: 900 }),
        expect.objectContaining({ id: "gold", yearTotal: 300, allTimeTotal: 300 }),
      ]));
      expect(overview.funds.find((fund: { id: string }) => fund.id === "stocks").yearAmounts[6]).toBe(500);
      expect(overview.marketAssets.filter((asset: { type: string; symbol?: string }) =>
        asset.type === "stock" && asset.symbol === "VNM")).toHaveLength(1);
      expect(overview.marketAssets).toContainEqual({ type: "gold" });
    } finally {
      await app.close();
    }
  });

  it("chia sẻ quỹ theo email, áp quyền và phát hiện xung đột revision", async () => {
    const initialData = {
      ...createDefaultStore(),
      funds: [{ id: "joint", name: "Quỹ chung", color: "#123456", cat: "saving" }],
      years: {
        "2026": {
          income: new Array(12).fill(0),
          funds: { joint: new Array(12).fill(100) },
          details: { joint: new Array(12).fill(null) },
          notes: new Array(12).fill(""),
        },
      },
      goals: { joint: { years: { "2026": 1000 }, all: 2000 } },
      financialProfile: {
        ...createDefaultStore().financialProfile,
        fundPlan: { joint: 50 },
        openingBalances: { joint: 20 },
      },
    } as StoredFinancePayload;
    const { app, cookie } = await createAuthenticatedApp({ initialData });
    const bob: UserProfile = { sub: "integration-bob", email: "bob@example.com", name: "Bob", picture: "" };
    await postgres.repository.provisionUser(bob);
    const bobSession = await app.finance.sessions.createSession(bob);
    const bobCookie = `finance_session=${app.finance.sessions.signedSessionValue(bobSession)}`;
    try {
      const ownerWorkspace = (await app.inject({ method: "GET", url: "/api/data", headers: { cookie } })).json();
      const created = await app.inject({
        method: "POST",
        url: "/api/shared-funds",
        headers: { cookie },
        payload: { fundId: "joint", email: bob.email, role: "viewer", expectedRevision: ownerWorkspace.workspaceRevision },
      });
      expect(created.statusCode).toBe(200);
      const shared = created.json().data;
      expect(shared).toEqual({ id: expect.stringMatching(/^shared-/), revision: 1 });
      const ownerAfterShare = created.json();
      const ownerBackup = (await app.inject({
        method: "GET",
        url: "/api/backup/export",
        headers: { cookie },
      })).json();
      expect(ownerBackup.funds).toEqual([]);
      const personalAfterShare = await app.inject({
        method: "POST",
        url: "/api/transactions",
        headers: { cookie },
        payload: {
          expectedRevision: ownerAfterShare.workspaceRevision,
          transaction: {
            id: "after-share",
            date: "2026-07-27",
            type: "expense",
            cat: "food",
            amount: 10_000,
            note: "Cá nhân sau chia sẻ",
          },
        },
      });
      expect(personalAfterShare.statusCode).toBe(200);
      expect(personalAfterShare.json().data).toEqual(expect.objectContaining({ id: "after-share" }));
      const bobOverview = (await app.inject({
        method: "GET",
        url: "/api/funds/overview?year=2026&month=7",
        headers: { cookie: bobCookie },
      })).json();
      expect(bobOverview.funds).toContainEqual(
        expect.objectContaining({ id: shared.id, role: "viewer" }),
      );

      const denied = await app.inject({
        method: "PATCH",
        url: `/api/shared-funds/${shared.id}`,
        headers: { cookie: bobCookie },
        payload: { revision: shared.revision, name: "Không được sửa" },
      });
      expect(denied.statusCode).toBe(403);

      const upgraded = await app.inject({
        method: "PUT",
        url: `/api/shared-funds/${shared.id}/members`,
        headers: { cookie },
        payload: { email: bob.email, role: "editor", revision: shared.revision },
      });
      expect(upgraded.statusCode).toBe(200);
      const contribution = await app.inject({
        method: "POST",
        url: `/api/shared-funds/${shared.id}/contributions`,
        headers: { cookie: bobCookie },
        payload: { month: "2026-07", amount: 250_000, note: "Góp quỹ", revision: upgraded.json().revision },
      });
      expect(contribution.statusCode).toBe(200);
      expect(contribution.json().data).toEqual(
        expect.objectContaining({ memberId: bob.sub, amount: 250_000, note: "Góp quỹ" }),
      );
      expect(Buffer.byteLength(contribution.body)).toBeLessThan(2 * 1024);
      const contributions = (await app.inject({
        method: "GET",
        url: `/api/shared-funds/${shared.id}/contributions?year=2026&month=7`,
        headers: { cookie: bobCookie },
      })).json();
      expect(contributions.items).toEqual([
        expect.objectContaining({ memberId: bob.sub, amount: 250_000, note: "Góp quỹ" }),
      ]);

      const editable = (await app.inject({
        method: "GET",
        url: "/api/funds/overview?year=2026&month=7",
        headers: { cookie: bobCookie },
      })).json().funds.find((fund: { id: string }) => fund.id === shared.id);
      const saved = await app.inject({
        method: "PUT",
        url: `/api/shared-funds/${shared.id}/months/2026/7`,
        headers: { cookie: bobCookie },
        payload: { revision: editable.revision, amount: 123_000 },
      });
      expect(saved.statusCode).toBe(200);
      const stale = await app.inject({
        method: "PUT",
        url: `/api/shared-funds/${shared.id}/months/2026/7`,
        headers: { cookie: bobCookie },
        payload: { revision: editable.revision, amount: 456_000 },
      });
      expect(stale.statusCode).toBe(409);

      expect((await app.inject({
        method: "DELETE",
        url: `/api/shared-funds/${shared.id}/members/${bob.sub}`,
        headers: { cookie },
        payload: { revision: saved.json().revision },
      })).statusCode).toBe(200);
      const afterRemoval = (await app.inject({
        method: "GET",
        url: "/api/funds/overview?year=2026&month=7",
        headers: { cookie: bobCookie },
      })).json();
      expect(afterRemoval.funds.some((fund: { id: string }) => fund.id === shared.id)).toBe(false);

      const ownerBeforeUnshare = (await app.inject({
        method: "GET",
        url: "/api/funds/overview?year=2026&month=7",
        headers: { cookie },
      })).json();
      const ownerShared = ownerBeforeUnshare.funds.find((fund: { id: string }) => fund.id === shared.id);
      const unshared = await app.inject({
        method: "POST",
        url: `/api/shared-funds/${shared.id}/unshare`,
        headers: { cookie },
        payload: { revision: ownerShared.revision },
      });
      expect(unshared.statusCode).toBe(200);
      expect(unshared.json()).toEqual(expect.objectContaining({
        data: { id: shared.id },
        workspaceRevision: ownerAfterShare.workspaceRevision + 2,
      }));
      const ownerAfterUnshare = (await app.inject({
        method: "GET",
        url: "/api/funds/overview?year=2026&month=7",
        headers: { cookie },
      })).json();
      const personalFund = ownerAfterUnshare.funds.find((fund: { id: string }) => fund.id === shared.id);
      expect(personalFund).toEqual(expect.objectContaining({ id: shared.id }));
      expect(personalFund.role).toBeUndefined();
      expect(personalFund.revision).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("ghi CRUD chi tiết, soft-delete danh mục lịch sử và trả 409 khi revision stale", async () => {
    const { app, cookie } = await createAuthenticatedApp();
    try {
      const initial = (await app.inject({ method: "GET", url: "/api/data", headers: { cookie } })).json();
      const created = await app.inject({
        method: "POST",
        url: "/api/transactions",
        headers: { cookie },
        payload: {
          expectedRevision: initial.workspaceRevision,
          transaction: {
            id: "txn-history",
            date: "2026-07-27",
            type: "expense",
            cat: "food",
            accountId: "cash",
            amount: 125_000,
            note: "Bữa trưa",
          },
        },
      });
      expect(created.statusCode).toBe(200);
      expect(created.headers["cache-control"]).toBe("no-store");
      const createdWorkspace = created.json();
      expect(createdWorkspace.workspaceRevision).toBe(initial.workspaceRevision + 1);
      expect(createdWorkspace.data).toEqual(expect.objectContaining({ id: "txn-history", amount: 125_000 }));
      expect(Buffer.byteLength(created.body)).toBeLessThan(2 * 1024);

      expect((await app.inject({
        method: "POST",
        url: "/api/transactions",
        headers: { cookie },
        payload: {
          expectedRevision: initial.workspaceRevision,
          transaction: {
            date: "2026-07-27",
            type: "expense",
            cat: "food",
            amount: 1,
            note: "",
          },
        },
      })).statusCode).toBe(409);

      const deleted = await app.inject({
        method: "DELETE",
        url: "/api/categories/expense/food",
        headers: { cookie },
        payload: { expectedRevision: createdWorkspace.workspaceRevision },
      });
      expect(deleted.statusCode).toBe(200);
      expect(deleted.json().data).toEqual({ deletedId: "food" });
      const config = (await app.inject({
        method: "GET",
        url: "/api/expenses/config",
        headers: { cookie },
      })).json();
      expect(config.categories.some((category: { id: string }) => category.id === "food")).toBe(false);
      const history = (await app.inject({
        method: "GET",
        url: "/api/transactions?from=2026-07-01&to=2026-07-31&page=1&pageSize=10",
        headers: { cookie },
      })).json();
      expect(history.items).toContainEqual(expect.objectContaining({ id: "txn-history", cat: "food" }));
    } finally {
      await app.close();
    }
  });

  it("trả snapshot summary và lịch sử ngay trong response CRUD giao dịch", async () => {
    const { app, cookie } = await createAuthenticatedApp();
    try {
      const initial = (await app.inject({ method: "GET", url: "/api/data", headers: { cookie } })).json();
      const before = (await app.inject({
        method: "GET",
        url: "/api/expenses/summary?year=2026&month=7",
        headers: { cookie },
      })).json();
      const expenseView = {
        year: 2026,
        month: 7,
        transactions: {
          from: "2026-07-01",
          to: "2026-07-31",
          type: "expense",
          q: "snapshot mutation",
          page: 1,
          pageSize: 10,
        },
      };
      const created = await app.inject({
        method: "POST",
        url: "/api/transactions",
        headers: { cookie },
        payload: {
          expectedRevision: initial.workspaceRevision,
          transaction: {
            id: "snapshot-mutation",
            date: "2026-07-27",
            type: "expense",
            cat: "food",
            amount: 125_000,
            note: "snapshot mutation",
          },
          expenseView,
        },
      });
      expect(created.statusCode).toBe(200);
      const createdData = created.json().data;
      expect(createdData).toMatchObject({
        transaction: { id: "snapshot-mutation", amount: 125_000 },
        summary: { year: 2026, month: 7, spent: before.spent + 125_000 },
        transactions: { total: 1, page: 1, pageSize: 10 },
      });
      expect(createdData.transactions.items).toEqual([
        expect.objectContaining({ id: "snapshot-mutation", note: "snapshot mutation" }),
      ]);

      const updated = await app.inject({
        method: "PUT",
        url: "/api/transactions/snapshot-mutation",
        headers: { cookie },
        payload: {
          expectedRevision: created.json().workspaceRevision,
          transaction: {
            date: "2026-07-26",
            type: "expense",
            cat: "food",
            amount: 275_000,
            note: "snapshot mutation updated",
          },
          expenseView,
        },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().data).toMatchObject({
        transaction: { id: "snapshot-mutation", amount: 275_000 },
        summary: { spent: before.spent + 275_000 },
        transactions: { total: 1 },
      });

      const deleted = await app.inject({
        method: "DELETE",
        url: "/api/transactions/snapshot-mutation",
        headers: { cookie },
        payload: { expectedRevision: updated.json().workspaceRevision, expenseView },
      });
      expect(deleted.statusCode).toBe(200);
      expect(deleted.json().data).toMatchObject({
        deletedId: "snapshot-mutation",
        summary: { spent: before.spent },
        transactions: { items: [], total: 0, page: 1, pageCount: 1 },
      });
    } finally {
      await app.close();
    }
  });

  it("bootstrap nhỏ, phân trang giao dịch và tổng hợp chi tiêu/thống kê ở PostgreSQL", async () => {
    const initialData = createDefaultStore();
    initialData.years["2026"]!.funds.dp![6] = 1_000_000;
    initialData.years["2026"]!.funds.dt![6] = 2_000_000;
    for (let day = 1; day <= 12; day += 1) {
      initialData.expense.txns.push({
        id: `expense-${day}`,
        date: `2026-07-${String(day).padStart(2, "0")}`,
        type: "expense",
        cat: "food",
        accountId: "cash",
        amount: day * 10_000,
        note: `Bữa trưa ${day}`,
      });
    }
    initialData.expense.txns.push({
      id: "salary-july",
      date: "2026-07-01",
      type: "income",
      cat: "salary",
      amount: 20_000_000,
      note: "Lương tháng 7",
    });
    const { app, cookie } = await createAuthenticatedApp({
      initialData: initialData as unknown as StoredFinancePayload,
    });
    try {
      const bootstrap = await app.inject({ method: "GET", url: "/api/data", headers: { cookie } });
      expect(bootstrap.statusCode).toBe(200);
      expect(bootstrap.json()).not.toHaveProperty("data");
      expect(bootstrap.json()).not.toHaveProperty("transactions");
      expect(Buffer.byteLength(bootstrap.body)).toBeLessThan(5 * 1024);
      expect(bootstrap.headers["server-timing"]).toMatch(/db;dur=.*app;dur=/);
      expect(Number(bootstrap.headers["x-response-bytes"])).toBe(Buffer.byteLength(bootstrap.body));

      const page = (await app.inject({
        method: "GET",
        url: "/api/transactions?from=2026-07-01&to=2026-07-31&type=expense&page=1&pageSize=10",
        headers: { cookie },
      })).json();
      expect(page).toMatchObject({ total: 12, page: 1, pageSize: 10, pageCount: 2 });
      expect(page.items).toHaveLength(10);
      expect(page.items[0].id).toBe("expense-12");
      const compressedPage = await app.inject({
        method: "GET",
        url: "/api/transactions?from=2026-07-01&to=2026-07-31&type=expense&page=1&pageSize=10",
        headers: { cookie, "accept-encoding": "gzip" },
      });
      expect(compressedPage.headers["content-encoding"]).toBe("gzip");
      const search = (await app.inject({
        method: "GET",
        url: "/api/transactions?from=2026-07-01&to=2026-07-31&q=trưa%201&page=1&pageSize=100",
        headers: { cookie },
      })).json();
      expect(search.total).toBe(4);

      const summary = (await app.inject({
        method: "GET",
        url: "/api/expenses/summary?year=2026&month=7",
        headers: { cookie },
      })).json();
      expect(summary).toMatchObject({
        income: 20_000_000,
        spent: 780_000,
        funds: 3_000_000,
        balance: 16_220_000,
      });
      expect(summary.accountExpenses).toEqual([
        expect.objectContaining({ name: "Tiền mặt", amount: 780_000 }),
      ]);

      const statistics = (await app.inject({
        method: "GET",
        url: "/api/statistics?mode=month&month=2026-07",
        headers: { cookie },
      })).json();
      expect(statistics.rows).toEqual([
        expect.objectContaining({
          key: "2026-07",
          income: 20_000_000,
          spent: 780_000,
          funds: 3_000_000,
          balance: 16_220_000,
        }),
      ]);
      expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThan(10 * 1024);
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(10 * 1024);
    } finally {
      await app.close();
    }
  });

  it("chỉ cập nhật hàng thay đổi, không tái tạo transaction, fund hoặc category không liên quan", async () => {
    const initialData = createDefaultStore();
    initialData.expense.txns.push({
      id: "stable-transaction",
      date: "2026-07-27",
      type: "expense",
      cat: "food",
      accountId: "cash",
      amount: 125_000,
      note: "Giữ nguyên UUID nội bộ",
    });
    const { app, cookie } = await createAuthenticatedApp({
      initialData: initialData as unknown as StoredFinancePayload,
    });
    try {
      const [transactionBefore] = await postgres.client.db.select().from(schema.transactions)
        .where(and(eq(schema.transactions.userId, profile.sub), eq(schema.transactions.externalId, "stable-transaction")));
      const [fundBefore] = await postgres.client.db.select().from(schema.funds)
        .where(and(eq(schema.funds.ownerId, profile.sub), eq(schema.funds.externalId, "dp")));
      const [categoryBefore] = await postgres.client.db.select().from(schema.financeCategories)
        .where(and(
          eq(schema.financeCategories.userId, profile.sub),
          eq(schema.financeCategories.type, "expense"),
          eq(schema.financeCategories.externalId, "food"),
        ));
      const workspace = (await app.inject({ method: "GET", url: "/api/data", headers: { cookie } })).json();
      const preferences = await app.inject({
        method: "PATCH",
        url: "/api/preferences",
        headers: { cookie },
        payload: { expectedRevision: workspace.workspaceRevision, showGoals: true },
      });
      expect(preferences.statusCode).toBe(200);
      const note = await app.inject({
        method: "PATCH",
        url: "/api/years/2026/months/7",
        headers: { cookie },
        payload: { expectedRevision: preferences.json().workspaceRevision, note: "Chỉ đổi ghi chú" },
      });
      expect(note.statusCode).toBe(200);

      const [transactionAfter] = await postgres.client.db.select().from(schema.transactions)
        .where(and(eq(schema.transactions.userId, profile.sub), eq(schema.transactions.externalId, "stable-transaction")));
      const [fundAfter] = await postgres.client.db.select().from(schema.funds)
        .where(and(eq(schema.funds.ownerId, profile.sub), eq(schema.funds.externalId, "dp")));
      const [categoryAfter] = await postgres.client.db.select().from(schema.financeCategories)
        .where(and(
          eq(schema.financeCategories.userId, profile.sub),
          eq(schema.financeCategories.type, "expense"),
          eq(schema.financeCategories.externalId, "food"),
        ));
      expect(transactionAfter?.id).toBe(transactionBefore?.id);
      expect(transactionAfter?.createdAt).toEqual(transactionBefore?.createdAt);
      expect(fundAfter?.id).toBe(fundBefore?.id);
      expect(categoryAfter?.id).toBe(categoryBefore?.id);
      expect(note.json().data).toEqual({ year: 2026, month: 7, note: "Chỉ đổi ghi chú" });
    } finally {
      await app.close();
    }
  });

  it("ghi đúng fund detail, goal, account và transaction bằng CRUD hàng", async () => {
    const { app, cookie } = await createAuthenticatedApp();
    try {
      let workspace = (await app.inject({ method: "GET", url: "/api/data", headers: { cookie } })).json();
      const fundMonth = await app.inject({
        method: "PUT",
        url: "/api/funds/dt/months/2026/7",
        headers: { cookie },
        payload: {
          expectedRevision: workspace.workspaceRevision,
          amount: 12_345_678,
          detail: {
            type: "hold",
            lots: [{
              ticker: "VNM",
              qty: 10,
              manualPrice: 72_000,
              purchasePrice: 65_000,
              purchaseFxVnd: null,
              feeVnd: 15_000,
            }],
          },
        },
      });
      expect(fundMonth.statusCode).toBe(200);
      workspace = fundMonth.json();
      const goal = await app.inject({
        method: "PUT",
        url: "/api/funds/dt/goals",
        headers: { cookie },
        payload: { expectedRevision: workspace.workspaceRevision, year: 2026, amount: 50_000_000 },
      });
      expect(goal.statusCode).toBe(200);
      workspace = goal.json();
      const accountType = await app.inject({
        method: "POST",
        url: "/api/account-types",
        headers: { cookie },
        payload: { expectedRevision: workspace.workspaceRevision, name: "Ví điện tử" },
      });
      expect(accountType.statusCode).toBe(200);
      workspace = accountType.json();
      const walletTypeId = workspace.data.id;
      const account = await app.inject({
        method: "POST",
        url: "/api/accounts",
        headers: { cookie },
        payload: { expectedRevision: workspace.workspaceRevision, name: "MoMo", typeId: walletTypeId },
      });
      expect(account.statusCode).toBe(200);
      workspace = account.json();
      const category = await app.inject({
        method: "POST",
        url: "/api/categories",
        headers: { cookie },
        payload: {
          expectedRevision: workspace.workspaceRevision,
          type: "expense",
          name: "Y tế",
          color: "#ff0000",
          budget: 2_000_000,
        },
      });
      expect(category.statusCode).toBe(200);
      workspace = category.json();
      const transaction = await app.inject({
        method: "POST",
        url: "/api/transactions",
        headers: { cookie },
        payload: {
          expectedRevision: workspace.workspaceRevision,
          transaction: {
            id: "row-crud-transaction",
            date: "2026-07-27",
            type: "expense",
            cat: "y-te",
            accountId: "momo",
            amount: 500_000,
            note: "Khám bệnh",
          },
        },
      });
      expect(transaction.statusCode).toBe(200);
      workspace = transaction.json();
      const detail = (await app.inject({
        method: "GET",
        url: "/api/funds/dt/months/2026/7",
        headers: { cookie },
      })).json();
      expect(detail.amount).toBe(12_345_678);
      expect(detail.detail).toEqual({
        type: "hold",
        lots: [expect.objectContaining({ ticker: "VNM", qty: 10, manualPrice: 72_000 })],
      });
      const overview = (await app.inject({
        method: "GET",
        url: "/api/funds/overview?year=2026&month=7",
        headers: { cookie },
      })).json();
      expect(overview.funds.find((fund: { id: string }) => fund.id === "dt").yearGoal).toBe(50_000_000);
      const config = (await app.inject({
        method: "GET",
        url: "/api/expenses/config",
        headers: { cookie },
      })).json();
      expect(config.accounts).toContainEqual({ id: "momo", name: "MoMo", typeId: walletTypeId });
      const history = (await app.inject({
        method: "GET",
        url: "/api/transactions?from=2026-07-01&to=2026-07-31&page=1&pageSize=10",
        headers: { cookie },
      })).json();
      expect(history.items).toContainEqual(expect.objectContaining({
        id: "row-crud-transaction",
        cat: "y-te",
        accountId: "momo",
      }));

      const reset = await app.inject({
        method: "POST",
        url: "/api/years/2026/months/7/reset",
        headers: { cookie },
        payload: { expectedRevision: workspace.workspaceRevision },
      });
      expect(reset.statusCode).toBe(200);
      expect(reset.json().data).toEqual({ year: 2026, month: 7 });
      const resetDetail = (await app.inject({
        method: "GET",
        url: "/api/funds/dt/months/2026/7",
        headers: { cookie },
      })).json();
      expect(resetDetail.amount).toBe(0);
      expect(resetDetail.detail).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("chặn import lỗi, payload không phải object, body quá 5 MiB và snapshot API cũ", async () => {
    const { app, cookie } = await createAuthenticatedApp();
    try {
      const malformed = await app.inject({
        method: "PUT",
        url: "/api/data/import",
        headers: { cookie, "content-type": "application/json" },
        payload: "{\"broken\":",
      });
      expect(malformed.statusCode).toBe(400);
      expect(malformed.body).toBe("Invalid JSON");

      expect((await app.inject({
        method: "PUT",
        url: "/api/data/import",
        headers: { cookie },
        payload: [],
      })).statusCode).toBe(400);

      const oversized = await app.inject({
        method: "PUT",
        url: "/api/data/import",
        headers: { cookie, "content-type": "application/json" },
        payload: JSON.stringify({ expectedRevision: 2, data: { value: "x".repeat(5 * 1024 * 1024) } }),
      });
      expect(oversized.statusCode).toBe(413);
      expect(oversized.body).toBe("Request body is too large");
      expect((await app.inject({ method: "PUT", url: "/api/data", headers: { cookie }, payload: {} })).statusCode).toBe(405);
    } finally {
      await app.close();
    }
  });

  it("lưu market quote trong cùng transaction với workspace revision", async () => {
    let received: unknown;
    const response: MarketQuotesResponse = {
      fetchedAt: new Date(0).toISOString(),
      fx: null,
      gold: null,
      stocks: [{
        exchange: "HOSE",
        symbol: "VNM",
        priceVnd: 80_000,
        source: "fixture",
        fetchedAt: new Date(0).toISOString(),
      }],
      crypto: [],
      matches: {},
      errors: [{ key: "HOSE:VNM", code: "upstream", message: "Nguồn giá tạm thời lỗi." }],
    };
    const marketService: MarketService = {
      async getQuotes(request) {
        received = request;
        return response;
      },
      async getHistoricalGoldQuote() {
        throw new Error("not_used");
      },
    };
    const initialData = createDefaultStore();
    initialData.years["2026"]!.funds.dt![6] = 720_000;
    initialData.years["2026"]!.details.dt![6] = {
      type: "hold",
      lots: [{ ticker: "VNM", exchange: "HOSE", qty: 10, manualPrice: 72_000 }],
    };
    const { app, cookie } = await createAuthenticatedApp({
      initialData: initialData as unknown as StoredFinancePayload,
      marketService,
    });
    try {
      const initial = (await app.inject({ method: "GET", url: "/api/data", headers: { cookie } })).json();
      const quoteRequest = { assets: [{ type: "stock" as const, symbol: "VNM", exchange: "HOSE" }], force: true };
      const result = await app.inject({
        method: "POST",
        url: "/api/market/quotes",
        headers: { cookie },
        payload: { ...quoteRequest, expectedRevision: initial.workspaceRevision },
      });
      expect(result.statusCode).toBe(200);
      expect(result.headers["cache-control"]).toBe("no-store");
      expect(received).toEqual(quoteRequest);
      expect(result.json().quotes).toEqual(response);
      expect(result.json().workspaceRevision).toBe(initial.workspaceRevision + 1);
      expect(result.json().affectedPeriods).toContain("2026-07");
      const detail = (await app.inject({
        method: "GET",
        url: "/api/funds/dt/months/2026/7",
        headers: { cookie },
      })).json();
      expect(detail.amount).toBe(800_000);
    } finally {
      await app.close();
    }
  });

  it("tra giá vàng lịch sử yêu cầu đăng nhập và trả lỗi ngày rõ ràng", async () => {
    const received: string[] = [];
    const marketService: MarketService = {
      async getQuotes() {
        return {
          fetchedAt: new Date(0).toISOString(),
          fx: null,
          gold: null,
          stocks: [],
          crypto: [],
          matches: {},
          errors: [],
        };
      },
      async getHistoricalGoldQuote(date) {
        received.push(date);
        if (date === "invalid") {
          throw Object.assign(new Error("Ngày mua không hợp lệ."), { code: "invalid_historical_date" });
        }
        return {
          date,
          vndPerTroyOunce: 60_981_087,
          vndPerChi: 7_352_203,
          source: "Frankfurter",
          sourceUrl: "https://frankfurter.dev",
        };
      },
    };
    const { app, cookie } = await createAuthenticatedApp({ marketService });
    try {
      expect((await app.inject({
        method: "GET",
        url: "/api/market/gold/history?date=2024-07-15",
      })).statusCode).toBe(401);

      const success = await app.inject({
        method: "GET",
        url: "/api/market/gold/history?date=2024-07-15",
        headers: { cookie },
      });
      expect(success.statusCode).toBe(200);
      expect(success.json()).toMatchObject({ date: "2024-07-15", vndPerChi: 7_352_203 });

      const invalid = await app.inject({
        method: "GET",
        url: "/api/market/gold/history?date=invalid",
        headers: { cookie },
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toMatchObject({ error: "invalid_historical_date" });
      expect(received).toEqual(["2024-07-15", "invalid"]);
    } finally {
      await app.close();
    }
  });

  it("ghi kỳ trả nợ cùng giao dịch tự động và chỉ cho hoàn tác từ khoản nợ", async () => {
    const { app, cookie } = await createAuthenticatedApp();
    try {
      let workspace = (await app.inject({ method: "GET", url: "/api/data", headers: { cookie } })).json();
      const created = await app.inject({
        method: "POST",
        url: "/api/debts",
        headers: { cookie },
        payload: {
          expectedRevision: workspace.workspaceRevision,
          debt: {
            kind: "installment", name: "Trả góp thử", counterparty: "Cửa hàng", principal: 1_000_000,
            annualInterestRate: 0, termMonths: 2, paymentAmount: 500_000, firstPaymentDate: "2026-08-01",
            paymentCategoryId: "other", note: "",
          },
        },
      });
      expect(created.statusCode).toBe(200);
      workspace = created.json();
      const debtId = workspace.data.id;
      const payment = await app.inject({
        method: "POST",
        url: `/api/debts/${debtId}/payments`,
        headers: { cookie },
        payload: { expectedRevision: workspace.workspaceRevision, paidAt: "2026-08-01" },
      });
      expect(payment.statusCode).toBe(200);
      workspace = payment.json();
      const detail = (await app.inject({ method: "GET", url: `/api/debts/${debtId}`, headers: { cookie } })).json();
      expect(detail.remainingBalance).toBe(500_000);
      expect(detail.payments).toContainEqual(expect.objectContaining({ installment: 1, transactionId: `debt-${debtId}-1` }));
      const locked = await app.inject({
        method: "DELETE",
        url: `/api/transactions/debt-${debtId}-1`,
        headers: { cookie },
        payload: { expectedRevision: workspace.workspaceRevision },
      });
      expect(locked.statusCode).toBe(409);
      const undone = await app.inject({
        method: "DELETE",
        url: `/api/debts/${debtId}/payments/${detail.payments[0].id}`,
        headers: { cookie },
        payload: { expectedRevision: workspace.workspaceRevision },
      });
      expect(undone.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});

describe("Trợ lý tài chính AI", () => {
  function assistantFixture(): ReturnType<typeof createDefaultStore> {
    const initial = createDefaultStore();
    initial.funds = [{ id: "reserve", name: "Quỹ dự phòng", color: "#3f7d5c", cat: "saving" }];
    initial.years["2026"] = {
      income: new Array(12).fill(0),
      funds: { reserve: [...new Array(6).fill(0), 100_000, ...new Array(5).fill(0)] },
      details: { reserve: new Array(12).fill(null) },
      notes: new Array(12).fill(""),
    };
    initial.expense.cats = [
      { id: "food", name: "Ăn uống", color: "#E4572E", budget: 5_000_000 },
      { id: "household", name: "Đồ dùng", color: "#3B82F6", budget: 2_000_000 },
    ];
    initial.expense.incomeCats = [{ id: "salary", name: "Lương", color: "#4C9F70" }];
    initial.expense.accountTypes = [];
    initial.expense.accounts = [];
    initial.expense.txns = [];
    return initial;
  }

  it("ghi nguyên tử nhiều giao dịch và trích quỹ, chỉ tăng revision một lần và retry idempotent", async () => {
    const assistantService: AssistantService = {
      async generate(input) {
        const config = await input.executeTool("get_expense_config", {}) as {
          categories: Array<{ id: string }>;
        };
        const overview = await input.executeTool("get_fund_overview", { year: 2026, month: 7 }) as {
          funds: Array<{ id: string }>;
        };
        await input.executeTool("propose_finance_batch", {
          transactions: [
            {
              position: 0,
              date: "2026-07-27",
              type: "expense",
              categoryId: config.categories[0]!.id,
              amount: 30_000,
              note: "Ăn sáng",
            },
            {
              position: 1,
              date: "2026-07-27",
              type: "expense",
              categoryId: config.categories[1]!.id,
              amount: 45_000,
              note: "Kem đánh răng",
            },
          ],
          fundAllocations: [{
            position: 2,
            fundId: overview.funds[0]!.id,
            year: 2026,
            month: 7,
            operation: "increment",
            amount: 2_000_000,
          }],
        });
        return {
          reply: "Mình đã chuẩn bị 3 thao tác. Hãy bấm Xác nhận.",
          toolNames: ["get_expense_config", "get_fund_overview", "propose_finance_batch"],
          inputTokens: 20,
          outputTokens: 10,
        };
      },
    };
    const { app, cookie } = await createAuthenticatedApp({
      initialData: assistantFixture() as unknown as StoredFinancePayload,
      assistantService,
    });
    try {
      const bootstrap = await app.inject({ method: "GET", url: "/api/data", headers: { cookie } });
      expect(bootstrap.json().features).toEqual({ aiAssistant: true });
      const message = await app.inject({
        method: "POST",
        url: "/api/assistant/messages",
        headers: { cookie },
        payload: {
          message: "30k ăn sáng, 45k kem đánh răng và trích 2 triệu vào quỹ dự phòng",
          history: [],
          context: { route: "expenses", selectedYear: 2026, selectedMonth: 7 },
        },
      });
      expect(message.statusCode).toBe(200);
      const proposal = message.json().proposal;
      expect(proposal).toMatchObject({
        kind: "action_batch",
        expectedRevision: bootstrap.json().workspaceRevision,
        actions: [
          { kind: "create_transaction", categoryName: "Ăn uống", transaction: { amount: 30_000 } },
          { kind: "create_transaction", categoryName: "Đồ dùng", transaction: { amount: 45_000 } },
          { kind: "allocate_fund", previousAmount: 100_000, nextAmount: 2_100_000 },
        ],
      });
      const before = await app.inject({
        method: "GET",
        url: "/api/transactions?from=2026-07-01&to=2026-07-31&page=1&pageSize=10",
        headers: { cookie },
      });
      expect(before.json().total).toBe(0);

      const [tokenBody, tokenSignature] = proposal.confirmationToken.split(".");
      const invalidSignature = `${tokenSignature![0] === "a" ? "b" : "a"}${tokenSignature!.slice(1)}`;
      const invalidToken = `${tokenBody}.${invalidSignature}`;
      const rejected = await app.inject({
        method: "POST",
        url: "/api/assistant/actions/confirm",
        headers: { cookie },
        payload: { confirmationToken: invalidToken },
      });
      expect(rejected.statusCode).toBe(400);

      const first = await app.inject({
        method: "POST",
        url: "/api/assistant/actions/confirm",
        headers: { cookie },
        payload: { confirmationToken: proposal.confirmationToken },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({
        kind: "action_batch",
        alreadyApplied: false,
        workspaceRevision: bootstrap.json().workspaceRevision + 1,
        results: [
          { kind: "create_transaction", transaction: { amount: 30_000 } },
          { kind: "create_transaction", transaction: { amount: 45_000 } },
          { kind: "allocate_fund", fund: { amount: 2_100_000 } },
        ],
      });
      const second = await app.inject({
        method: "POST",
        url: "/api/assistant/actions/confirm",
        headers: { cookie },
        payload: { confirmationToken: proposal.confirmationToken },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ alreadyApplied: true });
      const after = await app.inject({
        method: "GET",
        url: "/api/transactions?from=2026-07-01&to=2026-07-31&page=1&pageSize=10",
        headers: { cookie },
      });
      expect(after.json()).toMatchObject({
        total: 2,
        items: expect.arrayContaining([
          expect.objectContaining({ amount: 30_000, note: "Ăn sáng" }),
          expect.objectContaining({ amount: 45_000, note: "Kem đánh răng" }),
        ]),
      });
      const fundAfter = await app.inject({
        method: "GET",
        url: "/api/funds/overview?year=2026&month=7",
        headers: { cookie },
      });
      expect(fundAfter.json().funds).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "reserve", monthAmount: 2_100_000 }),
      ]));
    } finally {
      await app.close();
    }
  });

  it("tính tuần tự nhiều lần trích vào cùng quỹ và phát hiện preview đã cũ", async () => {
    const assistantService: AssistantService = {
      async generate(input) {
        const overview = await input.executeTool("get_fund_overview", { year: 2026, month: 7 }) as {
          funds: Array<{ id: string }>;
        };
        await input.executeTool("propose_finance_batch", {
          transactions: [],
          fundAllocations: [
            {
              position: 0,
              fundId: overview.funds[0]!.id,
              year: 2026,
              month: 7,
              operation: "increment",
              amount: 2_000_000,
            },
            {
              position: 1,
              fundId: overview.funds[0]!.id,
              year: 2026,
              month: 7,
              operation: "increment",
              amount: 500_000,
            },
          ],
        });
        return {
          reply: "Mình đã chuẩn bị hai lần trích quỹ. Hãy bấm Xác nhận.",
          toolNames: ["get_fund_overview", "propose_finance_batch"],
          inputTokens: 20,
          outputTokens: 10,
        };
      },
    };
    const { app, cookie } = await createAuthenticatedApp({
      initialData: assistantFixture() as unknown as StoredFinancePayload,
      assistantService,
    });
    try {
      const message = await app.inject({
        method: "POST",
        url: "/api/assistant/messages",
        headers: { cookie },
        payload: {
          message: "trích 2 triệu vào quỹ dự phòng",
          history: [],
          context: { route: "funds", selectedYear: 2026, selectedMonth: 7 },
        },
      });
      expect(message.statusCode).toBe(200);
      const proposal = message.json().proposal;
      expect(proposal).toMatchObject({
        kind: "action_batch",
        actions: [
          { previousAmount: 100_000, nextAmount: 2_100_000 },
          { previousAmount: 2_100_000, nextAmount: 2_600_000 },
        ],
      });
      await app.finance.repository.mutatePersonalResource(
        profile.sub,
        proposal.expectedRevision,
        { kind: "monthNote", year: 2026, month: 7, note: "Thay đổi song song" },
      );
      const confirmed = await app.inject({
        method: "POST",
        url: "/api/assistant/actions/confirm",
        headers: { cookie },
        payload: { confirmationToken: proposal.confirmationToken },
      });
      expect(confirmed.statusCode).toBe(409);
      expect(confirmed.json()).toMatchObject({ error: "revision_conflict" });
      const fundAfter = await app.inject({
        method: "GET",
        url: "/api/funds/overview?year=2026&month=7",
        headers: { cookie },
      });
      expect(fundAfter.json().funds).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "reserve", monthAmount: 100_000 }),
      ]));
    } finally {
      await app.close();
    }
  });

  it("chấp nhận 10 thao tác và không tạo preview khi vượt giới hạn hoặc có một khoản không hợp lệ", async () => {
    const toolErrors: string[] = [];
    const assistantService: AssistantService = {
      async generate(input) {
        const config = await input.executeTool("get_expense_config", {}) as {
          categories: Array<{ id: string }>;
        };
        const batchSize = input.message.includes("11 khoản") ? 11
          : input.message.includes("10 khoản") ? 10
            : 0;
        const transactions = batchSize
          ? Array.from({ length: batchSize }, (_, position) => ({
            position,
            date: "2026-07-27",
            type: "expense",
            categoryId: config.categories[0]!.id,
            amount: 10_000,
            note: `Khoản ${position + 1}`,
          }))
          : [
            {
              position: 0,
              date: "2026-07-27",
              type: "expense",
              categoryId: config.categories[0]!.id,
              amount: 30_000,
              note: "Ăn sáng",
            },
            {
              position: 1,
              date: "2026-07-27",
              type: "expense",
              categoryId: "missing-category",
              amount: 45_000,
              note: "Khoản chưa rõ",
            },
          ];
        try {
          await input.executeTool("propose_finance_batch", { transactions, fundAllocations: [] });
        } catch (error) {
          toolErrors.push(error instanceof Error ? error.message : String(error));
        }
        return {
          reply: "Mình cần bạn chia nhỏ hoặc làm rõ các khoản trước khi tạo bản xem trước.",
          toolNames: ["get_expense_config", "propose_finance_batch"],
          inputTokens: 20,
          outputTokens: 10,
        };
      },
    };
    const { app, cookie } = await createAuthenticatedApp({
      initialData: assistantFixture() as unknown as StoredFinancePayload,
      assistantService,
    });
    try {
      const accepted = await app.inject({
        method: "POST",
        url: "/api/assistant/messages",
        headers: { cookie },
        payload: {
          message: "Tạo 10 khoản",
          history: [],
          context: { route: "expenses", selectedYear: 2026, selectedMonth: 7 },
        },
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json().proposal.actions).toHaveLength(10);
      for (const message of ["Tạo 11 khoản", "30k ăn sáng và một khoản chưa rõ"]) {
        const response = await app.inject({
          method: "POST",
          url: "/api/assistant/messages",
          headers: { cookie },
          payload: {
            message,
            history: [],
            context: { route: "expenses", selectedYear: 2026, selectedMonth: 7 },
          },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).not.toHaveProperty("proposal");
      }
      expect(toolErrors).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it("chấp nhận token proposal v1 còn hạn như batch một phần tử", async () => {
    const assistantService: AssistantService = {
      async generate() {
        return {
          reply: "Không dùng trong test này.",
          toolNames: [],
          inputTokens: 0,
          outputTokens: 0,
        };
      },
    };
    const { app, cookie } = await createAuthenticatedApp({
      initialData: assistantFixture() as unknown as StoredFinancePayload,
      assistantService,
    });
    try {
      const bootstrap = await app.inject({ method: "GET", url: "/api/data", headers: { cookie } });
      const actionId = crypto.randomUUID();
      const issuedAt = Date.now();
      const body = Buffer.from(JSON.stringify({
        version: 1,
        userId: profile.sub,
        issuedAt,
        expiresAt: issuedAt + 10 * 60_000,
        action: {
          kind: "create_transaction",
          actionId,
          expectedRevision: bootstrap.json().workspaceRevision,
          transaction: {
            id: actionId,
            date: "2026-07-27",
            type: "expense",
            cat: "food",
            amount: 30_000,
            note: "Token cũ",
          },
          categoryName: "Ăn uống",
        },
      })).toString("base64url");
      const signature = crypto.createHmac(
        "sha256",
        "integration-session-secret-at-least-twenty-bytes",
      ).update(body).digest("base64url");
      const confirmed = await app.inject({
        method: "POST",
        url: "/api/assistant/actions/confirm",
        headers: { cookie },
        payload: { confirmationToken: `${body}.${signature}` },
      });
      expect(confirmed.statusCode).toBe(200);
      expect(confirmed.json()).toMatchObject({
        kind: "action_batch",
        batchId: actionId,
        alreadyApplied: false,
        results: [{ kind: "create_transaction", transaction: { note: "Token cũ" } }],
      });
    } finally {
      await app.close();
    }
  });

  it("chỉ công bố quỹ saving cá nhân là có thể trích nhanh và giải thích đúng quỹ chung/crypto", async () => {
    const initial = assistantFixture();
    initial.funds.push(
      { id: "joint", name: "Quỹ Tiết Kiệm", color: "#8a5cc4", cat: "saving" },
      { id: "btc", name: "Bitcoin", color: "#f59e0b", cat: "crypto" },
    );
    initial.years["2026"]!.funds.joint = new Array(12).fill(0);
    initial.years["2026"]!.funds.btc = new Array(12).fill(0);
    initial.years["2026"]!.details.joint = new Array(12).fill(null);
    initial.years["2026"]!.details.btc = new Array(12).fill(null);
    const toolErrors: string[] = [];
    const assistantService: AssistantService = {
      async generate(input) {
        expect(input.systemInstruction).toContain("không phải yêu cầu tìm Internet");
        expect(input.systemInstruction).toContain("chỉ dùng fundId nằm trong writableSavingFunds");
        const overview = await input.executeTool("get_fund_overview", { year: 2026, month: 7 }) as {
          writableSavingFunds: Array<{ id: string; name: string }>;
          funds: Array<{
            id: string;
            name: string;
            category: string;
            shared: boolean;
            canQuickAllocate: boolean;
            quickAllocationRestriction?: string;
          }>;
        };
        expect(overview.writableSavingFunds).toEqual([
          expect.objectContaining({ id: "reserve", name: "Quỹ dự phòng" }),
        ]);
        const shared = overview.funds.find((fund) => fund.name === "Quỹ Tiết Kiệm")!;
        expect(shared).toMatchObject({
          shared: true,
          canQuickAllocate: false,
          quickAllocationRestriction: "shared_fund_read_only",
        });
        const cryptoFund = overview.funds.find((fund) => fund.id === "btc")!;
        expect(cryptoFund).toMatchObject({
          category: "crypto",
          canQuickAllocate: false,
          quickAllocationRestriction: "investment_requires_lot_details",
        });
        for (const fund of [shared, cryptoFund]) {
          try {
            await input.executeTool("propose_finance_batch", {
              transactions: [],
              fundAllocations: [{
                position: 0,
                fundId: fund.id,
                year: 2026,
                month: 7,
                operation: "increment",
                amount: 2_000_000,
              }],
            });
          } catch (error) {
            toolErrors.push(error instanceof Error ? error.message : String(error));
          }
        }
        return {
          reply: "Mình cần bạn chọn quỹ saving cá nhân hoặc mở màn hình chi tiết quỹ đầu tư.",
          toolNames: ["get_fund_overview", "propose_finance_batch"],
          inputTokens: 20,
          outputTokens: 10,
        };
      },
    };
    const { app, cookie } = await createAuthenticatedApp({
      initialData: initial as unknown as StoredFinancePayload,
      assistantService,
    });
    try {
      const collaborator: UserProfile = {
        sub: "assistant-collaborator",
        email: "assistant-collaborator@example.com",
        name: "Assistant Collaborator",
        picture: "",
      };
      await seedUser(postgres, collaborator, createDefaultStore() as unknown as StoredFinancePayload);
      const workspace = await app.inject({ method: "GET", url: "/api/data", headers: { cookie } });
      const shared = await app.inject({
        method: "POST",
        url: "/api/shared-funds",
        headers: { cookie },
        payload: {
          fundId: "joint",
          email: collaborator.email,
          role: "viewer",
          expectedRevision: workspace.json().workspaceRevision,
        },
      });
      expect(shared.statusCode).toBe(200);

      const response = await app.inject({
        method: "POST",
        url: "/api/assistant/messages",
        headers: { cookie },
        payload: {
          message: "Hôm nay bỏ 2 triệu vào Quỹ Tiết Kiệm và tháng trước mua 1 BTC",
          history: [],
          context: { route: "funds", selectedYear: 2026, selectedMonth: 7 },
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).not.toHaveProperty("proposal");
      expect(toolErrors).toHaveLength(2);
      expect(toolErrors[0]).toContain("quỹ chung");
      expect(toolErrors[0]).toContain("Quỹ dự phòng");
      expect(toolErrors[1]).toContain("không phải hạn chế Internet");
      expect(toolErrors[1]).toContain("chi tiết lot");
    } finally {
      await app.close();
    }
  });
});

describe("Fastify SPA production", () => {
  it("phục vụ bundle và deep link nhưng không lộ dotfile hay file ngoài bundle", async () => {
    await postgres.reset();
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "finance-web-"));
    const webRoot = path.join(directory, "web");
    const distRoot = path.join(webRoot, "dist", "client");
    await fs.mkdir(path.join(distRoot, "assets"), { recursive: true });
    await fs.writeFile(path.join(distRoot, "index.html"), "<main>React production bundle</main>", "utf8");
    await fs.writeFile(path.join(distRoot, "assets", "app.js"), "globalThis.__APP__ = true;", "utf8");
    await fs.writeFile(path.join(distRoot, ".secret"), "not public", "utf8");

    const app = await buildApp({ workspaceRoot: directory, repository: postgres.repository, database: postgres.client.db, webRoot, env: {} });
    try {
      for (const route of ["/funds", "/expenses", "/statistics", "/debts"]) {
        const response = await app.inject({ method: "GET", url: route });
        expect(response.statusCode).toBe(200);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.body).toContain("React production bundle");
      }
      const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers["cache-control"]).toContain("immutable");
      expect((await app.inject({ method: "GET", url: "/.secret" })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/outside.txt" })).statusCode).toBe(404);
    } finally {
      await app.close();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
