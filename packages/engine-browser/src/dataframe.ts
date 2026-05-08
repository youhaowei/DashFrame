import type {
  DataFrame,
  DataFrameFactory,
  DataFrameJSON,
  DataFrameStorageLocation,
  UUID,
} from "@dashframe/engine";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { generateArrowKey, persistArrowData } from "./storage";

/**
 * BrowserDataFrame - Browser implementation of DataFrame.
 *
 * A lightweight reference with explicit storage location.
 * Does NOT contain actual data - instead knows WHERE to find it.
 */
export class BrowserDataFrame implements DataFrame {
  readonly id: UUID;
  readonly storage: DataFrameStorageLocation;
  readonly fieldIds: UUID[];
  readonly primaryKey?: string | string[];
  readonly createdAt: number;

  constructor(config: DataFrameJSON) {
    this.id = config.id;
    this.storage = config.storage;
    this.fieldIds = config.fieldIds;
    this.primaryKey = config.primaryKey;
    this.createdAt = config.createdAt;
  }

  /**
   * Entry point to query operations - loads data and returns QueryBuilder.
   * Import QueryBuilder dynamically to avoid circular dependency.
   */
  async load(conn: AsyncDuckDBConnection) {
    const { QueryBuilder } = await import("./query-builder");
    return new QueryBuilder(this, conn);
  }

  /**
   * Serialize DataFrame for storage.
   */
  toJSON(): DataFrameJSON {
    return {
      id: this.id,
      storage: this.storage,
      fieldIds: this.fieldIds,
      primaryKey: this.primaryKey,
      createdAt: this.createdAt,
    };
  }

  /**
   * Deserialize DataFrame from storage.
   */
  static fromJSON(data: DataFrameJSON): BrowserDataFrame {
    return new BrowserDataFrame(data);
  }

  /**
   * Create DataFrame from Arrow buffer with automatic IndexedDB storage.
   */
  static async create(
    arrowBuffer: Uint8Array,
    fieldIds: UUID[],
    options?: {
      storageType?: "indexeddb" | "s3" | "r2";
      primaryKey?: string | string[];
    },
  ): Promise<BrowserDataFrame> {
    const id = crypto.randomUUID();
    const storageType = options?.storageType ?? "indexeddb";

    let storage: DataFrameStorageLocation;

    switch (storageType) {
      case "indexeddb": {
        const key = generateArrowKey(id);
        await persistArrowData(key, arrowBuffer);
        storage = { type: "indexeddb", key };
        break;
      }
      case "s3":
        throw new Error("S3 storage not yet implemented");
      case "r2":
        throw new Error("R2 storage not yet implemented");
      default:
        throw new Error(`Unsupported storage type: ${storageType}`);
    }

    return new BrowserDataFrame({
      id,
      storage,
      fieldIds,
      primaryKey: options?.primaryKey,
      createdAt: Date.now(),
    });
  }

  /**
   * Get storage type for UI/display purposes.
   */
  getStorageType(): string {
    switch (this.storage.type) {
      case "indexeddb":
        return "Browser Storage";
      case "s3":
        return "AWS S3";
      case "r2":
        return "Cloudflare R2";
      default:
        return "Unknown";
    }
  }
}

/**
 * Factory for creating BrowserDataFrames.
 */
export const browserDataFrameFactory: DataFrameFactory = {
  create: BrowserDataFrame.create,
  fromJSON: BrowserDataFrame.fromJSON,
};

// Type alias for backward compatibility
export { BrowserDataFrame as DataFrame };
