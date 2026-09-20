import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkArchitecture } from "./check-architecture.mjs";

test("guard rejects uncovered core, reverse/private dependencies and cycles", () => {
  const root = mkdtempSync(path.join(tmpdir(), "architecture-fixture-"));
  const put = (name, text) => { const p = path.join(root, name); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, text); };
  try {
    put("tsconfig.json", '{"compilerOptions":{"moduleResolution":"bundler","module":"esnext"}}');
    put("architecture/boundaries.json", JSON.stringify({ core: ["shared"], shared: [] }));
    put("src/core/index.ts", 'import "../shared/index";');
    put("src/shared/index.ts", 'export const value = 1;');
    assert.deepEqual(checkArchitecture(root, path.join(root, "architecture/boundaries.json")).errors, []);
    put("src/new-layer/index.ts", 'export {};');
    put("src/shared/private.ts", 'import "../core/index";');
    put("src/shared/index.ts", 'export * from "./private";');
    put("src/core/index.ts", 'import "../shared/private";');
    const errors = checkArchitecture(root, path.join(root, "architecture/boundaries.json")).errors.join("\n");
    for (const message of ["Uncovered source", "Forbidden dependency", "Private import", "Cycle"]) assert.ok(errors.includes(message), message);
    put("src/renderer/index.ts", 'import fs from "node:fs";');
    assert.ok(checkArchitecture(root, path.join(root, "architecture/boundaries.json")).errors.some(e => e.startsWith("Non-browser dependency")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
