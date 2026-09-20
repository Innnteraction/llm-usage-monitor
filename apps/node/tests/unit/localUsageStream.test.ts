import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_JSONL_MAX_LINE_BYTES,
  streamJsonl,
} from "../../src/local-usage/index";

const directories: string[] = [];
const fixture = async (contents: string): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), "local-usage-stream-"));
  directories.push(directory);
  const filePath = path.join(directory, "fixture.jsonl");
  await writeFile(filePath, contents, "utf8");
  return filePath;
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("streamJsonl", () => {
  it("keeps UTF-8 and CRLF lines intact across chunks", async () => {
    const filePath = await fixture('{"value":"가"}\r\n{"value":"나"}\n');
    const lines: string[] = [];
    const result = await streamJsonl({
      filePath,
      chunkSize: 5,
      onLine: (line) => {
        lines.push(line);
      },
    });
    expect(lines).toEqual(['{"value":"가"}', '{"value":"나"}']);
    expect(result.incompleteLine).toBe(false);
  });

  it("handles a normal line above 7.5 MiB", async () => {
    const filePath = await fixture(`${JSON.stringify({ kind: "candidate", body: "x".repeat(7.5 * 1024 * 1024) })}\n`);
    let lineLength = 0;
    await streamJsonl({ filePath, onLine: (line) => { lineLength = line.length; } });
    expect(lineLength).toBeGreaterThan(7.5 * 1024 * 1024);
  });

  it("skips a line above the maximum and keeps later complete lines", async () => {
    const filePath = await fixture(`${"x".repeat(DEFAULT_JSONL_MAX_LINE_BYTES + 1)}\n{"ok":true}\n`);
    const lines: string[] = [];
    const result = await streamJsonl({
      filePath,
      onLine: (line) => {
        lines.push(line);
      },
    });
    expect(lines).toEqual(['{"ok":true}']);
    expect(result.oversizedLineCount).toBe(1);
  });

  it("does not advance past an incomplete final line", async () => {
    const complete = '{"complete":true}\n';
    const filePath = await fixture(`${complete}{"unfinished":true}`);
    const lines: string[] = [];
    const result = await streamJsonl({
      filePath,
      onLine: (line) => {
        lines.push(line);
      },
    });
    expect(lines).toEqual(['{"complete":true}']);
    expect(result.nextOffset).toBe(Buffer.byteLength(complete));
    expect(result.incompleteLine).toBe(true);
  });

  it("honors an aborted signal", async () => {
    const filePath = await fixture('{"value":1}\n');
    const controller = new AbortController();
    controller.abort();
    await expect(streamJsonl({ filePath, signal: controller.signal, onLine: () => undefined })).rejects.toMatchObject({ name: "AbortError" });
  });
});
