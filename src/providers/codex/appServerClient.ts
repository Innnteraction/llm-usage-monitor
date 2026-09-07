import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod";
import {
  CODEX_ACCOUNT_READ_METHOD,
  CODEX_RATE_LIMITS_READ_METHOD,
  codexAccountReadParamsSchema,
  codexAccountResponseSchema,
  codexRateLimitsReadParamsSchema,
  codexRateLimitsResponseSchema,
  type CodexAccountResponse,
  type CodexRateLimitsResponse,
} from "./protocol";
import { resolveCliBinaryPath } from "../../main/platform/index";

const INITIALIZE_METHOD = "initialize";
const INITIALIZED_METHOD = "initialized";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1_000;
const MAX_BUFFER_BYTES = 1024 * 1024;
const initializeResponseSchema = z.object({}).passthrough();

export type CodexAppServerFailure =
  | "not_installed"
  | "spawn_failed"
  | "timeout"
  | "process_exited"
  | "malformed_response"
  | "rpc_error"
  | "closed";

const FAILURE_MESSAGES: Record<CodexAppServerFailure, string> = {
  not_installed: "Codex CLI is not installed or is not available on PATH.",
  spawn_failed: "Codex App Server could not be started.",
  timeout: "Codex App Server did not respond before the timeout.",
  process_exited: "Codex App Server exited before completing the request.",
  malformed_response: "Codex App Server returned an unsupported response.",
  rpc_error: "Codex App Server rejected the request.",
  closed: "Codex App Server client is closed.",
};

export class CodexAppServerError extends Error {
  readonly reason: CodexAppServerFailure;

  constructor(reason: CodexAppServerFailure) {
    super(FAILURE_MESSAGES[reason]);
    this.name = "CodexAppServerError";
    this.reason = reason;
  }
}

export interface CodexProcessTransport {
  write(data: string): void;
  closeInput(): void;
  kill(): void;
  onStdout(listener: (chunk: Uint8Array) => void): void;
  onError(listener: (error: NodeJS.ErrnoException) => void): void;
  onExit(
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): void;
}

export type CodexProcessFactory = (command: string) => CodexProcessTransport;

interface PendingRequest<T = unknown> {
  schema: z.ZodType<T>;
  resolve(value: T): void;
  reject(error: CodexAppServerError): void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface CodexAppServerClientOptions {
  command?: string;
  requestTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  processFactory?: CodexProcessFactory;
}

function createNodeTransport(command: string): CodexProcessTransport {
  const child = spawn(command, ["app-server", "--stdio"], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "ignore"],
  });

  return {
    write(data) {
      child.stdin.write(data);
    },
    closeInput() {
      child.stdin.end();
    },
    kill() {
      child.kill();
    },
    onStdout(listener) {
      child.stdout.on("data", listener);
    },
    onError(listener) {
      child.once("error", listener);
      child.stdin.once("error", listener);
      child.stdout.once("error", listener);
    },
    onExit(listener) {
      child.once("exit", listener);
    },
  };
}

export class CodexAppServerClient {
  private readonly command: string;
  private readonly requestTimeoutMs: number;
  private readonly shutdownTimeoutMs: number;
  private readonly processFactory: CodexProcessFactory;
  private decoder = new StringDecoder("utf8");
  private readonly pending = new Map<number, PendingRequest>();
  private readonly exitWaiters = new Set<() => void>();
  private transport?: CodexProcessTransport;
  private connectPromise?: Promise<void>;
  private receiveBuffer = "";
  private nextRequestId = 1;
  private ready = false;
  private closed = false;

  constructor(options: CodexAppServerClientOptions = {}) {
    this.command = options.command ?? resolveCliBinaryPath("codex");
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.shutdownTimeoutMs =
      options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    this.processFactory = options.processFactory ?? createNodeTransport;
  }

  async connect(): Promise<void> {
    if (this.closed) {
      throw new CodexAppServerError("closed");
    }
    if (this.ready) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.connectInternal().finally(() => {
      this.connectPromise = undefined;
    });
    return this.connectPromise;
  }

  async readAccount(): Promise<CodexAccountResponse> {
    await this.connect();
    return this.request(
      CODEX_ACCOUNT_READ_METHOD,
      codexAccountReadParamsSchema.parse({}),
      codexAccountResponseSchema,
    );
  }

  async readRateLimits(): Promise<CodexRateLimitsResponse> {
    await this.connect();
    return this.request(
      CODEX_RATE_LIMITS_READ_METHOD,
      codexRateLimitsReadParamsSchema.parse({}),
      codexRateLimitsResponseSchema,
    );
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.ready = false;
    this.rejectPending(new CodexAppServerError("closed"));

    const transport = this.transport;
    this.transport = undefined;
    if (!transport) {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        this.exitWaiters.delete(finish);
        resolve();
      };
      const timeout = setTimeout(() => {
        transport.kill();
        finish();
      }, this.shutdownTimeoutMs);
      this.exitWaiters.add(finish);
      transport.closeInput();
    });
  }

  private async connectInternal(): Promise<void> {
    this.decoder = new StringDecoder("utf8");
    this.receiveBuffer = "";
    try {
      this.transport = this.processFactory(this.command);
    } catch (error) {
      throw new CodexAppServerError(
        isMissingExecutable(error) ? "not_installed" : "spawn_failed",
      );
    }

    this.transport.onStdout((chunk) => this.receive(chunk));
    this.transport.onError((error) => {
      this.failConnection(
        new CodexAppServerError(
          isMissingExecutable(error) ? "not_installed" : "spawn_failed",
        ),
      );
    });
    this.transport.onExit(() => {
      this.ready = false;
      this.transport = undefined;
      this.rejectPending(new CodexAppServerError("process_exited"));
      for (const waiter of this.exitWaiters) {
        waiter();
      }
      this.exitWaiters.clear();
    });

    await this.request(
      INITIALIZE_METHOD,
      {
        clientInfo: {
          name: "llm-usage-monitor",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: false,
        },
      },
      initializeResponseSchema,
    );

    if (!this.transport) {
      throw new CodexAppServerError("process_exited");
    }
    this.transport.write(
      JSON.stringify({ method: INITIALIZED_METHOD }) + "\n",
    );
    this.ready = true;
  }

  private request<T>(
    method: string,
    params: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const transport = this.transport;
    if (!transport) {
      return Promise.reject(new CodexAppServerError("process_exited"));
    }

    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        const error = new CodexAppServerError("timeout");
        reject(error);
        this.failConnection(error);
      }, this.requestTimeoutMs);
      this.pending.set(id, { schema, resolve, reject, timeout });
      transport.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  private receive(chunk: Uint8Array): void {
    this.receiveBuffer += this.decoder.write(Buffer.from(chunk));
    if (Buffer.byteLength(this.receiveBuffer, "utf8") > MAX_BUFFER_BYTES) {
      this.failConnection(new CodexAppServerError("malformed_response"));
      return;
    }

    let newlineIndex = this.receiveBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.receiveBuffer.slice(0, newlineIndex).trim();
      this.receiveBuffer = this.receiveBuffer.slice(newlineIndex + 1);
      if (line) {
        this.receiveLine(line);
      }
      newlineIndex = this.receiveBuffer.indexOf("\n");
    }
  }

  private receiveLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.failConnection(new CodexAppServerError("malformed_response"));
      return;
    }
    if (!isRecord(message) || !Number.isInteger(message.id)) {
      return;
    }

    const id = message.id as number;
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    this.pending.delete(id);
    clearTimeout(pending.timeout);

    if ("error" in message) {
      pending.reject(new CodexAppServerError("rpc_error"));
      return;
    }
    if (!("result" in message)) {
      pending.reject(new CodexAppServerError("malformed_response"));
      return;
    }

    const parsed = pending.schema.safeParse(message.result);
    if (!parsed.success) {
      pending.reject(new CodexAppServerError("malformed_response"));
      return;
    }
    pending.resolve(parsed.data);
  }

  private failConnection(error: CodexAppServerError): void {
    this.ready = false;
    this.receiveBuffer = "";
    this.decoder = new StringDecoder("utf8");
    this.rejectPending(error);
    const transport = this.transport;
    this.transport = undefined;
    transport?.kill();
  }

  private rejectPending(error: CodexAppServerError): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingExecutable(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
