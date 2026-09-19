import { defineConfig } from "vitest/config";

const sharedCacheTest = "tests/unit/sharedCacheInterop.test.ts";
const sharedCacheOnly = process.argv.some(arg => arg.replaceAll("\\", "/").endsWith(sharedCacheTest));

export default defineConfig({
  test: {
    exclude: sharedCacheOnly ? [] : [sharedCacheTest],
    include: sharedCacheOnly ? [sharedCacheTest] : [
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.test.ts",
    ],
  },
});
