/**
 * Unit tests for BrowserDataFrame
 *
 * Tests cover:
 * - DataFrame creation from Arrow buffers
 * - Serialization (toJSON/fromJSON)
 * - Storage location management
 * - Display helpers
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserDataFrame } from "../dataframe";

// Mock storage module
vi.mock("../storage", () => ({
  generateArrowKey: vi.fn((id: string) => `arrow:${id}`),
  persistArrowData: vi.fn(async () => Promise.resolve()),
}));

// ============================================================================
// Test Fixtures
// ============================================================================

function createArrowBuffer(): Uint8Array {
  // Create a minimal valid Arrow IPC buffer
  // For testing, we just need a Uint8Array
  return new Uint8Array([0, 1, 2, 3, 4, 5]);
}

function createFieldIds(count = 3): string[] {
  return Array.from({ length: count }, (_, i) => `field-${i}`);
}

// ============================================================================
// Constructor Tests
// ============================================================================

describe("BrowserDataFrame - Constructor", () => {
  it("should create DataFrame from JSON config", () => {
    const config = {
      id: "df-1" as string,
      storage: {
        type: "indexeddb" as const,
        key: "arrow:df-1",
      },
      fieldIds: createFieldIds(),
      createdAt: Date.now(),
    };

    const df = new BrowserDataFrame(config);

    expect(df.id).toBe("df-1");
    expect(df.storage).toEqual(config.storage);
    expect(df.fieldIds).toEqual(config.fieldIds);
    expect(df.createdAt).toBe(config.createdAt);
  });

  it("should handle primaryKey as string", () => {
    const config = {
      id: "df-1" as string,
      storage: {
        type: "indexeddb" as const,
        key: "arrow:df-1",
      },
      fieldIds: createFieldIds(),
      primaryKey: "id",
      createdAt: Date.now(),
    };

    const df = new BrowserDataFrame(config);

    expect(df.primaryKey).toBe("id");
  });

  it("should handle primaryKey as array", () => {
    const config = {
      id: "df-1" as string,
      storage: {
        type: "indexeddb" as const,
        key: "arrow:df-1",
      },
      fieldIds: createFieldIds(),
      primaryKey: ["id", "timestamp"],
      createdAt: Date.now(),
    };

    const df = new BrowserDataFrame(config);

    expect(df.primaryKey).toEqual(["id", "timestamp"]);
  });

  it("should handle undefined primaryKey", () => {
    const config = {
      id: "df-1" as string,
      storage: {
        type: "indexeddb" as const,
        key: "arrow:df-1",
      },
      fieldIds: createFieldIds(),
      createdAt: Date.now(),
    };

    const df = new BrowserDataFrame(config);

    expect(df.primaryKey).toBeUndefined();
  });
});

// ============================================================================
// Static create() Method Tests
// ============================================================================

describe("BrowserDataFrame.create", () => {
  it("should create DataFrame with IndexedDB storage", async () => {
    const arrowBuffer = createArrowBuffer();
    const fieldIds = createFieldIds();

    const df = await BrowserDataFrame.create(arrowBuffer, fieldIds);

    expect(df).toBeInstanceOf(BrowserDataFrame);
    expect(df.id).toBeDefined();
    expect(df.storage.type).toBe("indexeddb");
    expect(df.fieldIds).toEqual(fieldIds);
    expect(df.createdAt).toBeDefined();
  });

  it("should generate unique IDs for each DataFrame", async () => {
    const arrowBuffer = createArrowBuffer();
    const fieldIds = createFieldIds();

    const df1 = await BrowserDataFrame.create(arrowBuffer, fieldIds);
    const df2 = await BrowserDataFrame.create(arrowBuffer, fieldIds);

    expect(df1.id).not.toBe(df2.id);
  });

  it("should use default storageType when not specified", async () => {
    const arrowBuffer = createArrowBuffer();
    const fieldIds = createFieldIds();

    const df = await BrowserDataFrame.create(arrowBuffer, fieldIds);

    expect(df.storage.type).toBe("indexeddb");
  });

  it("should create DataFrame with explicit storageType", async () => {
    const arrowBuffer = createArrowBuffer();
    const fieldIds = createFieldIds();

    const df = await BrowserDataFrame.create(arrowBuffer, fieldIds, {
      storageType: "indexeddb",
    });

    expect(df.storage.type).toBe("indexeddb");
  });

  it("should throw error for S3 storage (not implemented)", async () => {
    const arrowBuffer = createArrowBuffer();
    const fieldIds = createFieldIds();

    await expect(
      BrowserDataFrame.create(arrowBuffer, fieldIds, {
        storageType: "s3",
      }),
    ).rejects.toThrow("S3 storage not yet implemented");
  });

  it("should throw error for R2 storage (not implemented)", async () => {
    const arrowBuffer = createArrowBuffer();
    const fieldIds = createFieldIds();

    await expect(
      BrowserDataFrame.create(arrowBuffer, fieldIds, {
        storageType: "r2",
      }),
    ).rejects.toThrow("R2 storage not yet implemented");
  });

  it("should throw error for unsupported storage type", async () => {
    const arrowBuffer = createArrowBuffer();
    const fieldIds = createFieldIds();

    await expect(
      BrowserDataFrame.create(arrowBuffer, fieldIds, {
        // @ts-expect-error - Testing runtime validation
        storageType: "unsupported",
      }),
    ).rejects.toThrow("Unsupported storage type");
  });

  it("should handle primaryKey option", async () => {
    const arrowBuffer = createArrowBuffer();
    const fieldIds = createFieldIds();

    const df = await BrowserDataFrame.create(arrowBuffer, fieldIds, {
      primaryKey: "id",
    });

    expect(df.primaryKey).toBe("id");
  });

  it("should handle composite primaryKey", async () => {
    const arrowBuffer = createArrowBuffer();
    const fieldIds = createFieldIds();

    const df = await BrowserDataFrame.create(arrowBuffer, fieldIds, {
      primaryKey: ["id", "version"],
    });

    expect(df.primaryKey).toEqual(["id", "version"]);
  });

  it("should call persistArrowData with correct arguments", async () => {
    const { persistArrowData } = await import("../storage");
    const arrowBuffer = createArrowBuffer();
    const fieldIds = createFieldIds();

    await BrowserDataFrame.create(arrowBuffer, fieldIds);

    expect(persistArrowData).toHaveBeenCalledWith(
      expect.stringMatching(/^arrow:/),
      arrowBuffer,
    );
  });

  it("should set createdAt timestamp", async () => {
    const beforeCreate = Date.now();
    const arrowBuffer = createArrowBuffer();
    const fieldIds = createFieldIds();

    const df = await BrowserDataFrame.create(arrowBuffer, fieldIds);
    const afterCreate = Date.now();

    expect(df.createdAt).toBeGreaterThanOrEqual(beforeCreate);
    expect(df.createdAt).toBeLessThanOrEqual(afterCreate);
  });
});

// ============================================================================
// Serialization Tests
// ============================================================================

describe("BrowserDataFrame serialization", () => {
  let df: BrowserDataFrame;

  beforeEach(() => {
    df = new BrowserDataFrame({
      id: "df-test" as string,
      storage: {
        type: "indexeddb",
        key: "arrow:df-test",
      },
      fieldIds: createFieldIds(3),
      primaryKey: "id",
      createdAt: 1704067200000,
    });
  });

  describe("toJSON", () => {
    it("should serialize to JSON", () => {
      const json = df.toJSON();

      expect(json).toEqual({
        id: "df-test",
        storage: {
          type: "indexeddb",
          key: "arrow:df-test",
        },
        fieldIds: createFieldIds(3),
        primaryKey: "id",
        createdAt: 1704067200000,
      });
    });

    it("should serialize without primaryKey when undefined", () => {
      const dfWithoutPk = new BrowserDataFrame({
        id: "df-no-pk" as string,
        storage: {
          type: "indexeddb",
          key: "arrow:df-no-pk",
        },
        fieldIds: createFieldIds(2),
        createdAt: Date.now(),
      });

      const json = dfWithoutPk.toJSON();

      expect(json.primaryKey).toBeUndefined();
    });

    it("should preserve storage location", () => {
      const json = df.toJSON();

      expect(json.storage.type).toBe("indexeddb");
      expect(json.storage.key).toBe("arrow:df-test");
    });
  });

  describe("fromJSON", () => {
    it("should deserialize from JSON", () => {
      const json = df.toJSON();
      const restored = BrowserDataFrame.fromJSON(json);

      expect(restored).toBeInstanceOf(BrowserDataFrame);
      expect(restored.id).toBe(df.id);
      expect(restored.storage).toEqual(df.storage);
      expect(restored.fieldIds).toEqual(df.fieldIds);
      expect(restored.primaryKey).toBe(df.primaryKey);
      expect(restored.createdAt).toBe(df.createdAt);
    });

    it("should round-trip serialize and deserialize", () => {
      const json = df.toJSON();
      const restored = BrowserDataFrame.fromJSON(json);
      const reserializedJson = restored.toJSON();

      expect(reserializedJson).toEqual(json);
    });

    it("should restore fieldIds array", () => {
      const json = df.toJSON();
      const restored = BrowserDataFrame.fromJSON(json);

      expect(restored.fieldIds).toEqual(df.fieldIds);
      expect(Array.isArray(restored.fieldIds)).toBe(true);
    });

    it("should restore primaryKey", () => {
      const json = df.toJSON();
      const restored = BrowserDataFrame.fromJSON(json);

      expect(restored.primaryKey).toBe("id");
    });

    it("should handle composite primaryKey", () => {
      const dfWithCompositePk = new BrowserDataFrame({
        id: "df-composite" as string,
        storage: {
          type: "indexeddb",
          key: "arrow:df-composite",
        },
        fieldIds: createFieldIds(2),
        primaryKey: ["id", "version"],
        createdAt: Date.now(),
      });

      const json = dfWithCompositePk.toJSON();
      const restored = BrowserDataFrame.fromJSON(json);

      expect(restored.primaryKey).toEqual(["id", "version"]);
    });
  });
});

// ============================================================================
// Display Helper Tests
// ============================================================================

describe("BrowserDataFrame.getStorageType", () => {
  it("should return 'Browser Storage' for IndexedDB", () => {
    const df = new BrowserDataFrame({
      id: "df-1" as string,
      storage: {
        type: "indexeddb",
        key: "arrow:df-1",
      },
      fieldIds: createFieldIds(),
      createdAt: Date.now(),
    });

    expect(df.getStorageType()).toBe("Browser Storage");
  });

  it("should return 'AWS S3' for S3", () => {
    const df = new BrowserDataFrame({
      id: "df-1" as string,
      storage: {
        type: "s3",
        bucket: "my-bucket",
        key: "data/df-1.arrow",
        region: "us-west-2",
      },
      fieldIds: createFieldIds(),
      createdAt: Date.now(),
    });

    expect(df.getStorageType()).toBe("AWS S3");
  });

  it("should return 'Cloudflare R2' for R2", () => {
    const df = new BrowserDataFrame({
      id: "df-1" as string,
      storage: {
        type: "r2",
        bucket: "my-bucket",
        key: "data/df-1.arrow",
        accountId: "account-123",
      },
      fieldIds: createFieldIds(),
      createdAt: Date.now(),
    });

    expect(df.getStorageType()).toBe("Cloudflare R2");
  });

  it("should return 'Unknown' for unrecognized storage type", () => {
    const df = new BrowserDataFrame({
      id: "df-1" as string,
      storage: {
        // @ts-expect-error - Testing runtime validation
        type: "unknown",
      },
      fieldIds: createFieldIds(),
      createdAt: Date.now(),
    });

    expect(df.getStorageType()).toBe("Unknown");
  });
});

// ============================================================================
// load() Method Tests
// ============================================================================

describe("BrowserDataFrame.load", () => {
  it("should return QueryBuilder instance", async () => {
    const df = new BrowserDataFrame({
      id: "df-1" as string,
      storage: {
        type: "indexeddb",
        key: "arrow:df-1",
      },
      fieldIds: createFieldIds(),
      createdAt: Date.now(),
    });

    // Mock AsyncDuckDBConnection
    const mockConnection = {
      query: vi.fn(),
    } as any;

    const queryBuilder = await df.load(mockConnection);

    expect(queryBuilder).toBeDefined();
    // QueryBuilder class is dynamically imported, so we check for constructor
    expect(queryBuilder.constructor.name).toBe("QueryBuilder");
  });

  it("should pass DataFrame and connection to QueryBuilder", async () => {
    const df = new BrowserDataFrame({
      id: "df-1" as string,
      storage: {
        type: "indexeddb",
        key: "arrow:df-1",
      },
      fieldIds: createFieldIds(),
      createdAt: Date.now(),
    });

    const mockConnection = {
      query: vi.fn(),
    } as any;

    const queryBuilder = await df.load(mockConnection);

    // QueryBuilder should have reference to DataFrame and connection
    expect(queryBuilder).toHaveProperty("dataFrame");
    expect(queryBuilder).toHaveProperty("conn");
  });
});

// ============================================================================
// Type Safety Tests
// ============================================================================

describe("BrowserDataFrame type safety", () => {
  it("should enforce storage location type", () => {
    const config = {
      id: "df-1" as string,
      storage: {
        type: "indexeddb" as const,
        key: "arrow:df-1",
      },
      fieldIds: createFieldIds(),
      createdAt: Date.now(),
    };

    const df = new BrowserDataFrame(config);

    expect(df.storage.type).toBe("indexeddb");
    if (df.storage.type === "indexeddb") {
      expect(df.storage.key).toBeDefined();
    }
  });

  it("should allow fieldIds as UUID array", () => {
    const config = {
      id: "df-1" as string,
      storage: {
        type: "indexeddb" as const,
        key: "arrow:df-1",
      },
      fieldIds: [
        "550e8400-e29b-41d4-a716-446655440000",
        "550e8400-e29b-41d4-a716-446655440001",
      ] as string[],
      createdAt: Date.now(),
    };

    const df = new BrowserDataFrame(config);

    expect(df.fieldIds).toHaveLength(2);
    expect(df.fieldIds[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("BrowserDataFrame integration", () => {
  it("should support complete create → serialize → deserialize flow", async () => {
    const arrowBuffer = createArrowBuffer();
    const fieldIds = createFieldIds(5);

    // Create
    const original = await BrowserDataFrame.create(arrowBuffer, fieldIds, {
      primaryKey: "id",
    });

    // Serialize
    const json = original.toJSON();

    // Deserialize
    const restored = BrowserDataFrame.fromJSON(json);

    // Verify
    expect(restored.id).toBe(original.id);
    expect(restored.storage).toEqual(original.storage);
    expect(restored.fieldIds).toEqual(original.fieldIds);
    expect(restored.primaryKey).toEqual(original.primaryKey);
    expect(restored.createdAt).toBe(original.createdAt);
  });

  it("should handle empty fieldIds array", async () => {
    const arrowBuffer = createArrowBuffer();
    const fieldIds: string[] = [];

    const df = await BrowserDataFrame.create(arrowBuffer, fieldIds);

    expect(df.fieldIds).toEqual([]);
  });
});
