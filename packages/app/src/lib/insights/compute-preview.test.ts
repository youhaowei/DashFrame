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
    tableId: "t1",
    type: "string",
    ...overrides,
  } as Field;
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
});

// ---------------------------------------------------------------------------
// Fields without columnName participate in grouping
// ---------------------------------------------------------------------------

describe("groupRowsBy — field without columnName", () => {
  it("participates in grouping via field.id when columnName is absent", () => {
    // A computed/virtual field has no columnName. Old code treated all such
    // fields as null → every row fell into the same null-keyed group.
    // The fix uses field.id as the row key lookup instead.
    const computed = field({ id: "virtual_status", name: "Virtual Status" }); // no columnName
    const dt = table([computed]);
    const ins = insight(["virtual_status"]);

    const data = frame([
      { virtual_status: "active" },
      { virtual_status: "inactive" },
      { virtual_status: "active" },
    ]);

    const result = computeInsightPreview(ins, dt, data, 50);
    // Should produce 2 groups (active, inactive), not 1 collapsed null group
    expect(result.rowCount).toBe(2);
  });

  it("still extracts the field value into the output row for fields without columnName", () => {
    const computed = field({ id: "virtual_status", name: "Virtual Status" });
    const dt = table([computed]);
    const ins = insight(["virtual_status"]);

    const data = frame([{ virtual_status: "active" }]);

    const result = computeInsightPreview(ins, dt, data, 50);
    expect(result.dataFrame.rows[0]).toMatchObject({
      "Virtual Status": "active",
    });
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
