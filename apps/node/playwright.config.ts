import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  testIgnore: "claudePackaged.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
});
