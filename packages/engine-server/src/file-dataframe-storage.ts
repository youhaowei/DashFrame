import type { DataFrameStorage } from "@dashframe/engine";
import type { UUID } from "@dashframe/types";
import {
  DataType,
  RecordBatch,
  RecordBatchReader,
  RecordBatchStreamWriter,
  Table,
  tableToIPC,
  type Schema,
  util,
} from "apache-arrow";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";

const FRAME_EXTENSION = ".arrow";
const TRASH_DIRECTORY = ".trash";
const UUID_FRAGMENT =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID_PATTERN = new RegExp(`^${UUID_FRAGMENT}$`, "i");
const DELETE_TOKEN_PATTERN = new RegExp(
  `^(${UUID_FRAGMENT})\\.(${UUID_FRAGMENT})$`,
  "i",
);
const SAVE_TEMP_PATTERN = new RegExp(
  `^\\.${UUID_FRAGMENT}\\.\\d+\\.${UUID_FRAGMENT}\\.tmp$`,
  "i",
);

async function syncDirectory(directory: string): Promise<void> {
  const handle = await fs.open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectoryIfExists(
  directory: string,
  sync: (directory: string) => Promise<void>,
): Promise<void> {
  try {
    await sync(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function ensureDirectory(
  directory: string,
  sync: (directory: string) => Promise<void>,
): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  await sync(path.dirname(directory));
  await sync(directory);
}

function isEnoent(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function statIfExists(
  file: string,
): Promise<Awaited<ReturnType<typeof fs.stat>> | null> {
  try {
    return await fs.stat(file);
  } catch (error) {
    if (isEnoent(error)) return null;
    throw error;
  }
}

function isSameGeneration(
  left: Awaited<ReturnType<typeof fs.stat>>,
  right: Awaited<ReturnType<typeof fs.stat>>,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

class StagedDeleteCollisionError extends Error {
  constructor(
    readonly id: UUID,
    readonly token: string,
  ) {
    super(
      `Cannot roll back staged DataFrame delete ${token}: active frame ${id} contains a newer generation`,
    );
    this.name = "StagedDeleteCollisionError";
  }
}

interface TransferWaiter {
  position: number;
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * Couples Arrow's internal byte queue to Node stream backpressure. The Arrow
 * writer serializes one record batch synchronously, so waiting until those
 * bytes cross this bounded transform prevents the next input payload from
 * being requested while the current batch is still queued in the writer.
 */
class TransferCounter extends Transform {
  private position = 0;
  private terminalFailure: Error | null = null;
  private readonly waiters: TransferWaiter[] = [];

  constructor() {
    super({ highWaterMark: 64 * 1024 });
  }

  waitFor(position: number): Promise<void> {
    if (this.position >= position) return Promise.resolve();
    if (this.terminalFailure) return Promise.reject(this.terminalFailure);
    return new Promise((resolve, reject) => {
      this.waiters.push({ position, resolve, reject });
    });
  }

  override _transform(
    chunk: Buffer,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.position += chunk.byteLength;
    this.resolveWaiters();
    callback(null, chunk);
  }

  override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void,
  ): void {
    const failure = error ?? new Error("Arrow output stream closed early");
    this.terminalFailure = failure;
    for (const waiter of this.waiters.splice(0)) waiter.reject(failure);
    callback(error);
  }

  private resolveWaiters(): void {
    for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.waiters[index];
      if (waiter && this.position >= waiter.position) {
        this.waiters.splice(index, 1);
        waiter.resolve();
      }
    }
  }
}

class ObservableRecordBatchStreamWriter extends RecordBatchStreamWriter {
  get outputPosition(): number {
    return this._position;
  }
}

function schemasHaveSameLogicalFields(left: Schema, right: Schema): boolean {
  return (
    left.fields.length === right.fields.length &&
    left.fields.every((field, index) => {
      const other = right.fields[index];
      if (!other) return false;
      if (
        field.name !== other.name ||
        field.nullable !== other.nullable ||
        field.type.toString() !== other.type.toString()
      ) {
        return false;
      }
      if (
        DataType.isDictionary(field.type) &&
        DataType.isDictionary(other.type) &&
        field.type.isOrdered !== other.type.isOrdered
      ) {
        return false;
      }
      return true;
    })
  );
}

async function appendArrowPayload(
  writer: ObservableRecordBatchStreamWriter,
  counter: TransferCounter,
  payload: Uint8Array,
  expectedSchema: Schema | null,
): Promise<{ payloadSchema: Schema; populatedSchema: Schema | null }> {
  const reader = RecordBatchReader.from(payload).open({
    autoDestroy: false,
  });
  let populatedSchema = expectedSchema;
  try {
    for await (const batch of reader) {
      if (batch.numRows === 0) continue;
      if (!populatedSchema) {
        populatedSchema = reader.schema;
        writer.reset(undefined, populatedSchema);
        await counter.waitFor(writer.outputPosition);
      } else if (
        !schemasHaveSameLogicalFields(populatedSchema, reader.schema)
      ) {
        throw new Error("Arrow batch schema does not match the first payload");
      }
      const normalizedBatch = util.compareSchemas(populatedSchema, batch.schema)
        ? batch
        : new RecordBatch(populatedSchema, batch.data);
      writer.write(normalizedBatch);
      await counter.waitFor(writer.outputPosition);
    }
    return { payloadSchema: reader.schema, populatedSchema };
  } finally {
    await reader.cancel();
  }
}

/** Durable Arrow IPC storage rooted inside one DashFrame project. */
export class FileDataFrameStorage implements DataFrameStorage {
  constructor(
    readonly directory: string,
    private readonly sync = syncDirectory,
  ) {}

  private framePath(id: UUID): string {
    if (!UUID_PATTERN.test(id)) {
      throw new Error(`Invalid DataFrame id: ${id}`);
    }
    return path.join(this.directory, `${id}${FRAME_EXTENSION}`);
  }

  async save(id: UUID, data: Uint8Array): Promise<void> {
    const target = this.framePath(id);
    await ensureDirectory(this.directory, this.sync);
    const temporary = path.join(
      this.directory,
      `.${id}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      const handle = await fs.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, target);
      // The file sync makes its bytes durable; the directory sync makes the
      // atomic rename durable before metadata is allowed to reference it.
      await this.sync(this.directory);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async saveBatches(
    id: UUID,
    batches: AsyncIterable<Uint8Array>,
  ): Promise<void> {
    const target = this.framePath(id);
    await ensureDirectory(this.directory, this.sync);
    const temporary = path.join(
      this.directory,
      `.${id}.${process.pid}.${randomUUID()}.tmp`,
    );
    const output = createWriteStream(temporary, { flags: "wx", mode: 0o600 });
    const counter = new TransferCounter();
    const writer = new ObservableRecordBatchStreamWriter({
      autoDestroy: false,
    });
    const serialized = Readable.from(writer, {
      highWaterMark: 64 * 1024,
      objectMode: false,
    });
    const outputComplete = pipeline(serialized, counter, output);
    // The provider may pause between pages after the filesystem has already
    // failed. Observe the rejection immediately, then await the same promise
    // below when producer work reaches its normal failure boundary.
    outputComplete.catch(() => undefined);

    try {
      let expectedSchema: Schema | null = null;
      let emptyResultSchema: Schema | null = null;

      for await (const payload of batches) {
        const appended = await appendArrowPayload(
          writer,
          counter,
          payload,
          expectedSchema,
        );
        emptyResultSchema ??= appended.payloadSchema;
        expectedSchema = appended.populatedSchema;
      }

      if (!expectedSchema) {
        if (!emptyResultSchema) {
          throw new Error("Cannot save Arrow batches without a schema payload");
        }
        writer.reset(undefined, emptyResultSchema);
        await counter.waitFor(writer.outputPosition);
      }

      writer.close();
      await outputComplete;
      const handle = await fs.open(temporary, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, target);
      await this.sync(this.directory);
    } catch (error) {
      serialized.destroy();
      counter.destroy();
      output.destroy();
      await outputComplete.catch(() => undefined);
      throw error;
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async load(id: UUID): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await fs.readFile(this.framePath(id)));
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  }

  async *loadBatches(id: UUID): AsyncIterable<Uint8Array> {
    const input = createReadStream(this.framePath(id));
    let reader: Awaited<ReturnType<typeof RecordBatchReader.from>> | null =
      null;
    try {
      reader = await RecordBatchReader.from(input);
      await reader.open({ autoDestroy: false });
      let foundBatch = false;
      for await (const batch of reader) {
        foundBatch = true;
        yield tableToIPC(new Table(reader.schema, batch), "stream");
      }
      if (!foundBatch) {
        yield tableToIPC(new Table(reader.schema), "stream");
      }
    } finally {
      await reader?.cancel();
      input.destroy();
    }
  }

  async delete(id: UUID): Promise<void> {
    await fs.rm(this.framePath(id), { force: true });
    await syncDirectoryIfExists(this.directory, this.sync);
  }

  async stageDelete(id: UUID): Promise<string | null> {
    const target = this.framePath(id);
    const token = `${id}.${randomUUID()}`;
    const trashDirectory = path.join(this.directory, TRASH_DIRECTORY);
    await ensureDirectory(trashDirectory, this.sync);
    try {
      // Preserve the active name while metadata still references it. The hard
      // link is the recovery copy; final deletion happens only after commit.
      await fs.link(target, path.join(trashDirectory, token));
      await this.sync(trashDirectory);
      return token;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  }

  async commitDelete(token: string): Promise<void> {
    const { id, trash } = this.parseDeleteToken(token);
    const staged = await statIfExists(trash);
    if (!staged) return;

    const active = this.framePath(id);
    const activeStat = await statIfExists(active);
    if (activeStat && isSameGeneration(staged, activeStat)) {
      await fs.unlink(active);
      await this.sync(this.directory);
    }

    await fs.rm(trash, { force: true });
    await syncDirectoryIfExists(
      path.join(this.directory, TRASH_DIRECTORY),
      this.sync,
    );
  }

  async rollbackDelete(token: string): Promise<void> {
    const { id, trash } = this.parseDeleteToken(token);
    const staged = await statIfExists(trash);
    if (!staged) return;

    const active = this.framePath(id);
    const activeStat = await statIfExists(active);
    if (activeStat && !isSameGeneration(staged, activeStat)) {
      throw new StagedDeleteCollisionError(id, token);
    }
    if (!activeStat) {
      try {
        await fs.link(trash, active);
        await this.sync(this.directory);
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "EEXIST"
          )
        ) {
          throw error;
        }
        const racedActive = await fs.stat(active);
        if (!isSameGeneration(staged, racedActive)) {
          throw new StagedDeleteCollisionError(id, token);
        }
      }
    }

    await fs.rm(trash, { force: true });
    await syncDirectoryIfExists(
      path.join(this.directory, TRASH_DIRECTORY),
      this.sync,
    );
  }

  async recoverStagedDeletes(referencedIds: readonly UUID[]): Promise<void> {
    await this.removeStaleSaveTemps();
    const referenced = new Set(referencedIds);
    const trashDirectory = path.join(this.directory, TRASH_DIRECTORY);
    let tokens: string[];
    try {
      tokens = await fs.readdir(trashDirectory);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }
    for (const token of tokens) {
      await this.recoverDeleteToken(token, referenced);
    }
  }

  private async recoverDeleteToken(
    token: string,
    referenced: ReadonlySet<UUID>,
  ): Promise<void> {
    const match = DELETE_TOKEN_PATTERN.exec(token);
    if (!match) return;
    const id = match[1] as UUID;
    if (!referenced.has(id)) {
      await this.commitDelete(token);
      return;
    }
    try {
      await this.rollbackDelete(token);
    } catch (error) {
      if (!(error instanceof StagedDeleteCollisionError)) throw error;
      // The active path is a later save and therefore the committed bytes for
      // this ID. Finalize only the older staged generation; commitDelete
      // compares inode generations and cannot unlink the replacement.
      console.error(
        `[dashframe] ${error.message}; discarding the older staged generation during recovery`,
      );
      await this.commitDelete(token);
    }
  }

  async hasPendingDataFrameDeletes(): Promise<boolean> {
    try {
      const tokens = await fs.readdir(
        path.join(this.directory, TRASH_DIRECTORY),
      );
      return tokens.some((token) => DELETE_TOKEN_PATTERN.test(token));
    } catch (error) {
      if (isEnoent(error)) return false;
      throw error;
    }
  }

  private parseDeleteToken(token: string): { id: UUID; trash: string } {
    const match = DELETE_TOKEN_PATTERN.exec(token);
    if (!match) throw new Error("Invalid delete token");
    return {
      id: match[1] as UUID,
      trash: path.join(this.directory, TRASH_DIRECTORY, token),
    };
  }

  private async removeStaleSaveTemps(): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.directory);
    } catch (error) {
      if (isEnoent(error)) return;
      throw error;
    }
    const stale = entries.filter((entry) => SAVE_TEMP_PATTERN.test(entry));
    if (stale.length === 0) return;
    await Promise.all(
      stale.map((entry) =>
        fs.rm(path.join(this.directory, entry), { force: true }),
      ),
    );
    await this.sync(this.directory);
  }

  async exists(id: UUID): Promise<boolean> {
    try {
      await fs.access(this.framePath(id));
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return false;
      }
      throw error;
    }
  }

  async list(): Promise<UUID[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.directory);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return [];
      }
      throw error;
    }
    return entries
      .filter((entry) => entry.endsWith(FRAME_EXTENSION))
      .map((entry) => entry.slice(0, -FRAME_EXTENSION.length))
      .filter((id): id is UUID => UUID_PATTERN.test(id));
  }

  async getUsage(): Promise<{ count: number; totalBytes: number }> {
    const ids = await this.list();
    const sizes = await Promise.all(
      ids.map(async (id) => (await fs.stat(this.framePath(id))).size),
    );
    return {
      count: ids.length,
      totalBytes: sizes.reduce((total, size) => total + size, 0),
    };
  }
}
