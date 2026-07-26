import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
      "@chi-tieu/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: "web",
          include: ["apps/web/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./apps/web/src/test/setup.ts"],
        },
      },
    ],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
