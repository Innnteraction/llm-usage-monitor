import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("renderer development server", () => {
  it("pins the renderer development server to the local 17321 port", () => {
    const config = readFileSync(
      path.resolve(import.meta.dirname, "../../vite.renderer.config.mts"),
      "utf8",
    );

    expect(config).toContain('host: "127.0.0.1"');
    expect(config).toContain("port: 17321");
    expect(config).toContain("strictPort: true");
  });

});
