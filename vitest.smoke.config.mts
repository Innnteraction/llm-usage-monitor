import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/smoke/codex.smoke.test.ts",
      "tests/smoke/local-usage.smoke.test.ts",
    ],
    maxWorkers: 1,
    testTimeout: 120_000,
  },
});
