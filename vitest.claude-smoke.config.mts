import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/smoke/claude-pty.smoke.test.ts"],
    maxWorkers: 1,
  },
});
