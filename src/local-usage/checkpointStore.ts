import { mkdir, readFile, realpath, open, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { localTokenUsageSchema } from "../shared/index";
import { z } from "zod";
import type {
  LocalUsageCheckpointState,
  LocalUsageProviderId,
  ProviderCheckpointSection,
} from "./types";

export const LOCAL_USAGE_INDEX_FILENAME = "local-usage-index-v2.json";

const safeIntegerSchema = z.number().int().nonnegative().safe();
const timestampSchema = z.string().datetime({ offset: true });
const contributionSchema = z
  .object({
    inputTokens: safeIntegerSchema,
    outputTokens: safeIntegerSchema,
    cacheReadTokens: safeIntegerSchema.optional(),
    cacheWriteTokens: safeIntegerSchema.optional(),
  })
  .strict();
const fileCheckpointSchema = z
  .object({
    fileKey: z.string().regex(/^[a-f0-9]{64}$/),
    identity: z.string().regex(/^[a-f0-9]{64}$/),
    size: safeIntegerSchema,
    mtimeMs: safeIntegerSchema,
    offset: safeIntegerSchema,
    boundaryHash: z.string().regex(/^[a-f0-9]{64}$/),
    errorCount: safeIntegerSchema.optional(),
    observedFrom: timestampSchema.optional(),
    contribution: contributionSchema,
    lastCumulative: contributionSchema.optional(),
    messages: z
      .record(z.string().regex(/^[a-f0-9]{64}$/), contributionSchema)
      .optional(),
  })
  .strict();
const sectionSchema = z
  .object({ files: z.record(z.string().regex(/^[a-f0-9]{64}$/), fileCheckpointSchema), rootKey: z.string().regex(/^[a-f0-9]{64}$/).optional(), summary: localTokenUsageSchema.optional() })
  .strict();
const checkpointStateSchema = z
  .object({
    schemaVersion: z.literal(2),
    providers: z
      .object({ codex: sectionSchema, claude: sectionSchema })
      .strict(),
  })
  .strict();

const emptySection = (): ProviderCheckpointSection => ({ files: {} });
export const emptyCheckpointState = (): LocalUsageCheckpointState => ({
  schemaVersion: 2,
  providers: { codex: emptySection(), claude: emptySection() },
});

const cloneState = (state: LocalUsageCheckpointState): LocalUsageCheckpointState =>
  structuredClone(state);

export class LocalUsageCheckpointStore {
  private state: LocalUsageCheckpointState | undefined;
  private loadPromise: Promise<LocalUsageCheckpointState> | undefined;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly filePath: string) {}

  public async load(): Promise<LocalUsageCheckpointState> {
    if (!this.loadPromise) {
      this.loadPromise = this.readState();
    }
    await this.loadPromise;
    return cloneState(this.state ?? emptyCheckpointState());
  }

  public async updateProvider(
    providerId: LocalUsageProviderId,
    update: (section: ProviderCheckpointSection) => ProviderCheckpointSection,
  ): Promise<LocalUsageCheckpointState> {
    await this.load();
    const pending = this.writeQueue.then(async () => {
      const current = this.state ?? emptyCheckpointState();
      const nextSection = update(structuredClone(current.providers[providerId]));
      const next = {
        ...current,
        providers: { ...current.providers, [providerId]: nextSection },
      } as LocalUsageCheckpointState;
      const parsed = checkpointStateSchema.parse(next) as LocalUsageCheckpointState;
      this.state = parsed;
      await this.writeState(parsed).catch(() => undefined);
    });
    this.writeQueue = pending.catch(() => undefined);
    await pending;
    return cloneState(this.state ?? emptyCheckpointState());
  }

  private async readState(): Promise<LocalUsageCheckpointState> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = checkpointStateSchema.safeParse(JSON.parse(raw));
      this.state = parsed.success
        ? (parsed.data as LocalUsageCheckpointState)
        : emptyCheckpointState();
    } catch {
      this.state = emptyCheckpointState();
    }
    return this.state;
  }

  private async writeState(state: LocalUsageCheckpointState): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify(state), "utf8");
      await rename(temporaryPath, this.filePath);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}

export const checkpointHash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
export const rootKey = async (root: string): Promise<string> => {
  let resolved = (await realpath(root).catch(() => path.resolve(root))).replaceAll("\\", "/").replace(/^\/\/\?\//, "");
  if (process.platform === "win32") resolved = resolved.replace(/[A-Z]/g, c => c.toLowerCase());
  return checkpointHash(resolved);
};
export const checkpointFileKey = (root: string, relative: string): string => checkpointHash(root + "\0" + relative.replaceAll("\\", "/"));
export const checkpointIdentity = (birthtimeMs: number): string => checkpointHash(String(Math.trunc(birthtimeMs)));
export const checkpointBoundary = async (filePath: string, offset: number): Promise<string> => {
  const file = await open(filePath, "r");
  try {
    const hash = createHash("sha256");
    for (const start of [0, Math.max(0, offset - 4096)]) {
      const length = Math.min(4096, offset - start);
      const bytes = Buffer.alloc(length);
      const result = await file.read(bytes, 0, length, start);
      if (result.bytesRead !== length) throw new Error("Checkpoint boundary changed");
      hash.update(bytes);
    }
    return hash.digest("hex");
  } finally { await file.close(); }
};
