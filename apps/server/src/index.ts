import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./application.js";
import { createConfig, loadEnvironment } from "./lib/config.js";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(sourceDirectory, "../../..");
const env = loadEnvironment(workspaceRoot);
const config = createConfig(workspaceRoot, env);
const development = process.argv.includes("--dev");
const app = await buildApp({
  workspaceRoot,
  env,
  development,
  logger: development ? { level: "info" } : true,
});

try {
  const address = await app.listen({ host: config.host, port: config.port });
  app.log.info(`Ứng dụng đang chạy tại ${address}`);
  if (!config.oauthConfigured) {
    app.log.warn("Google OAuth chưa được cấu hình; hãy xem .env.example.");
  }
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
