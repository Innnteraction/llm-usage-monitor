import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import console from "node:console";

const root = path.resolve(import.meta.dirname, "..");
const read = name => readFileSync(path.join(root, name), "utf8");
const workspace = JSON.parse(read("package.json"));
const node = JSON.parse(read("apps/node/package.json"));
const rust = read("apps/rust/Cargo.toml").match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const display = read("apps/node/src/shared/version.ts").match(/APP_VERSION = "([^"]+)"/)?.[1];
assert.equal(node.version, workspace.version, "Workspace and Node versions differ");
assert.equal(rust, node.version, "Rust and Node versions differ");
assert.equal(display, node.version, "Node display and package versions differ");
assert.equal(workspace.packageManager, node.packageManager, "pnpm versions differ");
console.log(`Versions agree: ${node.version} (${node.packageManager})`);
