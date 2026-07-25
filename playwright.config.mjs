import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  tsconfig: "./apps/web/tsconfig.json",
  testDir: "./apps/web/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: "http://127.0.0.1:3107",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npx tsx apps/server/test/e2e-server.ts",
    url: "http://127.0.0.1:3107/expenses",
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "chromium-mobile", use: { ...devices["Pixel 5"] } },
  ],
});
