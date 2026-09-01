import { describe, expect, it } from "vitest";
import {
  CodexAppServerClient,
  CodexQuotaProvider,
  createCodexInitialSnapshot,
  type CodexProcessTransport,
} from "../../src/providers/index";
import { createUsageStore } from "../../src/usage/index";

class ScriptedAppServer implements CodexProcessTransport {
  readonly methods: string[] = [];
  readonly messages: Array<Record<string, unknown>> = [];
  killed = false;
  private stdoutListener: (chunk: Uint8Array) => void = () => undefined;
  private errorListener: (error: NodeJS.ErrnoException) => void = () => undefined;
  private exitListener: (
    code: number | null,
    signal: NodeJS.Signals | null,
  ) => void = () => undefined;

  constructor(
    private readonly handle: (
      message: Record<string, unknown>,
      server: ScriptedAppServer,
    ) => void,
  ) {}

  write(data: string): void {
    const message = JSON.parse(data) as Record<string, unknown>;
    this.messages.push(message);
    if (typeof message.method === "string") {
      this.methods.push(message.method);
    }
    this.handle(message, this);
  }

  closeInput(): void {
    this.exitListener(0, null);
  }

  kill(): void {
    this.killed = true;
  }

  onStdout(listener: (chunk: Uint8Array) => void): void {
    this.stdoutListener = listener;
  }

  onError(listener: (error: NodeJS.ErrnoException) => void): void {
    this.errorListener = listener;
  }

  onExit(
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): void {
    this.exitListener = listener;
  }

  respond(id: unknown, result: unknown): void {
    this.stdoutListener(Buffer.from(JSON.stringify({ id, result }) + "\n"));
  }

  respondRaw(line: string): void {
    this.stdoutListener(Buffer.from(line + "\n"));
  }
}

const clock = () => new Date("2026-09-01T03:00:00.000Z");

describe("Codex provider integration", () => {
  it("flows fake App Server quota through normalization and the usage store", async () => {
    const server = new ScriptedAppServer((message, current) => {
      if (message.method === "initialize") {
        current.respond(message.id, { platformOs: "windows" });
      } else if (message.method === "account/read") {
        current.respond(message.id, {
          account: {
            type: "chatgpt",
            email: "discarded@example.invalid",
            planType: "example-plan",
          },
          requiresOpenaiAuth: true,
        });
      } else if (message.method === "account/rateLimits/read") {
        current.respond(message.id, {
          rateLimits: {
            primary: { usedPercent: 21, windowDurationMins: 300 },
            secondary: { usedPercent: 34, windowDurationMins: 10_080 },
          },
        });
      }
    });
    const provider = new CodexQuotaProvider({
      clock,
      clientFactory: () =>
        new CodexAppServerClient({
          processFactory: () => server,
          requestTimeoutMs: 100,
        }),
    });
    const store = createUsageStore({
      providers: [provider],
      initialSnapshots: [createCodexInitialSnapshot(clock())],
      clock,
    });

    await store.refresh("codex");

    expect(server.methods).toEqual([
      "initialize",
      "initialized",
      "account/read",
      "account/rateLimits/read",
    ]);
    expect(
      server.messages.find(({ method }) => method === "account/read")?.params,
    ).toEqual({});
    expect(store.getState().providers[0]).toMatchObject({
      providerId: "codex",
      status: "fresh",
      quotaWindows: [
        { kind: "five_hour", usedPercent: 21 },
        { kind: "weekly", usedPercent: 34 },
      ],
    });
    expect(JSON.stringify(store.getState())).not.toContain("discarded@");
    expect(store.getState().refreshing).toEqual([]);
    expect(server.killed).toBe(false);
  });

  it("turns parser failure into a sanitized provider snapshot", async () => {
    const server = new ScriptedAppServer((message, current) => {
      if (message.method === "initialize") {
        current.respond(message.id, {});
      } else if (message.method === "account/read") {
        current.respondRaw("private malformed response");
      }
    });
    const provider = new CodexQuotaProvider({
      clock,
      clientFactory: () =>
        new CodexAppServerClient({
          processFactory: () => server,
          requestTimeoutMs: 100,
        }),
    });

    const snapshot = await provider.fetchQuota();

    expect(snapshot).toMatchObject({
      providerId: "codex",
      status: "unavailable",
      error: { code: "unsupported_output" },
    });
    expect(JSON.stringify(snapshot)).not.toContain("private malformed");
    expect(server.killed).toBe(true);
  });

  it("does not request quota or credential recovery when login is required", async () => {
    const server = new ScriptedAppServer((message, current) => {
      if (message.method === "initialize") {
        current.respond(message.id, {});
      } else if (message.method === "account/read") {
        current.respond(message.id, {
          account: null,
          requiresOpenaiAuth: true,
        });
      }
    });
    const provider = new CodexQuotaProvider({
      clock,
      clientFactory: () =>
        new CodexAppServerClient({
          processFactory: () => server,
          requestTimeoutMs: 100,
        }),
    });

    const snapshot = await provider.fetchQuota();

    expect(server.methods).toEqual([
      "initialize",
      "initialized",
      "account/read",
    ]);
    expect(snapshot.error?.code).toBe("not_authenticated");
    expect(
      server.messages.find(({ method }) => method === "account/read")?.params,
    ).toEqual({});
  });
});
