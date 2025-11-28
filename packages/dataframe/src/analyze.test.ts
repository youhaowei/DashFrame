import { describe, it, expect } from "vitest";
import { analyzeDataFrame } from "./analyze";
import { EnhancedDataFrame, Field } from "./index";

describe("analyzeDataFrame", () => {
  const mockMetadata = {
    id: "test-id",
    name: "test-df",
    source: {},
    timestamp: Date.now(),
    rowCount: 0,
    columnCount: 0,
  };

  it("should categorize columns based on explicit field metadata", () => {
    const df: EnhancedDataFrame = {
      metadata: { ...mockMetadata, rowCount: 3, columnCount: 2 },
      data: {
        fieldIds: [],
        rows: [
          { id: "1", ref: "a" },
          { id: "2", ref: "b" },
          { id: "3", ref: "c" },
        ],
      },
    };

    const fields: Record<string, Field> = {
      id: {
        id: "f1",
        name: "ID",
        tableId: "t1",
        type: "string",
        isIdentifier: true,
      },
      ref: {
        id: "f2",
        name: "Ref",
        tableId: "t1",
        type: "string",
        isReference: true,
      },
    };

    const analysis = analyzeDataFrame(df, fields);

    expect(analysis).toHaveLength(2);
    expect(analysis.find((c) => c.columnName === "id")?.category).toBe(
      "identifier",
    );
    expect(analysis.find((c) => c.columnName === "ref")?.category).toBe(
      "reference",
    );
  });

  it("should use heuristics to categorize columns when metadata is missing", () => {
    const df: EnhancedDataFrame = {
      metadata: { ...mockMetadata, rowCount: 5, columnCount: 4 },
      data: {
        fieldIds: [],
        rows: [
          {
            id: "1",
            category: "A",
            value: 10,
            date: "2023-01-01",
            active: true,
          },
          {
            id: "2",
            category: "B",
            value: 20,
            date: "2023-01-02",
            active: false,
          },
          {
            id: "3",
            category: "A",
            value: 30,
            date: "2023-01-03",
            active: true,
          },
          {
            id: "4",
            category: "C",
            value: 40,
            date: "2023-01-04",
            active: false,
          },
          {
            id: "5",
            category: "B",
            value: 50,
            date: "2023-01-05",
            active: true,
          },
        ],
      },
    };

    const analysis = analyzeDataFrame(df);

    // ID should be identifier (unique strings)
    expect(analysis.find((c) => c.columnName === "id")?.category).toBe(
      "identifier",
    );

    // Category should be categorical (low cardinality)
    expect(analysis.find((c) => c.columnName === "category")?.category).toBe(
      "categorical",
    );

    // Value should be numerical
    expect(analysis.find((c) => c.columnName === "value")?.category).toBe(
      "numerical",
    );

    // Date should be temporal
    expect(analysis.find((c) => c.columnName === "date")?.category).toBe(
      "temporal",
    );

    // Active should be boolean
    expect(analysis.find((c) => c.columnName === "active")?.category).toBe(
      "boolean",
    );
  });

  it("should handle empty dataframes", () => {
    const df: EnhancedDataFrame = {
      metadata: { ...mockMetadata, rowCount: 0, columnCount: 0 },
      data: {
        fieldIds: [],
        rows: [],
      },
    };

    const analysis = analyzeDataFrame(df);
    expect(analysis).toHaveLength(0);
  });

  it("should handle columns with null values", () => {
    const df: EnhancedDataFrame = {
      metadata: { ...mockMetadata, rowCount: 3, columnCount: 1 },
      data: {
        fieldIds: [],
        rows: [{ val: 1 }, { val: null }, { val: 3 }],
      },
    };

    const analysis = analyzeDataFrame(df);
    const col = analysis.find((c) => c.columnName === "val");
    expect(col?.nullCount).toBe(1);
    expect(col?.category).toBe("numerical");
  });

  it("should detect email patterns", () => {
    const df: EnhancedDataFrame = {
      metadata: { ...mockMetadata, rowCount: 3, columnCount: 1 },
      data: {
        fieldIds: [],
        rows: [
          { email: "user1@example.com" },
          { email: "user2@test.org" },
          { email: "user3@domain.io" },
        ],
      },
    };

    const analysis = analyzeDataFrame(df);
    const col = analysis.find((c) => c.columnName === "email");
    expect(col?.category).toBe("email");
    expect(col?.pattern).toBe("email");
  });

  it("should detect URL patterns", () => {
    const df: EnhancedDataFrame = {
      metadata: { ...mockMetadata, rowCount: 3, columnCount: 1 },
      data: {
        fieldIds: [],
        rows: [
          { url: "https://example.com" },
          // eslint-disable-next-line sonarjs/no-clear-text-protocols -- Testing URL detection with both http and https
          { url: "http://test.org/page" },
          { url: "https://domain.io/path/to/resource" },
        ],
      },
    };

    const analysis = analyzeDataFrame(df);
    const col = analysis.find((c) => c.columnName === "url");
    expect(col?.category).toBe("url");
    expect(col?.pattern).toBe("url");
  });

  it("should detect UUID patterns", () => {
    const df: EnhancedDataFrame = {
      metadata: { ...mockMetadata, rowCount: 3, columnCount: 1 },
      data: {
        fieldIds: [],
        rows: [
          { id: "550e8400-e29b-41d4-a716-446655440000" },
          { id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8" },
          { id: "6ba7b811-9dad-11d1-80b4-00c04fd430c8" },
        ],
      },
    };

    const analysis = analyzeDataFrame(df);
    const col = analysis.find((c) => c.columnName === "id");
    expect(col?.category).toBe("uuid");
    expect(col?.pattern).toBe("uuid");
  });
});
