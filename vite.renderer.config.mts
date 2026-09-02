import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

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
  },
  build: {
    outDir: path.resolve(".vite/renderer/main_window"),
  },
  plugins: [react()],
});
