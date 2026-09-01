import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/smoke/codex.smoke.test.ts"],
    maxWorkers: 1,
  },
});
