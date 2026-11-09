import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";

if (existsSync(".env")) loadEnvFile(".env");

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Integration tests share one database; run files serially.
    fileParallelism: false,
    testTimeout: 20_000,
    // Online payments are off by default (coming soon); the suite exercises them, so switch them on.
    env: { PAYMENTS_ENABLED: "1" },
  },
});
