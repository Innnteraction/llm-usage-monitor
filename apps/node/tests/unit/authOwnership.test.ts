import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const providerRoot = path.resolve("src", "providers");

const collectTypeScriptFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectTypeScriptFiles(entryPath);
      }
      return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
    }),
  );
  return nested.flat();
};

describe("provider authentication ownership", () => {
  it("has no direct credential file access or mutation path", async () => {
    const files = await collectTypeScriptFiles(providerRoot);
    const sources = await Promise.all(
      files.map(async (file) => ({
        file,
        source: await readFile(file, "utf8"),
      })),
    );
    const forbiddenCredentialNames = [
      "auth.json",
      ".credentials.json",
      "oauth_creds.json",
      "credentials.json",
    ];
    const forbiddenFileOperations =
      /\b(?:readFile|readFileSync|createReadStream|writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|rename|rm|unlink)\s*\(/;

    for (const { file, source } of sources) {
      for (const credentialName of forbiddenCredentialNames) {
        expect(
          source.toLowerCase(),
          `${path.relative(providerRoot, file)} references ${credentialName}`,
        ).not.toContain(credentialName);
      }
      expect(
        source,
        `${path.relative(providerRoot, file)} accesses file contents`,
      ).not.toMatch(forbiddenFileOperations);
    }
  });

  it("uses only vendor-owned read paths for account status", async () => {
    const codexProtocol = await readFile(
      path.join(providerRoot, "codex", "protocol.ts"),
      "utf8",
    );
    const claudeProvider = await readFile(
      path.join(providerRoot, "claude", "provider.ts"),
      "utf8",
    );

    expect(codexProtocol).toContain("refreshToken: z.literal(false)");
    expect(claudeProvider).toContain(
      '["auth", "status", "--json"]',
    );
  });
});
