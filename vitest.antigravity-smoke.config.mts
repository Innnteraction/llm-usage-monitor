import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/smoke/antigravity.smoke.test.ts"],
    maxWorkers: 1,
    reporters: ["verbose"],
    silent: false,
    testTimeout: 40_000,
  },
});
