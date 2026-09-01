import { describe, expect, it } from "vitest";
import {
  CodexAppServerClient,
  type CodexProcessTransport,
} from "../../src/providers/index";

class FakeTransport implements CodexProcessTransport {
  readonly messages: Array<Record<string, unknown>> = [];
  killed = false;
  inputClosed = false;
  respond?: (message: Record<string, unknown>, transport: FakeTransport) => void;
  exitOnClose = true;
  private stdoutListener: (chunk: Uint8Array) => void = () => undefined;
  private errorListener: (error: NodeJS.ErrnoException) => void = () => undefined;
  private exitListener: (
    code: number | null,
    signal: NodeJS.Signals | null,
  ) => void = () => undefined;

  write(data: string): void {
    const message = JSON.parse(data) as Record<string, unknown>;
    this.messages.push(message);
    this.respond?.(message, this);
  }

  closeInput(): void {
    this.inputClosed = true;
    if (this.exitOnClose) {
      this.exitListener(0, null);
    }
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

  emitMessage(message: unknown): void {
    this.stdoutListener(Buffer.from(JSON.stringify(message) + "\n"));
  }

  emitRaw(line: string): void {
    this.stdoutListener(Buffer.from(line + "\n"));
  }

  emitError(error: NodeJS.ErrnoException): void {
    this.errorListener(error);
  }

  emitExit(code: number | null = 1): void {
    this.exitListener(code, null);
  }
}

function createResponsiveTransport(): FakeTransport {
  const transport = new FakeTransport();
  transport.respond = (message, current) => {
    if (message.method === "initialize") {
      current.emitMessage({ id: message.id, result: { platformOs: "windows" } });
    }
  };
  return transport;
}

describe("CodexAppServerClient", () => {
  it("handshakes once and exposes only sanitized read operations", async () => {
    const transport = createResponsiveTransport();
    transport.respond = (message, current) => {
      if (message.method === "initialize") {
        current.emitMessage({ id: message.id, result: { platformOs: "windows" } });
      } else if (message.method === "account/read") {
        current.emitMessage({
          id: message.id,
          result: {
            account: {
              type: "chatgpt",
              email: "discarded@example.invalid",
              planType: "example-plan",
            },
            requiresOpenaiAuth: false,
          },
        });
      } else if (message.method === "account/rateLimits/read") {
        current.emitMessage({
          id: message.id,
          result: {
            rateLimits: {
              primary: { usedPercent: 12, windowDurationMins: 300 },
            },
          },
        });
      }
    };
    const client = new CodexAppServerClient({
      processFactory: () => transport,
      requestTimeoutMs: 100,
    });

    const account = await client.readAccount();
    const limits = await client.readRateLimits();
    await client.close();

    expect(account).toEqual({
      account: { type: "chatgpt", planType: "example-plan" },
      requiresOpenaiAuth: false,
    });
    expect(limits.rateLimits.primary?.usedPercent).toBe(12);
    expect(transport.messages.map(({ method }) => method)).toEqual([
      "initialize",
      "initialized",
      "account/read",
      "account/rateLimits/read",
    ]);
    expect(transport.messages.map(({ id }) => id).filter(Boolean)).toEqual([
      1, 2, 3,
    ]);
    expect(transport.inputClosed).toBe(true);
    expect(transport.killed).toBe(false);
  });

  it("times out a request without retaining a raw response", async () => {
    const transport = createResponsiveTransport();
    const client = new CodexAppServerClient({
      processFactory: () => transport,
      requestTimeoutMs: 10,
    });

    await expect(client.readRateLimits()).rejects.toMatchObject({
      reason: "timeout",
    });
    expect(transport.killed).toBe(true);
    await client.close();
  });

  it("rejects malformed stdout and terminates the transport", async () => {
    const transport = createResponsiveTransport();
    transport.respond = (message, current) => {
      if (message.method === "initialize") {
        current.emitMessage({ id: message.id, result: {} });
      } else if (message.method === "account/rateLimits/read") {
        current.emitRaw("not-json");
      }
    };
    const client = new CodexAppServerClient({
      processFactory: () => transport,
      requestTimeoutMs: 100,
    });

    await expect(client.readRateLimits()).rejects.toMatchObject({
      reason: "malformed_response",
    });
    expect(transport.killed).toBe(true);
  });

  it("maps a missing executable without exposing the system error", async () => {
    const transport = new FakeTransport();
    transport.respond = (_message, current) => {
      current.emitError(
        Object.assign(new Error("private executable path"), { code: "ENOENT" }),
      );
    };
    const client = new CodexAppServerClient({
      processFactory: () => transport,
      requestTimeoutMs: 100,
    });

    await expect(client.connect()).rejects.toMatchObject({
      reason: "not_installed",
      message: "Codex CLI is not installed or is not available on PATH.",
    });
    expect(transport.killed).toBe(true);
  });

  it("rejects pending work when the App Server exits", async () => {
    const transport = createResponsiveTransport();
    transport.respond = (message, current) => {
      if (message.method === "initialize") {
        current.emitMessage({ id: message.id, result: {} });
      } else if (message.method === "account/rateLimits/read") {
        current.emitExit();
      }
    };
    const client = new CodexAppServerClient({
      processFactory: () => transport,
      requestTimeoutMs: 100,
    });

    await expect(client.readRateLimits()).rejects.toMatchObject({
      reason: "process_exited",
    });
  });

  it("forces shutdown when the process does not exit after stdin closes", async () => {
    const transport = createResponsiveTransport();
    transport.exitOnClose = false;
    const client = new CodexAppServerClient({
      processFactory: () => transport,
      requestTimeoutMs: 100,
      shutdownTimeoutMs: 5,
    });

    await client.connect();
    await client.close();

    expect(transport.inputClosed).toBe(true);
    expect(transport.killed).toBe(true);
  });
});
