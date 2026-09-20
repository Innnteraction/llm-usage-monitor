import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import { expect, it } from "vitest";

it("gives every Vite/React script a matching nonce without relaxing script CSP", async () => {
  const server = await createServer({
    configFile: path.resolve("vite.renderer.config.mts"),
    server: { middlewareMode: true, watch: null, ws: false },
    logLevel: "silent",
  });
  try {
    const source = await readFile("src/renderer/index.html", "utf8");
    const html = await server.transformIndexHtml("/", source);
    expect(html).toContain("injectIntoGlobalHook");
    expect(html).toContain("connect-src 'self' ws://127.0.0.1:17321");
    expect(html).not.toMatch(/unsafe-inline|unsafe-eval/);
    const scripts = [...html.matchAll(/<script([^>]*)>/g)];
    expect(scripts.length).toBeGreaterThanOrEqual(3);
    for (const [, attributes] of scripts) {
      expect(attributes).toContain('nonce="llm-usage-monitor-vite"');
    }
    expect(source).not.toMatch(/localhost|127\.0\.0\.1|ws:\/\//);
  } finally { await server.close(); }
});
