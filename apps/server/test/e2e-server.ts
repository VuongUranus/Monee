import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UserDatabase, UserProfile } from "@chi-tieu/shared";
import { buildApp } from "../src/app.js";
import { SESSION_TTL_MS } from "../src/lib/session.js";

const testDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "finance-e2e-"));
const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(sourceDirectory, "../../..");
const databasePath = path.join(testDirectory, "data.json");
const profile: UserProfile = {
  sub: "e2e-user",
  email: "e2e@example.com",
  name: "Người dùng E2E",
  picture: "",
};
const now = new Date().toISOString();
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
    cats: [{ id: "food", name: "Ăn uống", color: "#E4572E", budget: 5_000_000 }],
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
const database: UserDatabase = {
  schemaVersion: 3,
  users: {
    [profile.sub]: {
      profile,
      data: testLedger as unknown as Record<string, unknown>,
      createdAt: now,
      updatedAt: now,
    },
  },
};
await fs.writeFile(databasePath, JSON.stringify(database), "utf8");

const port = Number(process.env.E2E_PORT || 3107);
const app = await buildApp({
  workspaceRoot,
  databasePath,
  env: {
    SESSION_SECRET: "e2e-session-secret-at-least-twenty-bytes",
    APP_BASE_URL: `http://127.0.0.1:${port}`,
  },
  logger: false,
});

app.get("/__test/login", async (_request, reply) => {
  const sessionId = app.finance.sessions.createSession(profile);
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
  await fs.rm(testDirectory, { recursive: true, force: true });
};
process.once("SIGTERM", () => void cleanup().finally(() => process.exit(0)));
process.once("SIGINT", () => void cleanup().finally(() => process.exit(0)));

await app.listen({ host: "127.0.0.1", port });
