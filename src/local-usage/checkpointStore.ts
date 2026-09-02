import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  LocalUsageCheckpointState,
  LocalUsageProviderId,
  ProviderCheckpointSection,
} from "./types";

export const LOCAL_USAGE_INDEX_FILENAME = "local-usage-index-v1.json";

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
    fileKey: z.string().min(1).max(128),
    identity: z.string().min(1).max(256),
    size: safeIntegerSchema,
    mtimeMs: safeIntegerSchema,
    offset: safeIntegerSchema,
    boundaryHash: z.string().min(1).max(128),
    observedFrom: timestampSchema.optional(),
    contribution: contributionSchema,
    lastCumulative: contributionSchema.optional(),
    messages: z
      .record(z.string().min(1).max(128), contributionSchema)
      .optional(),
  })
  .strict();
const sectionSchema = z
  .object({ files: z.record(z.string().min(1).max(128), fileCheckpointSchema) })
  .strict();
const checkpointStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    providers: z
      .object({ codex: sectionSchema, claude: sectionSchema })
      .strict(),
  })
  .strict();

const emptySection = (): ProviderCheckpointSection => ({ files: {} });
export const emptyCheckpointState = (): LocalUsageCheckpointState => ({
  schemaVersion: 1,
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
    return cloneState(await this.loadPromise);
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
      await this.writeState(parsed);
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
