import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StoredFinancePayload, UserProfile } from "@chi-tieu/shared";
import { buildApp } from "../src/application.js";
import { SESSION_TTL_MS } from "../src/lib/session.js";
import type { AssistantService } from "../src/services/assistant.js";
import { createPostgresTestContext, seedUser } from "./postgres.js";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(sourceDirectory, "../../..");
const profile: UserProfile = {
  sub: "e2e-user",
  email: "e2e@example.com",
  name: "Người dùng E2E",
  picture: "",
};
const funds = [
  { id: "dp", name: "Quỹ dự phòng", color: "#3f7d5c", cat: "saving" },
  { id: "dt", name: "Quỹ đầu tư", color: "#3b6ea5", cat: "stock" },
  { id: "vang", name: "Quỹ mua vàng", color: "#c8963e", cat: "gold" },
  { id: "cr", name: "Crypto", color: "#8a5cc4", cat: "crypto" },
];
const blankYear = () => ({
  income: new Array(12).fill(0),
  funds: Object.fromEntries(funds.map((fund) => [fund.id, new Array(12).fill(0)])),
  details: Object.fromEntries(funds.map((fund) => [fund.id, new Array(12).fill(null)])),
  notes: new Array(12).fill(""),
});
const testLedger = {
  funds,
  usdRate: 25_000,
  years: { "2025": blankYear(), "2026": blankYear() },
  goals: {},
  prices: {},
  showGoals: false,
  expense: {
    cats: [
      { id: "food", name: "Ăn uống", color: "#E4572E", budget: 5_000_000 },
      { id: "household", name: "Đồ dùng", color: "#3B82F6", budget: 2_000_000 },
    ],
    incomeCats: [{ id: "salary", name: "Lương", color: "#4C9F70" }],
    txns: [],
  },
  market: { fx: null, gold: null, stocks: {}, crypto: {}, cryptoSymbols: {}, matches: {}, errors: [], updatedAt: null },
  onboarding: { status: "completed", version: 1 },
  financialProfile: {
    monthlyIncome: 22_500_000,
    monthlyBudgets: {},
    fundPlan: {},
    emergencyFundGoal: 0,
    openingBalances: {},
    debt: { balance: 0, monthlyPayment: 0 },
  },
};
const postgres = await createPostgresTestContext();
await postgres.reset();
await seedUser(postgres, profile, testLedger as unknown as StoredFinancePayload);

const assistantService: AssistantService = {
  async generate(input) {
    const config = await input.executeTool("get_expense_config", {}) as {
      categories: Array<{ id: string }>;
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
      fundAllocations: [],
    });
    return {
      reply: "Mình đã chuẩn bị 2 khoản chi. Hãy kiểm tra rồi xác nhận.",
      toolNames: ["get_expense_config", "propose_finance_batch"],
      inputTokens: 20,
      outputTokens: 10,
    };
  },
};

const port = Number(process.env.E2E_PORT || 3107);
const app = await buildApp({
  workspaceRoot,
  repository: postgres.repository,
  database: postgres.client.db,
  env: {
    SESSION_SECRET: "e2e-session-secret-at-least-twenty-bytes",
    APP_BASE_URL: `http://127.0.0.1:${port}`,
    AI_ASSISTANT_ENABLED: "true",
  },
  assistantService,
  logger: false,
});

app.get("/__test/login", async (_request, reply) => {
  await postgres.reset();
  await seedUser(postgres, profile, testLedger as unknown as StoredFinancePayload);
  const sessionId = await app.finance.sessions.createSession(profile);
  return reply
    .setCookie("finance_session", app.finance.sessions.signedSessionValue(sessionId), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: SESSION_TTL_MS / 1000,
    })
    .redirect("/expenses");
});

const cleanup = async (): Promise<void> => {
  await app.close().catch(() => undefined);
  await postgres.close().catch(() => undefined);
};
process.once("SIGTERM", () => void cleanup().finally(() => process.exit(0)));
process.once("SIGINT", () => void cleanup().finally(() => process.exit(0)));

await app.listen({ host: "127.0.0.1", port });
