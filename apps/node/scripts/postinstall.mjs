import { chmodSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
// Electron 44 installs on first import. Finish once before parallel test workers
// can race while extracting the same runtime in a fresh checkout.
require("electron");

if (process.platform === "darwin") {
  const prebuilds = path.join(path.dirname(require.resolve("node-pty/package.json")), "prebuilds");
  for (const entry of readdirSync(prebuilds)) {
    if (entry.startsWith("darwin-")) chmodSync(path.join(prebuilds, entry, "spawn-helper"), 0o755);
  }
}
