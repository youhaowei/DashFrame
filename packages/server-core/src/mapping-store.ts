/** Durable host-local SecretVault ref mappings. No credential plaintext. */
import type {
  MappingRecord,
  MappingStore,
  SecretRef,
} from "@wystack/secret-vault";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

interface PersistedMappings {
  version: 1;
  mappings: Record<string, MappingRecord>;
}

/**
 * Host-local MappingStore for secrets that belong to the current Workspace,
 * not to a copiable Project artifact.
 */
export class FileMappingStore implements MappingStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  get(ref: SecretRef): Promise<MappingRecord | undefined> {
    return this.exclusive(async () => {
      const record = (await this.read()).mappings[ref];
      return record ? { ...record } : undefined;
    });
  }

  set(ref: SecretRef, record: MappingRecord): Promise<void> {
    return this.exclusive(async () => {
      const file = await this.read();
      file.mappings[ref] = { ...record };
      await this.write(file);
    });
  }

  delete(ref: SecretRef): Promise<void> {
    return this.exclusive(async () => {
      const file = await this.read();
      if (!(ref in file.mappings)) return;
      delete file.mappings[ref];
      await this.write(file);
    });
  }

  has(ref: SecretRef): Promise<boolean> {
    return this.exclusive(async () => ref in (await this.read()).mappings);
  }

  private async read(): Promise<PersistedMappings> {
    try {
      const parsed = JSON.parse(
        await fs.readFile(this.filePath, "utf8"),
      ) as PersistedMappings;
      if (parsed.version !== 1 || typeof parsed.mappings !== "object") {
        throw new Error("Unsupported secret mapping file");
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, mappings: {} };
      }
      throw error;
    }
  }

  private async write(file: PersistedMappings): Promise<void> {
    const directory = path.dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, `.mappings.${randomUUID()}.tmp`);
    try {
      const handle = await fs.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(file, null, 2)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, this.filePath);
      if (process.platform !== "win32") {
        const parent = await fs.open(directory, "r");
        try {
          await parent.sync();
        } finally {
          await parent.close();
        }
      }
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
