/**
 * Unit tests for LocalFileConnector
 *
 * Tests cover:
 * - File size validation (source and encoded ingestion limits)
 * - File extension validation
 * - CSV parsing delegation
 * - JSON parsing delegation
 * - Error handling for invalid content
 */
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { LocalFileConnector } from "./connector";

// Mock the format converters to isolate connector dispatch.
vi.mock("@dashframe/csv", () => ({
  parseCSV: vi.fn((text: string) => {
    // Simple mock implementation
    const lines = text.split("\n").filter((line) => line.trim());
    return lines.map((line) => line.split(","));
  }),
  csvToDataFrame: vi.fn().mockResolvedValue({
    arrowBuffer: new Uint8Array([1]),
    fields: [],
    sourceSchema: { columns: [], version: 1, lastSyncedAt: Date.now() },
    rowCount: 2,
    columnCount: 3,
  }),
}));

vi.mock("@dashframe/json", () => ({
  jsonToDataFrame: vi.fn().mockResolvedValue({
    arrowBuffer: new Uint8Array([2]),
    fields: [],
    sourceSchema: { columns: [], version: 1, lastSyncedAt: Date.now() },
    rowCount: 1,
    columnCount: 2,
  }),
}));

describe("LocalFileConnector", () => {
  let connector: LocalFileConnector;

  beforeEach(() => {
    connector = new LocalFileConnector();
    vi.clearAllMocks();
  });

  describe("parse - file size validation", () => {
    it("should reject files exceeding the 16MB source limit", async () => {
      const largeSize = 17 * 1024 * 1024;
      const file = new File(["name,value\na,1"], "large.csv", {
        type: "text/csv",
      });
      Object.defineProperty(file, "size", { value: largeSize });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("File size exceeds 16MB limit");
    });

    it("should accept files at exactly the 16MB source limit", async () => {
      const exactSize = 16 * 1024 * 1024;
      const file = new File(["name,value\na,1"], "exact.csv", {
        type: "text/csv",
      });
      Object.defineProperty(file, "size", { value: exactSize });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe("parse - file extension validation", () => {
    it("should reject unsupported file extensions", async () => {
      const file = new File(["some content"], "document.txt", {
        type: "text/plain",
      });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow(
        "Unsupported file format: .txt. Supported formats: csv, json",
      );
    });
  });

  describe("parse - CSV file handling", () => {
    let mockCsvToDataFrame: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const { csvToDataFrame } = await import("@dashframe/csv");
      mockCsvToDataFrame = vi.mocked(csvToDataFrame);
    });

    it("should handle uppercase CSV extension", async () => {
      const file = new File(["name,value\nAlice,30"], "DATA.CSV", {
        type: "text/csv",
      });

      await connector.parse(
        file,
        "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      );

      expect(mockCsvToDataFrame).toHaveBeenCalled();
    });

    it("should reject empty CSV files", async () => {
      const file = new File([""], "empty.csv", { type: "text/csv" });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("CSV file is empty");
    });

    it("should reject CSV files with only headers", async () => {
      const file = new File(["name,value,count"], "headers-only.csv", {
        type: "text/csv",
      });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("only headers found");
    });
  });

  describe("parse - JSON file handling", () => {
    let mockJsonToDataFrame: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const { jsonToDataFrame } = await import("@dashframe/json");
      mockJsonToDataFrame = vi.mocked(jsonToDataFrame);
    });

    it("should parse JSON array files", async () => {
      const content = '[{"name": "Alice", "age": 30}]';
      const file = new File([content], "data.json", {
        type: "application/json",
      });

      const result = await connector.parse(
        file,
        "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      );

      expect(result).toBeDefined();
      expect(mockJsonToDataFrame).toHaveBeenCalled();
    });

    it("should parse JSON object files", async () => {
      const content = '{"name": "Alice", "age": 30}';
      const file = new File([content], "data.json", {
        type: "application/json",
      });

      const result = await connector.parse(
        file,
        "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      );

      expect(result).toBeDefined();
      expect(mockJsonToDataFrame).toHaveBeenCalled();
    });

    it("should reject invalid JSON syntax", async () => {
      const file = new File(["{invalid json}"], "invalid.json", {
        type: "application/json",
      });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("Invalid JSON format");
    });

    it("should reject null JSON", async () => {
      const file = new File(["null"], "null.json", {
        type: "application/json",
      });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("must contain an array of objects or a single object");
    });

    it("should reject primitive JSON values", async () => {
      const file = new File(["42"], "number.json", {
        type: "application/json",
      });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("must contain an array of objects or a single object");
    });

    it("should reject empty JSON array", async () => {
      const file = new File(["[]"], "empty.json", {
        type: "application/json",
      });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("JSON array is empty");
    });

    it("should reject array of primitives", async () => {
      const file = new File(["[1, 2, 3]"], "primitives.json", {
        type: "application/json",
      });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("JSON array must contain objects");
    });
  });
});
