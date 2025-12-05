import { describe, it, expect } from "vitest";
import { analyzeDataFrame } from "./analyze";
import type { DataFrameRow, DataFrameColumn, Field } from "./index";

describe("analyzeDataFrame", () => {
  it("should categorize columns based on explicit field metadata", () => {
    const rows: DataFrameRow[] = [
      { id: "1", ref: "a" },
      { id: "2", ref: "b" },
      { id: "3", ref: "c" },
    ];

    const columns: DataFrameColumn[] = [
      { name: "id", type: "string" },
      { name: "ref", type: "string" },
    ];

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

    const analysis = analyzeDataFrame(rows, columns, fields);

    expect(analysis).toHaveLength(2);
    expect(analysis.find((c) => c.columnName === "id")?.category).toBe(
      "identifier",
    );
    expect(analysis.find((c) => c.columnName === "ref")?.category).toBe(
      "reference",
    );
  });

  it("should use heuristics to categorize columns when metadata is missing", () => {
    const rows: DataFrameRow[] = [
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
    ];

    const analysis = analyzeDataFrame(rows);

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
    const rows: DataFrameRow[] = [];

    const analysis = analyzeDataFrame(rows);
    expect(analysis).toHaveLength(0);
  });

  it("should handle columns with null values", () => {
    const rows: DataFrameRow[] = [{ val: 1 }, { val: null }, { val: 3 }];

    const analysis = analyzeDataFrame(rows);
    const col = analysis.find((c) => c.columnName === "val");
    expect(col?.nullCount).toBe(1);
    expect(col?.category).toBe("numerical");
  });

  it("should detect email patterns", () => {
    const rows: DataFrameRow[] = [
      { email: "user1@example.com" },
      { email: "user2@test.org" },
      { email: "user3@domain.io" },
    ];

    const analysis = analyzeDataFrame(rows);
    const col = analysis.find((c) => c.columnName === "email");
    expect(col?.category).toBe("email");
    expect(col?.pattern).toBe("email");
  });

  it("should detect URL patterns", () => {
    const rows: DataFrameRow[] = [
      { url: "https://example.com" },
      // eslint-disable-next-line sonarjs/no-clear-text-protocols -- Testing URL detection with both http and https
      { url: "http://test.org/page" },
      { url: "https://domain.io/path/to/resource" },
    ];

    const analysis = analyzeDataFrame(rows);
    const col = analysis.find((c) => c.columnName === "url");
    expect(col?.category).toBe("url");
    expect(col?.pattern).toBe("url");
  });

  it("should detect UUID patterns", () => {
    const rows: DataFrameRow[] = [
      { id: "550e8400-e29b-41d4-a716-446655440000" },
      { id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8" },
      { id: "6ba7b811-9dad-11d1-80b4-00c04fd430c8" },
    ];

    const analysis = analyzeDataFrame(rows);
    const col = analysis.find((c) => c.columnName === "id");
    expect(col?.category).toBe("uuid");
    expect(col?.pattern).toBe("uuid");
  });

  it("should detect numeric IDs based on column name patterns", () => {
    const rows: DataFrameRow[] = [
      { acctid: 1296, oppid: 64963, userId: 100, amount: 500 },
      { acctid: 1297, oppid: 66870, userId: 101, amount: 750 },
      { acctid: 1298, oppid: 51241, userId: 102, amount: 1000 },
    ];

    const analysis = analyzeDataFrame(rows);

    // Columns ending with "id" should be identifiers
    expect(analysis.find((c) => c.columnName === "acctid")?.category).toBe(
      "identifier",
    );
    expect(analysis.find((c) => c.columnName === "oppid")?.category).toBe(
      "identifier",
    );
    // camelCase ending with Id should also be identifier
    expect(analysis.find((c) => c.columnName === "userId")?.category).toBe(
      "identifier",
    );
    // "amount" should be numerical (not an ID pattern)
    expect(analysis.find((c) => c.columnName === "amount")?.category).toBe(
      "numerical",
    );
  });

  it("should detect other numeric ID patterns (key, no, num, seq, index)", () => {
    const rows: DataFrameRow[] = [
      { orderkey: 1001, invoiceno: 5001, seqnum: 1, rowindex: 0, price: 99.99 },
      { orderkey: 1002, invoiceno: 5002, seqnum: 2, rowindex: 1, price: 149.99 },
      { orderkey: 1003, invoiceno: 5003, seqnum: 3, rowindex: 2, price: 199.99 },
    ];

    const analysis = analyzeDataFrame(rows);

    expect(analysis.find((c) => c.columnName === "orderkey")?.category).toBe(
      "identifier",
    );
    expect(analysis.find((c) => c.columnName === "invoiceno")?.category).toBe(
      "identifier",
    );
    expect(analysis.find((c) => c.columnName === "seqnum")?.category).toBe(
      "identifier",
    );
    expect(analysis.find((c) => c.columnName === "rowindex")?.category).toBe(
      "identifier",
    );
    // "price" should remain numerical
    expect(analysis.find((c) => c.columnName === "price")?.category).toBe(
      "numerical",
    );
  });

  it("should NOT treat zip codes and area codes as identifiers", () => {
    const rows: DataFrameRow[] = [
      { zipcode: 10001, areacode: 212, postcode: 90210, value: 100 },
      { zipcode: 10002, areacode: 310, postcode: 90211, value: 200 },
      { zipcode: 10003, areacode: 415, postcode: 90212, value: 300 },
    ];

    const analysis = analyzeDataFrame(rows);

    // These should remain numerical (excluded from ID patterns)
    expect(analysis.find((c) => c.columnName === "zipcode")?.category).toBe(
      "numerical",
    );
    expect(analysis.find((c) => c.columnName === "areacode")?.category).toBe(
      "numerical",
    );
    expect(analysis.find((c) => c.columnName === "postcode")?.category).toBe(
      "numerical",
    );
  });
});
