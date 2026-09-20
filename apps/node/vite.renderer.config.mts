import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

const devCspPlugin = (): Plugin => ({
  name: "dev-csp",
  apply: "serve",
  transformIndexHtml(html) {
    return html.replace(
      "connect-src 'self'",
      "connect-src 'self' ws://127.0.0.1:17321",
    );
  },
});

export default defineConfig({
  root: "src/renderer",
  base: "./",
  html: {
    cspNonce: "llm-usage-monitor-vite",
  },
  server: {
    host: "127.0.0.1",
    port: 17321,
    strictPort: true,
    hmr: { host: "127.0.0.1" },
  },
  build: {
    outDir: path.resolve(".vite/renderer/main_window"),
  },
  plugins: [react(), devCspPlugin()],
});
