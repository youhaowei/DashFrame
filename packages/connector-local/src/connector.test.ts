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

type TableId = `${string}-${string}-${string}-${string}-${string}`;

describe("LocalFileConnector", () => {
  let connector: LocalFileConnector;

  beforeEach(() => {
    connector = new LocalFileConnector();
    vi.clearAllMocks();
  });

  /** Parses `content` as a file named `name`, optionally reporting `size`. */
  function parse(content: string, name: string, type: string, size?: number) {
    const file = new File([content], name, { type });
    if (size !== undefined)
      Object.defineProperty(file, "size", { value: size });
    return connector.parse(file, "test-uuid" as TableId);
  }

  describe("parse - file size validation", () => {
    it("should reject files exceeding the 16MB source limit", async () => {
      await expect(
        parse("name,value\na,1", "large.csv", "text/csv", 17 * 1024 * 1024),
      ).rejects.toThrow("File size exceeds 16MB limit");
    });

    it("should accept files at exactly the 16MB source limit", async () => {
      await expect(
        parse("name,value\na,1", "exact.csv", "text/csv", 16 * 1024 * 1024),
      ).resolves.toBeDefined();
    });
  });

  describe("parse - file extension validation", () => {
    it("should reject unsupported file extensions", async () => {
      await expect(
        parse("some content", "document.txt", "text/plain"),
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
      await parse("name,value\nAlice,30", "DATA.CSV", "text/csv");

      expect(mockCsvToDataFrame).toHaveBeenCalled();
    });

    it("should reject empty CSV files", async () => {
      await expect(parse("", "empty.csv", "text/csv")).rejects.toThrow(
        "CSV file is empty",
      );
    });

    it("should reject CSV files with only headers", async () => {
      await expect(
        parse("name,value,count", "headers-only.csv", "text/csv"),
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
      const result = await parse(
        '[{"name": "Alice", "age": 30}]',
        "data.json",
        "application/json",
      );

      expect(result).toBeDefined();
      expect(mockJsonToDataFrame).toHaveBeenCalled();
    });

    it("should parse JSON object files", async () => {
      const result = await parse(
        '{"name": "Alice", "age": 30}',
        "data.json",
        "application/json",
      );

      expect(result).toBeDefined();
      expect(mockJsonToDataFrame).toHaveBeenCalled();
    });

    it.each([
      [
        "invalid JSON syntax",
        "{invalid json}",
        "invalid.json",
        "Invalid JSON format",
      ],
      [
        "null JSON",
        "null",
        "null.json",
        "must contain an array of objects or a single object",
      ],
      [
        "primitive JSON values",
        "42",
        "number.json",
        "must contain an array of objects or a single object",
      ],
      ["empty JSON array", "[]", "empty.json", "JSON array is empty"],
      [
        "array of primitives",
        "[1, 2, 3]",
        "primitives.json",
        "JSON array must contain objects",
      ],
    ])("should reject %s", async (_label, content, name, message) => {
      await expect(parse(content, name, "application/json")).rejects.toThrow(
        message,
      );
    });
  });
});
