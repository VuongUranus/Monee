import fs from "node:fs";
import path from "node:path";

export interface AppConfig {
  host: string;
  port: number;
  appBaseUrl: string;
  googleClientId: string;
  googleClientSecret: string;
  sessionSecret: string;
  databasePath: string;
  workspaceRoot: string;
  webRoot: string;
  secureCookies: boolean;
  oauthConfigured: boolean;
}

export type AppEnvironment = NodeJS.ProcessEnv;

export function parseDotEnv(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1]!;
    let value = match[2]!.trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[key] = value;
  }
  return values;
}

export function loadEnvironment(workspaceRoot: string, base: AppEnvironment = process.env): AppEnvironment {
  const merged: AppEnvironment = { ...base };
  try {
    const local = parseDotEnv(fs.readFileSync(path.join(workspaceRoot, ".env"), "utf8"));
    for (const [key, value] of Object.entries(local)) {
      if (merged[key] === undefined) merged[key] = value;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return merged;
}

export function createConfig(
  workspaceRoot: string,
  env: AppEnvironment,
  overrides: Partial<Pick<AppConfig, "databasePath" | "host" | "port" | "webRoot">> = {},
): AppConfig {
  const host = overrides.host ?? "127.0.0.1";
  const port = overrides.port ?? Number(env.PORT || 3000);
  const appBaseUrl = (env.APP_BASE_URL || `http://${host}:${port}`).replace(/\/$/, "");
  const googleClientId = env.GOOGLE_CLIENT_ID || "";
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET || "";
  const sessionSecret = env.SESSION_SECRET || "";
  return {
    host,
    port,
    appBaseUrl,
    googleClientId,
    googleClientSecret,
    sessionSecret,
    databasePath: overrides.databasePath ?? path.join(workspaceRoot, "data.json"),
    workspaceRoot,
    webRoot: overrides.webRoot ?? path.join(workspaceRoot, "apps", "web"),
    secureCookies: appBaseUrl.startsWith("https://"),
    oauthConfigured: Boolean(googleClientId && googleClientSecret && sessionSecret),
  };
}
