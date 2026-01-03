/**
 * Unit tests for JSONConnector
 *
 * Tests cover:
 * - Static properties (id, name, icon, accept, maxSizeMB)
 * - File size validation (100MB limit)
 * - Empty file/array handling
 * - Invalid JSON handling
 * - JSON structure validation (must be array of objects or single object)
 * - Form field configuration
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { JSONConnector, jsonConnector } from "./connector";

// Mock the jsonToDataFrame function to avoid IndexedDB dependencies in unit tests
vi.mock("./index", () => ({
  jsonToDataFrame: vi.fn().mockResolvedValue({
    dataFrame: { id: "mock-df-id" },
    fields: [],
    sourceSchema: { columns: [], version: 1, lastSyncedAt: Date.now() },
    rowCount: 1,
    columnCount: 2,
  }),
}));

describe("JSONConnector", () => {
  let connector: JSONConnector;

  beforeEach(() => {
    connector = new JSONConnector();
    vi.clearAllMocks();
  });

  describe("static properties", () => {
    it("should have correct id", () => {
      expect(connector.id).toBe("json");
    });

    it("should have correct name", () => {
      expect(connector.name).toBe("JSON File");
    });

    it("should have description", () => {
      expect(connector.description).toBeTruthy();
      expect(typeof connector.description).toBe("string");
    });

    it("should have SVG icon", () => {
      expect(connector.icon).toContain("<svg");
      expect(connector.icon).toContain("</svg>");
    });

    it("should accept .json files", () => {
      expect(connector.accept).toContain(".json");
      expect(connector.accept).toContain("application/json");
    });

    it("should have 100MB size limit", () => {
      expect(connector.maxSizeMB).toBe(100);
    });

    it("should have helper text mentioning size limit", () => {
      expect(connector.helperText).toContain("100MB");
    });

    it("should have helper text mentioning flattening", () => {
      expect(connector.helperText).toContain("flatten");
    });
  });

  describe("getFormFields", () => {
    it("should return empty array (JSON has no config options)", () => {
      const fields = connector.getFormFields();
      expect(fields).toEqual([]);
    });
  });

  describe("validate", () => {
    it("should always return valid (file validation happens on select)", () => {
      const result = connector.validate({});
      expect(result).toEqual({ valid: true });
    });

    it("should return valid even with extra form data", () => {
      const result = connector.validate({ someField: "value" });
      expect(result).toEqual({ valid: true });
    });
  });

  describe("parse - file size validation", () => {
    it("should reject files exceeding 100MB", async () => {
      // Create a mock file larger than 100MB
      const largeSize = 101 * 1024 * 1024; // 101MB in bytes
      const largeFile = new File(["{}"], "large.json", {
        type: "application/json",
      });

      // Override size property (File.size is read-only, so we use Object.defineProperty)
      Object.defineProperty(largeFile, "size", { value: largeSize });

      await expect(
        connector.parse(
          largeFile,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("File size exceeds 100MB limit");
    });

    it("should accept files at exactly 100MB", async () => {
      const exactSize = 100 * 1024 * 1024; // Exactly 100MB
      const content = '[{"name": "test", "value": 1}]';
      const file = new File([content], "exact.json", {
        type: "application/json",
      });
      Object.defineProperty(file, "size", { value: exactSize });

      // Should not throw - the mock will handle the rest
      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).resolves.toBeDefined();
    });

    it("should accept files under 100MB", async () => {
      const content = '[{"name": "test", "value": 1}]';
      const file = new File([content], "small.json", {
        type: "application/json",
      });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe("parse - invalid JSON handling", () => {
    it("should reject invalid JSON syntax", async () => {
      const invalidJson = "{invalid json}";
      const file = new File([invalidJson], "invalid.json", {
        type: "application/json",
      });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("Invalid JSON format");
    });

    it("should reject truncated JSON", async () => {
      const truncatedJson = '[{"name": "test"';
      const file = new File([truncatedJson], "truncated.json", {
        type: "application/json",
      });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("Invalid JSON format");
    });
  });

  describe("parse - JSON structure validation", () => {
    it("should reject null JSON", async () => {
      const nullJson = "null";
      const file = new File([nullJson], "null.json", {
        type: "application/json",
      });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("must contain an array of objects or a single object");
    });

    it("should reject primitive number JSON", async () => {
      const numberJson = "42";
      const file = new File([numberJson], "number.json", {
        type: "application/json",
      });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("must contain an array of objects or a single object");
    });

    it("should reject primitive string JSON", async () => {
      const stringJson = '"hello"';
      const file = new File([stringJson], "string.json", {
        type: "application/json",
      });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("must contain an array of objects or a single object");
    });

    it("should reject primitive boolean JSON", async () => {
      const boolJson = "true";
      const file = new File([boolJson], "bool.json", {
        type: "application/json",
      });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("must contain an array of objects or a single object");
    });
  });

  describe("parse - empty file handling", () => {
    it("should reject empty JSON array", async () => {
      const emptyArray = "[]";
      const file = new File([emptyArray], "empty-array.json", {
        type: "application/json",
      });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("JSON array is empty");
    });
  });

  describe("parse - array element validation", () => {
    it("should reject array of primitives", async () => {
      const primitiveArray = "[1, 2, 3, 4, 5]";
      const file = new File([primitiveArray], "primitive-array.json", {
        type: "application/json",
      });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("JSON array must contain objects");
    });

    it("should reject array of strings", async () => {
      const stringArray = '["a", "b", "c"]';
      const file = new File([stringArray], "string-array.json", {
        type: "application/json",
      });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("JSON array must contain objects");
    });

    it("should reject array with null first element", async () => {
      const nullFirstArray = '[null, {"name": "test"}]';
      const file = new File([nullFirstArray], "null-first.json", {
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

  describe("parse - valid JSON formats", () => {
    let mockJsonToDataFrame: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      vi.clearAllMocks();
      const { jsonToDataFrame } = await import("./index");
      mockJsonToDataFrame = vi.mocked(jsonToDataFrame);
    });

    it("should parse array of objects", async () => {
      const validArray =
        '[{"name": "Alice", "age": 30}, {"name": "Bob", "age": 25}]';
      const file = new File([validArray], "valid-array.json", {
        type: "application/json",
      });

      await connector.parse(
        file,
        "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      );

      expect(mockJsonToDataFrame).toHaveBeenCalledTimes(1);
      const callArgs = mockJsonToDataFrame.mock.calls[0];
      expect(callArgs[0]).toEqual([
        { name: "Alice", age: 30 },
        { name: "Bob", age: 25 },
      ]);
      expect(callArgs[1]).toBe("test-uuid");
    });

    it("should parse single object", async () => {
      const singleObject = '{"name": "Alice", "age": 30}';
      const file = new File([singleObject], "single-object.json", {
        type: "application/json",
      });

      await connector.parse(
        file,
        "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      );

      expect(mockJsonToDataFrame).toHaveBeenCalledTimes(1);
      const callArgs = mockJsonToDataFrame.mock.calls[0];
      expect(callArgs[0]).toEqual({ name: "Alice", age: 30 });
    });

    it("should parse nested objects", async () => {
      const nestedJson =
        '[{"user": {"name": "Alice", "address": {"city": "NYC"}}}]';
      const file = new File([nestedJson], "nested.json", {
        type: "application/json",
      });

      await connector.parse(
        file,
        "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      );

      expect(mockJsonToDataFrame).toHaveBeenCalledTimes(1);
      const callArgs = mockJsonToDataFrame.mock.calls[0];
      expect(callArgs[0]).toEqual([
        { user: { name: "Alice", address: { city: "NYC" } } },
      ]);
    });

    it("should parse empty object", async () => {
      const emptyObject = "{}";
      const file = new File([emptyObject], "empty-object.json", {
        type: "application/json",
      });

      await connector.parse(
        file,
        "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      );

      expect(mockJsonToDataFrame).toHaveBeenCalledTimes(1);
      const callArgs = mockJsonToDataFrame.mock.calls[0];
      expect(callArgs[0]).toEqual({});
    });
  });

  describe("singleton instance", () => {
    it("should export a singleton jsonConnector instance", () => {
      expect(jsonConnector).toBeInstanceOf(JSONConnector);
    });

    it("singleton should have the same properties as a new instance", () => {
      expect(jsonConnector.id).toBe(connector.id);
      expect(jsonConnector.name).toBe(connector.name);
      expect(jsonConnector.maxSizeMB).toBe(connector.maxSizeMB);
    });
  });
});
