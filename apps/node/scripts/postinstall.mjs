import { chmodSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

if (process.platform === "darwin") {
  const require = createRequire(import.meta.url);
  const prebuilds = path.join(path.dirname(require.resolve("node-pty/package.json")), "prebuilds");
  for (const entry of readdirSync(prebuilds)) {
    if (entry.startsWith("darwin-")) chmodSync(path.join(prebuilds, entry, "spawn-helper"), 0o755);
  }
}
