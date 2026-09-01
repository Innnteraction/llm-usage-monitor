import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/renderer",
  base: "./",
  html: {
    cspNonce: "llm-usage-monitor-vite",
  },
  build: {
    outDir: path.resolve(".vite/renderer/main_window"),
  },
  plugins: [react()],
});
