/**
 * Unit tests for LocalFileConnector
 *
 * Tests cover:
 * - Static properties (id, name, icon, accept, maxSizeMB)
 * - File size validation (100MB limit)
 * - File extension validation
 * - CSV parsing delegation
 * - JSON parsing delegation
 * - Error handling for invalid content
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalFileConnector, localFileConnector } from "./connector";

// Mock the format converters to avoid IndexedDB dependencies
vi.mock("@dashframe/csv", () => ({
  parseCSV: vi.fn((text: string) => {
    // Simple mock implementation
    const lines = text.split("\n").filter((line) => line.trim());
    return lines.map((line) => line.split(","));
  }),
  csvToDataFrame: vi.fn().mockResolvedValue({
    dataFrame: { id: "mock-csv-df-id" },
    fields: [],
    sourceSchema: { columns: [], version: 1, lastSyncedAt: Date.now() },
    rowCount: 2,
    columnCount: 3,
  }),
}));

vi.mock("@dashframe/json", () => ({
  jsonToDataFrame: vi.fn().mockResolvedValue({
    dataFrame: { id: "mock-json-df-id" },
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

  describe("static properties", () => {
    it("should have correct id", () => {
      expect(connector.id).toBe("local");
    });

    it("should have correct name", () => {
      expect(connector.name).toBe("Local Files");
    });

    it("should have description", () => {
      expect(connector.description).toBeTruthy();
      expect(typeof connector.description).toBe("string");
    });

    it("should have SVG icon", () => {
      expect(connector.icon).toContain("<svg");
      expect(connector.icon).toContain("</svg>");
    });

    it("should accept CSV and JSON files", () => {
      expect(connector.accept).toContain(".csv");
      expect(connector.accept).toContain(".json");
      expect(connector.accept).toContain("text/csv");
      expect(connector.accept).toContain("application/json");
    });

    it("should have 100MB size limit", () => {
      expect(connector.maxSizeMB).toBe(100);
    });

    it("should have helper text mentioning size limit and formats", () => {
      expect(connector.helperText).toContain("100MB");
      expect(connector.helperText).toContain("CSV");
      expect(connector.helperText).toContain("JSON");
    });
  });

  describe("getFormFields", () => {
    it("should return empty array (no config options)", () => {
      const fields = connector.getFormFields();
      expect(fields).toEqual([]);
    });
  });

  describe("validate", () => {
    it("should always return valid (validation happens on parse)", () => {
      const result = connector.validate({});
      expect(result).toEqual({ valid: true });
    });
  });

  describe("parse - file size validation", () => {
    it("should reject files exceeding 100MB", async () => {
      const largeSize = 101 * 1024 * 1024; // 101MB
      const file = new File(["name,value\na,1"], "large.csv", {
        type: "text/csv",
      });
      Object.defineProperty(file, "size", { value: largeSize });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("File size exceeds 100MB limit");
    });

    it("should accept files at exactly 100MB", async () => {
      const exactSize = 100 * 1024 * 1024; // Exactly 100MB
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

    it("should accept files under 100MB", async () => {
      const file = new File(["name,value\na,1"], "small.csv", {
        type: "text/csv",
      });

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
      ).rejects.toThrow("Unsupported file format");
    });

    it("should reject files with no extension", async () => {
      const file = new File(["some content"], "noextension", {
        type: "application/octet-stream",
      });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("Unsupported file format");
    });

    it("should include supported formats in error message", async () => {
      const file = new File(["some content"], "data.xlsx", {
        type: "application/vnd.ms-excel",
      });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("csv, json");
    });
  });

  describe("parse - CSV file handling", () => {
    let mockCsvToDataFrame: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const { csvToDataFrame } = await import("@dashframe/csv");
      mockCsvToDataFrame = vi.mocked(csvToDataFrame);
    });

    it("should parse CSV files", async () => {
      const file = new File(["name,value\nAlice,30\nBob,25"], "data.csv", {
        type: "text/csv",
      });

      const result = await connector.parse(
        file,
        "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      );

      expect(result).toBeDefined();
      expect(mockCsvToDataFrame).toHaveBeenCalled();
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

    it("should handle uppercase JSON extension", async () => {
      const file = new File(['[{"a": 1}]'], "DATA.JSON", {
        type: "application/json",
      });

      await connector.parse(
        file,
        "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      );

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

  describe("singleton instance", () => {
    it("should export a singleton localFileConnector instance", () => {
      expect(localFileConnector).toBeInstanceOf(LocalFileConnector);
    });

    it("singleton should have the same properties as a new instance", () => {
      expect(localFileConnector.id).toBe(connector.id);
      expect(localFileConnector.name).toBe(connector.name);
      expect(localFileConnector.maxSizeMB).toBe(connector.maxSizeMB);
    });
  });
});
