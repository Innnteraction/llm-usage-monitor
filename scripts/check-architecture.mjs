/* global process, console */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Resolve imports with the same compiler options as the application. Unknown
// source folders fail closed; no developer-local baseline is needed by CI.
export function checkArchitecture(root) {
  const policy = JSON.parse(fs.readFileSync(path.join(root, "architecture/boundaries.json"), "utf8"));
  const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
  const files = ts.sys.readDirectory(path.join(root, "src"), [".ts", ".tsx"]);
  const errors = [];
  const graph = new Map();
  const relative = p => path.relative(root, p).replaceAll("\\", "/");
  const owner = p => {
    const parts = relative(p).split("/");
    return parts[1] === "forge-env.d.ts" ? "declarations" : parts[1] === "providers" && parts.length > 3 ? `provider-${parts[2]}` : parts[1];
  };
  for (const file of files) {
    const boundary = owner(file);
    if (!Object.hasOwn(policy, boundary)) errors.push(`Uncovered source: ${relative(file)}`);
    const deps = [];
    graph.set(file, deps);
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node) {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === "require")) specifier = node.arguments[0];
      if (specifier && ts.isStringLiteralLike(specifier)) {
        const name = specifier.text;
        const resolved = ts.resolveModuleName(name, file, options, ts.sys).resolvedModule;
        if (resolved && !resolved.isExternalLibraryImport && relative(resolved.resolvedFileName).startsWith("src/")) {
          const target = resolved.resolvedFileName;
          const targetOwner = owner(target);
          deps.push(target);
          if (boundary !== targetOwner) {
            if (!policy[boundary]?.includes(targetOwner)) errors.push(`Forbidden dependency: ${relative(file)} -> ${relative(target)}`);
            if (path.basename(target) !== "index.ts") errors.push(`Private import: ${relative(file)} -> ${relative(target)}`);
          }
        } else if (["renderer", "shared"].includes(boundary) && !["react", "react-dom/client", "react/jsx-runtime", "zod"].includes(name) && !/\.(css|svg|png)$/.test(name)) {
          errors.push(`Non-browser dependency: ${relative(file)} -> ${name}`);
        } else if (name.startsWith(".") && !resolved && !/\.(css|svg|png)$/.test(name)) {
          errors.push(`Unresolved dependency: ${relative(file)} -> ${name}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  const active = new Set(), done = new Set();
  function visit(file, chain) {
    if (active.has(file)) { errors.push(`Cycle: ${[...chain, file].map(relative).join(" -> ")}`); return; }
    if (done.has(file)) return;
    active.add(file);
    for (const target of graph.get(file) ?? []) visit(target, [...chain, file]);
    active.delete(file); done.add(file);
  }
  for (const file of files) visit(file, []);
  return { files: files.length, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkArchitecture(process.cwd());
  for (const error of result.errors) console.error(error);
  console.log(`Architecture: ${result.files} TypeScript modules, ${result.errors.length} violations (zero-baseline policy).`);
  process.exitCode = result.errors.length ? 1 : 0;
}
