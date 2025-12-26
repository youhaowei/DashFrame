/**
 * Unit tests for CSVConnector
 *
 * Tests cover:
 * - File size validation (100MB limit)
 * - Empty file handling
 * - Headers-only file handling
 * - CSV parsing edge cases (quotes, line endings, special characters)
 * - Form field configuration
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CSVConnector, csvConnector } from "./connector";

// Mock the csvToDataFrame function to avoid IndexedDB dependencies in unit tests
vi.mock("./index", () => ({
  csvToDataFrame: vi.fn().mockResolvedValue({
    dataFrame: { id: "mock-df-id" },
    fields: [],
    sourceSchema: { columns: [], version: 1, lastSyncedAt: Date.now() },
    rowCount: 1,
    columnCount: 2,
  }),
}));

describe("CSVConnector", () => {
  let connector: CSVConnector;

  beforeEach(() => {
    connector = new CSVConnector();
    vi.clearAllMocks();
  });

  describe("static properties", () => {
    it("should have correct id", () => {
      expect(connector.id).toBe("csv");
    });

    it("should have correct name", () => {
      expect(connector.name).toBe("CSV File");
    });

    it("should have description", () => {
      expect(connector.description).toBeTruthy();
      expect(typeof connector.description).toBe("string");
    });

    it("should have SVG icon", () => {
      expect(connector.icon).toContain("<svg");
      expect(connector.icon).toContain("</svg>");
    });

    it("should accept .csv files", () => {
      expect(connector.accept).toContain(".csv");
      expect(connector.accept).toContain("text/csv");
    });

    it("should have 100MB size limit", () => {
      expect(connector.maxSizeMB).toBe(100);
    });

    it("should have helper text mentioning size limit", () => {
      expect(connector.helperText).toContain("100MB");
    });
  });

  describe("getFormFields", () => {
    it("should return empty array (CSV has no config options)", () => {
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
      const largeFile = new File(["x"], "large.csv", { type: "text/csv" });

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
      const content = "header1,header2\nvalue1,value2";
      const file = new File([content], "exact.csv", { type: "text/csv" });
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
      const content = "header1,header2\nvalue1,value2";
      const file = new File([content], "small.csv", { type: "text/csv" });

      await expect(
        connector.parse(
          file,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe("parse - empty file handling", () => {
    it("should reject empty CSV files", async () => {
      const emptyFile = new File([""], "empty.csv", { type: "text/csv" });

      await expect(
        connector.parse(
          emptyFile,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("CSV file is empty");
    });

    it("should treat whitespace-only rows as having content", async () => {
      // Note: In CSV, whitespace is valid data. A file with "   " is not empty,
      // it contains a single cell with 3 spaces. This is correct CSV behavior.
      const whitespaceFile = new File(["   \n\n  "], "whitespace.csv", {
        type: "text/csv",
      });

      // This should NOT throw because whitespace is valid CSV content
      // The file has: header row with "   ", then an empty row (skipped), then "  "
      await expect(
        connector.parse(
          whitespaceFile,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe("parse - headers-only handling", () => {
    it("should reject CSV with only headers (no data rows)", async () => {
      const headersOnly = new File(["name,age,city"], "headers-only.csv", {
        type: "text/csv",
      });

      await expect(
        connector.parse(
          headersOnly,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("CSV file has no data rows");
    });

    it("should reject CSV with headers and empty lines only", async () => {
      const headersWithEmptyLines = new File(
        ["name,age,city\n\n\n"],
        "headers-empty.csv",
        { type: "text/csv" },
      );

      await expect(
        connector.parse(
          headersWithEmptyLines,
          "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
        ),
      ).rejects.toThrow("CSV file has no data rows");
    });
  });

  describe("singleton instance", () => {
    it("should export a singleton csvConnector instance", () => {
      expect(csvConnector).toBeInstanceOf(CSVConnector);
    });

    it("singleton should have the same properties as a new instance", () => {
      expect(csvConnector.id).toBe(connector.id);
      expect(csvConnector.name).toBe(connector.name);
      expect(csvConnector.maxSizeMB).toBe(connector.maxSizeMB);
    });
  });
});

describe("parseCSV (internal function via connector.parse)", () => {
  let connector: CSVConnector;
  // Store mock reference for assertions
  let mockCsvToDataFrame: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    connector = new CSVConnector();
    vi.clearAllMocks();
    // Get fresh reference to the mocked function
    const { csvToDataFrame } = await import("./index");
    mockCsvToDataFrame = vi.mocked(csvToDataFrame);
  });

  describe("standard CSV parsing", () => {
    it("should parse simple CSV correctly", async () => {
      const csv = "name,age\nAlice,30\nBob,25";
      const file = new File([csv], "simple.csv", { type: "text/csv" });

      // We test via the connector.parse method which uses parseCSV internally
      // The mock will be called with the parsed data
      await connector.parse(
        file,
        "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      );

      expect(mockCsvToDataFrame).toHaveBeenCalledTimes(1);
      const callArgs = mockCsvToDataFrame.mock.calls[0];
      expect(callArgs[0]).toEqual([
        ["name", "age"],
        ["Alice", "30"],
        ["Bob", "25"],
      ]);
    });
  });

  describe("quoted fields", () => {
    it("should handle quoted fields with commas", async () => {
      const csv = 'name,description\nAlice,"Hello, World"';
      const file = new File([csv], "quoted.csv", { type: "text/csv" });

      await connector.parse(
        file,
        "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      );

      expect(mockCsvToDataFrame).toHaveBeenCalledTimes(1);
      const callArgs = mockCsvToDataFrame.mock.calls[0];
      expect(callArgs[0]).toEqual([
        ["name", "description"],
        ["Alice", "Hello, World"],
      ]);
    });

    it("should handle escaped quotes (doubled quotes)", async () => {
      const csv = 'name,quote\nAlice,"She said ""hello"""';
      const file = new File([csv], "escaped.csv", { type: "text/csv" });

      await connector.parse(
        file,
        "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      );

      expect(mockCsvToDataFrame).toHaveBeenCalledTimes(1);
      const callArgs = mockCsvToDataFrame.mock.calls[0];
      expect(callArgs[0]).toEqual([
        ["name", "quote"],
        ["Alice", 'She said "hello"'],
      ]);
    });

    it("should handle newlines within quoted fields", async () => {
      const csv = 'name,address\nAlice,"123 Main St\nApt 4"';
      const file = new File([csv], "multiline.csv", { type: "text/csv" });

      await connector.parse(
        file,
        "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      );

      expect(mockCsvToDataFrame).toHaveBeenCalledTimes(1);
      const callArgs = mockCsvToDataFrame.mock.calls[0];
      expect(callArgs[0]).toEqual([
        ["name", "address"],
        ["Alice", "123 Main St\nApt 4"],
      ]);
    });
  });

  describe("line endings", () => {
    it("should handle Unix line endings (LF)", async () => {
      const csv = "a,b\n1,2\n3,4";
      const file = new File([csv], "unix.csv", { type: "text/csv" });

      await connector.parse(
        file,
        "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      );

      expect(mockCsvToDataFrame).toHaveBeenCalledTimes(1);
      const callArgs = mockCsvToDataFrame.mock.calls[0];
      expect(callArgs[0]).toEqual([
        ["a", "b"],
        ["1", "2"],
        ["3", "4"],
      ]);
    });

    it("should handle Windows line endings (CRLF)", async () => {
      const csv = "a,b\r\n1,2\r\n3,4";
      const file = new File([csv], "windows.csv", { type: "text/csv" });

      await connector.parse(
        file,
        "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      );

      expect(mockCsvToDataFrame).toHaveBeenCalledTimes(1);
      const callArgs = mockCsvToDataFrame.mock.calls[0];
      expect(callArgs[0]).toEqual([
        ["a", "b"],
        ["1", "2"],
        ["3", "4"],
      ]);
    });

    it("should handle old Mac line endings (CR)", async () => {
      const csv = "a,b\r1,2\r3,4";
      const file = new File([csv], "mac.csv", { type: "text/csv" });

      await connector.parse(
        file,
        "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      );

      expect(mockCsvToDataFrame).toHaveBeenCalledTimes(1);
      const callArgs = mockCsvToDataFrame.mock.calls[0];
      expect(callArgs[0]).toEqual([
        ["a", "b"],
        ["1", "2"],
        ["3", "4"],
      ]);
    });
  });

  describe("edge cases", () => {
    it("should handle trailing newline", async () => {
      const csv = "a,b\n1,2\n";
      const file = new File([csv], "trailing.csv", { type: "text/csv" });

      await connector.parse(
        file,
        "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      );

      expect(mockCsvToDataFrame).toHaveBeenCalledTimes(1);
      const callArgs = mockCsvToDataFrame.mock.calls[0];
      expect(callArgs[0]).toEqual([
        ["a", "b"],
        ["1", "2"],
      ]);
    });

    it("should handle empty fields", async () => {
      const csv = "a,b,c\n1,,3\n,2,";
      const file = new File([csv], "empty-fields.csv", { type: "text/csv" });

      await connector.parse(
        file,
        "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      );

      expect(mockCsvToDataFrame).toHaveBeenCalledTimes(1);
      const callArgs = mockCsvToDataFrame.mock.calls[0];
      expect(callArgs[0]).toEqual([
        ["a", "b", "c"],
        ["1", "", "3"],
        ["", "2", ""],
      ]);
    });

    it("should handle single column CSV", async () => {
      const csv = "name\nAlice\nBob";
      const file = new File([csv], "single-col.csv", { type: "text/csv" });

      await connector.parse(
        file,
        "test-uuid" as `${string}-${string}-${string}-${string}-${string}`,
      );

      expect(mockCsvToDataFrame).toHaveBeenCalledTimes(1);
      const callArgs = mockCsvToDataFrame.mock.calls[0];
      expect(callArgs[0]).toEqual([["name"], ["Alice"], ["Bob"]]);
    });
  });
});
