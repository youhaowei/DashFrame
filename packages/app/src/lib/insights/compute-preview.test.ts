import type {
  DataFrameData,
  DataTable,
  Field,
  Insight,
} from "@dashframe/types";
import { describe, expect, it } from "vitest";
import { computeInsightPreview } from "./compute-preview";

/**
 * Locks the collision-resistant group key invariants for computeInsightPreview.
 *
 * The old implementation serialized group keys by joining stringified field
 * values with a fixed "|||" delimiter and encoding null as the sentinel
 * "__NULL__". Two contracts were broken:
 *
 * 1. Delimiter collision: a value containing "|||" would produce the same key
 *    as a different value-combination → distinct rows merged into one group.
 * 2. Sentinel collision: the string "null" / "__NULL__" was
 *    indistinguishable from an actual null.
 * 3. Fields without columnName were silently dropped from the group key (and
 *    from the output row), so all such rows folded into a single group.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function field(overrides: Partial<Field> & Pick<Field, "id" | "name">): Field {
  return {
    id: overrides.id,
    name: overrides.name,
    tableId: overrides.tableId ?? "t1",
    type: overrides.type ?? "string",
    ...overrides,
  };
}

function table(fields: Field[]): DataTable {
  return {
    id: "t1",
    name: "test",
    dataSourceId: "ds1",
    table: "test_table",
    fields,
    metrics: [],
    createdAt: 0,
  };
}

function insight(selectedFieldIds: string[], tableId = "t1"): Insight {
  return {
    id: "i1",
    name: "Test Insight",
    baseTableId: tableId,
    selectedFields: selectedFieldIds,
    metrics: [],
    createdAt: 0,
  };
}

function frame(rows: Record<string, unknown>[]): DataFrameData {
  return { columns: [], rows };
}

// ---------------------------------------------------------------------------
// Delimiter-collision tests
// ---------------------------------------------------------------------------

describe("groupRowsBy — delimiter collision", () => {
  it("treats two rows as SEPARATE groups when a value contains the old delimiter", () => {
    // Old key: ("a|||b" + "|||" + "c") == ("a" + "|||" + "|||b|||c")
    // Both would produce the string "a|||b|||c" — indistinguishable.
    const category = field({
      id: "f1",
      name: "category",
      columnName: "category",
    });
    const label = field({ id: "f2", name: "label", columnName: "label" });
    const dt = table([category, label]);
    const ins = insight(["f1", "f2"]);

    const data = frame([
      { category: "a|||b", label: "c" }, // group A: category="a|||b", label="c"
      { category: "a", label: "|||b|||c" }, // group B: category="a", label="|||b|||c"
    ]);

    const result = computeInsightPreview(ins, dt, data, 50);

    // Must be 2 distinct groups, not 1 merged group
    expect(result.rowCount).toBe(2);
    expect(result.dataFrame.rows).toHaveLength(2);
  });

  it("keeps rows in the same group when they genuinely share both field values", () => {
    const region = field({ id: "f1", name: "region", columnName: "region" });
    const dt = table([region]);
    const ins = insight(["f1"]);

    const data = frame([
      { region: "west" },
      { region: "west" },
      { region: "east" },
    ]);

    const result = computeInsightPreview(ins, dt, data, 50);
    expect(result.rowCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Null-sentinel collision tests
// ---------------------------------------------------------------------------

describe("groupRowsBy — null/sentinel collision", () => {
  it('distinguishes the string "null" from an actual null value', () => {
    // Old sentinel was "__NULL__"; but the real risk is that `String(null) === "null"`.
    // With typed tuples, ["null"] (null tag) !== ["v","null"] (string "null").
    const status = field({ id: "f1", name: "status", columnName: "status" });
    const dt = table([status]);
    const ins = insight(["f1"]);

    const data = frame([
      { status: null }, // actual null
      { status: "null" }, // the string "null"
    ]);

    const result = computeInsightPreview(ins, dt, data, 50);
    expect(result.rowCount).toBe(2);
  });

  it('distinguishes undefined from the string "undefined"', () => {
    const status = field({ id: "f1", name: "status", columnName: "status" });
    const dt = table([status]);
    const ins = insight(["f1"]);

    const data = frame([{ status: undefined }, { status: "undefined" }]);

    const result = computeInsightPreview(ins, dt, data, 50);
    expect(result.rowCount).toBe(2);
  });

  it("keeps NaN, Infinity, and -Infinity as distinct groups from each other and from null", () => {
    // JSON.stringify coerces NaN/±Infinity to "null", so without special-casing
    // they would all merge into the same group as actual null values.
    const val = field({ id: "f1", name: "value", columnName: "value" });
    const dt = table([val]);
    const ins = insight(["f1"]);

    const data = frame([
      { value: null },
      { value: NaN },
      { value: Infinity },
      { value: -Infinity },
    ]);

    const result = computeInsightPreview(ins, dt, data, 50);
    expect(result.rowCount).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Fields without columnName participate in grouping
// ---------------------------------------------------------------------------

describe("groupRowsBy — field without columnName", () => {
  it("participates in grouping via field.name when columnName is absent", () => {
    // A computed/virtual field has no columnName. Old code treated all such
    // fields as null → every row fell into the same null-keyed group.
    // The codebase convention (matching compute-combined-fields.ts) is
    // columnName ?? name, so the row lookup key is field.name.
    const computed = field({ id: "f-status", name: "status" }); // no columnName
    const dt = table([computed]);
    const ins = insight(["f-status"]);

    const data = frame([
      { status: "active" },
      { status: "inactive" },
      { status: "active" },
    ]);

    const result = computeInsightPreview(ins, dt, data, 50);
    // Should produce 2 groups (active, inactive), not 1 collapsed null group
    expect(result.rowCount).toBe(2);
  });

  it("still extracts the field value into the output row for fields without columnName", () => {
    const computed = field({ id: "f-status", name: "status" }); // no columnName
    const dt = table([computed]);
    const ins = insight(["f-status"]);

    const data = frame([{ status: "active" }]);

    const result = computeInsightPreview(ins, dt, data, 50);
    expect(result.dataFrame.rows[0]).toMatchObject({ status: "active" });
  });
});

// ---------------------------------------------------------------------------
// Date values (DuckDB TIMESTAMP/DATE columns surface as JS Date objects)
// ---------------------------------------------------------------------------

describe("groupRowsBy — Date vs string collision", () => {
  it("keeps a Date and its ISO-string representation as SEPARATE groups", () => {
    // JSON.stringify(new Date("2024-01-01T00:00:00.000Z")) ===
    // JSON.stringify("2024-01-01T00:00:00.000Z")  → both produce the same
    // JSON bytes, so without a type tag the two rows would merge into one group.
    const col = field({ id: "f1", name: "ts", columnName: "ts" });
    const dt = table([col]);
    const ins = insight(["f1"]);

    const data = frame([
      { ts: new Date("2024-01-01T00:00:00.000Z") }, // Date object
      { ts: "2024-01-01T00:00:00.000Z" }, // equal ISO string
    ]);

    const result = computeInsightPreview(ins, dt, data, 50);
    // Must be 2 distinct groups, not 1 merged group
    expect(result.rowCount).toBe(2);
    expect(result.dataFrame.rows).toHaveLength(2);
  });

  it("keeps two different Date values in separate groups", () => {
    const col = field({ id: "f1", name: "ts", columnName: "ts" });
    const dt = table([col]);
    const ins = insight(["f1"]);

    const data = frame([
      { ts: new Date("2024-01-01T00:00:00.000Z") },
      { ts: new Date("2024-06-15T12:00:00.000Z") },
      { ts: new Date("2024-01-01T00:00:00.000Z") }, // duplicate of first
    ]);

    const result = computeInsightPreview(ins, dt, data, 50);
    expect(result.rowCount).toBe(2);
  });

  it("keeps a Date distinct from null", () => {
    const col = field({ id: "f1", name: "ts", columnName: "ts" });
    const dt = table([col]);
    const ins = insight(["f1"]);

    const data = frame([
      { ts: new Date("2024-01-01T00:00:00.000Z") },
      { ts: null },
    ]);

    const result = computeInsightPreview(ins, dt, data, 50);
    expect(result.rowCount).toBe(2);
  });

  it("keeps Invalid Date distinct from null and from a valid Date", () => {
    // new Date("not-a-date").getTime() === NaN; JSON.stringify(NaN) === "null"
    // so without a guard, ["d", NaN] serializes to ["d",null] — all invalid
    // dates would collapse and differ silently from actual null. The encoder
    // uses a dedicated ["d-invalid"] tag to keep injectivity intact.
    const col = field({ id: "f1", name: "ts", columnName: "ts" });
    const dt = table([col]);
    const ins = insight(["f1"]);

    const data = frame([
      { ts: new Date("not-a-date") }, // Invalid Date
      { ts: null },
      { ts: new Date("2024-01-01T00:00:00.000Z") }, // valid Date
    ]);

    const result = computeInsightPreview(ins, dt, data, 50);
    // Must be 3 distinct groups — Invalid Date must not merge with null or valid Date
    expect(result.rowCount).toBe(3);
  });

  it("groups all Invalid Date rows together (same sentinel)", () => {
    // Two different Invalid Date instances share the ["d-invalid"] sentinel —
    // both are unusable values and should form one group, not two.
    const col = field({ id: "f1", name: "ts", columnName: "ts" });
    const dt = table([col]);
    const ins = insight(["f1"]);

    const data = frame([
      { ts: new Date("bad1") },
      { ts: new Date("bad2") }, // different string, same NaN result
    ]);

    const result = computeInsightPreview(ins, dt, data, 50);
    expect(result.rowCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// BigInt values (DuckDB BIGINT columns surface as JS bigint)
// ---------------------------------------------------------------------------

describe("groupRowsBy — BigInt values", () => {
  it("does not throw on bigint field values and groups them correctly", () => {
    // JSON.stringify(1n) throws TypeError: Do not know how to serialize a BigInt.
    // The encoder must handle bigint before passing to JSON.stringify.
    const id = field({ id: "f1", name: "user_id", columnName: "user_id" });
    const dt = table([id]);
    const ins = insight(["f1"]);

    const data = frame([
      { user_id: 1n },
      { user_id: 2n },
      { user_id: 1n }, // duplicate → same group as first
    ]);

    // Must not throw, and must produce 2 groups (1n and 2n)
    const result = computeInsightPreview(ins, dt, data, 50);
    expect(result.rowCount).toBe(2);
  });

  it("keeps bigint 1n distinct from the number 1 and the string '1'", () => {
    // All three would produce the same string via String(value), so type
    // tags are required to prevent cross-type collisions.
    const col = field({ id: "f1", name: "val", columnName: "val" });
    const dt = table([col]);
    const ins = insight(["f1"]);

    const data = frame([{ val: 1n }, { val: 1 }, { val: "1" }]);

    const result = computeInsightPreview(ins, dt, data, 50);
    expect(result.rowCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Regression: clean values still group correctly
// ---------------------------------------------------------------------------

describe("computeInsightPreview — grouping regression", () => {
  it("groups two fields with clean values correctly", () => {
    const region = field({ id: "f1", name: "region", columnName: "region" });
    const product = field({ id: "f2", name: "product", columnName: "product" });
    const dt = table([region, product]);
    const ins = insight(["f1", "f2"]);

    const data = frame([
      { region: "west", product: "A" },
      { region: "west", product: "B" },
      { region: "east", product: "A" },
      { region: "west", product: "A" }, // duplicate of first → same group
    ]);

    const result = computeInsightPreview(ins, dt, data, 50);
    expect(result.rowCount).toBe(3);
  });

  it("handles grand-total mode (no selected fields) without regression", () => {
    const dt = table([]);
    const ins = insight([]);
    const data = frame([{ x: 1 }, { x: 2 }]);
    const result = computeInsightPreview(ins, dt, data, 50);
    // Grand total: single row
    expect(result.rowCount).toBe(1);
  });
});
