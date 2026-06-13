/**
 * Tests for compile-time per-cell override resolution.
 *
 * Each test is named for the contract it locks:
 *
 * - N distinct cells → N distinct compiled queries.
 * - Per-field filter merge: different-field → ADD; same-field → REPLACE.
 * - Absent override → inherit insight default.
 * - Explicit clear → insight filter for that field REMOVED (widened).
 * - Sort/limit scalar replace.
 * - Read-only invariant: insight definition NEVER mutated after resolution.
 * - Integration through buildInsightSQL: effective filters feed WHERE/HAVING correctly.
 */

import type {
  DashboardItemOverrides,
  DataTable,
  Field,
  Insight,
  InsightFilter,
  InsightMetric,
  UUID,
} from "@dashframe/types";
import { describe, expect, it } from "bun:test";

import { buildInsightSQL, fieldIdToColumnAlias } from "./insight-sql";
import { resolveEffectiveParams } from "./override-resolution";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const TABLE_ID = "11111111-1111-1111-1111-111111111111" as UUID;
const DATAFRAME_ID = "22222222-2222-2222-2222-222222222222" as UUID;

const REGION_FIELD_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" as UUID;
const MONTH_FIELD_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" as UUID;
const AMOUNT_FIELD_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc" as UUID;
const REVENUE_METRIC_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd" as UUID;

function makeField(
  id: UUID,
  name: string,
  columnName: string,
  type: Field["type"],
): Field {
  return { id, name, tableId: TABLE_ID, columnName, type };
}

const REGION_FIELD = makeField(REGION_FIELD_ID, "Region", "region", "string");
const MONTH_FIELD = makeField(MONTH_FIELD_ID, "Month", "month", "string");
const AMOUNT_FIELD = makeField(AMOUNT_FIELD_ID, "Amount", "amount", "number");

const REVENUE_METRIC: InsightMetric = {
  id: REVENUE_METRIC_ID,
  name: "Total Revenue",
  sourceTable: TABLE_ID,
  columnName: "amount",
  aggregation: "sum",
};

const BASE_TABLE: DataTable = {
  id: TABLE_ID,
  name: "sales",
  dataSourceId: "33333333-3333-3333-3333-333333333333" as UUID,
  table: "sales.csv",
  fields: [REGION_FIELD, MONTH_FIELD, AMOUNT_FIELD],
  metrics: [],
  dataFrameId: DATAFRAME_ID,
  createdAt: 0,
};

/** Base insight: grouped by region, SUM(amount), insight filter region='EMEA'. */
const BASE_INSIGHT: Insight = {
  id: "99999999-9999-9999-9999-999999999999" as UUID,
  name: "Revenue by Region",
  baseTableId: TABLE_ID,
  selectedFields: [REGION_FIELD_ID],
  metrics: [REVENUE_METRIC],
  filters: [{ field: "region", operator: "eq", value: "EMEA" }],
  sorts: [{ field: "region", direction: "asc" }],
  createdAt: 0,
};

const regionAlias = fieldIdToColumnAlias(REGION_FIELD_ID);
const monthAlias = fieldIdToColumnAlias(MONTH_FIELD_ID);

// ---------------------------------------------------------------------------
// Helper: build SQL through the full insight+override pipeline.
// Merges resolveEffectiveParams back onto the insight before calling buildInsightSQL.
// ---------------------------------------------------------------------------
function buildWithOverrides(
  insight: Insight,
  overrides: DashboardItemOverrides | undefined,
): string {
  const effective = resolveEffectiveParams(
    insight.filters,
    insight.sorts,
    (insight as Insight & { limit?: number }).limit,
    overrides,
  );

  // Apply effective filters back onto the insight for SQL generation.
  // Sorts are passed via BuildInsightSQLOptions (sortColumn/sortDirection)
  // since buildInsightSQL does not read insight.sorts directly.
  const effectiveInsight: Insight = {
    ...insight,
    filters: effective.filters,
  };

  // Use first effective sort for ORDER BY (matches single-sort coalesce semantics).
  const firstSort = effective.sorts[0];

  const sql = buildInsightSQL(BASE_TABLE, new Map(), effectiveInsight, {
    mode: "query",
    limit: effective.limit,
    sortColumn: firstSort
      ? fieldIdToColumnAlias(
          // Resolve field name to UUID alias via the field map
          (() => {
            const field = [REGION_FIELD, MONTH_FIELD, AMOUNT_FIELD].find(
              (f) => (f.columnName ?? f.name) === firstSort.field,
            );
            return field ? field.id : firstSort.field;
          })(),
        )
      : undefined,
    sortDirection: firstSort?.direction,
  });
  expect(sql).not.toBeNull();
  return sql!;
}

// ---------------------------------------------------------------------------
// §N-cells: one insight + N distinct cell overrides → N distinct compiled queries
// ---------------------------------------------------------------------------

describe("override-resolution — N cells produce N distinct queries", () => {
  it("three distinct cell overrides on a single insight produce three distinct SQL strings", () => {
    const overrides: DashboardItemOverrides[] = [
      { filters: [{ field: "region", operator: "eq", value: "EMEA" }] },
      { filters: [{ field: "region", operator: "eq", value: "APAC" }] },
      { filters: [{ field: "region", operator: "eq", value: "AMER" }] },
    ];

    const insightWithoutFilters: Insight = {
      ...BASE_INSIGHT,
      filters: undefined,
    };

    const queries = overrides.map((ov) =>
      buildWithOverrides(insightWithoutFilters, ov),
    );

    // All three must be distinct
    expect(queries[0]).not.toEqual(queries[1]);
    expect(queries[1]).not.toEqual(queries[2]);
    expect(queries[0]).not.toEqual(queries[2]);

    // Each contains its own value
    expect(queries[0]).toContain("'EMEA'");
    expect(queries[1]).toContain("'APAC'");
    expect(queries[2]).toContain("'AMER'");
  });
});

// ---------------------------------------------------------------------------
// §per-field-merge: different field ADDS; same field REPLACES
// ---------------------------------------------------------------------------

describe("override-resolution — per-field filter merge", () => {
  it("override on a DIFFERENT field ADDS to effective filters (both predicates present)", () => {
    // insight: region='EMEA'  +  cell override: month='Nov'
    // effective should have BOTH region='EMEA' AND month='Nov'
    const params = resolveEffectiveParams(
      [{ field: "region", operator: "eq", value: "EMEA" }],
      undefined,
      undefined,
      { filters: [{ field: "month", operator: "eq", value: "Nov" }] },
    );

    expect(params.filters).toHaveLength(2);
    expect(
      params.filters.some((f) => f.field === "region" && f.value === "EMEA"),
    ).toBe(true);
    expect(
      params.filters.some((f) => f.field === "month" && f.value === "Nov"),
    ).toBe(true);
  });

  it("override on the SAME field REPLACES the insight's filter for that field", () => {
    // insight: region='EMEA'  +  cell override: region='APAC'
    // effective should have ONLY region='APAC'
    const params = resolveEffectiveParams(
      [{ field: "region", operator: "eq", value: "EMEA" }],
      undefined,
      undefined,
      { filters: [{ field: "region", operator: "eq", value: "APAC" }] },
    );

    expect(params.filters).toHaveLength(1);
    expect(params.filters[0]!.field).toBe("region");
    expect(params.filters[0]!.value).toBe("APAC");
  });

  it("mixed: different-field override adds, same-field override replaces", () => {
    // insight: [region='EMEA', month='Oct']
    // cell override: [region='APAC', month='Nov'] — both same field, both replace
    const params = resolveEffectiveParams(
      [
        { field: "region", operator: "eq", value: "EMEA" },
        { field: "month", operator: "eq", value: "Oct" },
      ],
      undefined,
      undefined,
      {
        filters: [
          { field: "region", operator: "eq", value: "APAC" },
          { field: "month", operator: "eq", value: "Nov" },
        ],
      },
    );

    expect(params.filters).toHaveLength(2);
    expect(params.filters.find((f) => f.field === "region")?.value).toBe(
      "APAC",
    );
    expect(params.filters.find((f) => f.field === "month")?.value).toBe("Nov");
  });

  it("insight region='EMEA' + cell month='Nov' → SQL has BOTH predicates", () => {
    const sql = buildWithOverrides(
      {
        ...BASE_INSIGHT,
        filters: [{ field: "region", operator: "eq", value: "EMEA" }],
      },
      { filters: [{ field: "month", operator: "eq", value: "Nov" }] },
    );

    expect(sql).toContain(`"${regionAlias}" = 'EMEA'`);
    expect(sql).toContain(`"${monthAlias}" = 'Nov'`);
  });

  it("cell region='APAC' override → SQL has APAC, not EMEA", () => {
    const sql = buildWithOverrides(
      {
        ...BASE_INSIGHT,
        filters: [{ field: "region", operator: "eq", value: "EMEA" }],
      },
      { filters: [{ field: "region", operator: "eq", value: "APAC" }] },
    );

    expect(sql).toContain("'APAC'");
    expect(sql).not.toContain("'EMEA'");
  });
});

// ---------------------------------------------------------------------------
// §absent-override: absent override → inherit insight default
// ---------------------------------------------------------------------------

describe("override-resolution — absent override inherits insight default", () => {
  it("undefined overrides → effective params equal insight defaults", () => {
    const params = resolveEffectiveParams(
      [{ field: "region", operator: "eq", value: "EMEA" }],
      [{ field: "region", direction: "asc" }],
      50,
      undefined,
    );

    expect(params.filters).toHaveLength(1);
    expect(params.filters[0]!.value).toBe("EMEA");
    expect(params.sorts).toHaveLength(1);
    expect(params.sorts[0]!.direction).toBe("asc");
    expect(params.limit).toBe(50);
  });

  it("empty overrides object → effective params equal insight defaults", () => {
    const params = resolveEffectiveParams(
      [{ field: "region", operator: "eq", value: "EMEA" }],
      [{ field: "region", direction: "asc" }],
      50,
      {}, // empty override bag
    );

    expect(params.filters).toHaveLength(1);
    expect(params.filters[0]!.value).toBe("EMEA");
    expect(params.sorts).toHaveLength(1);
    expect(params.limit).toBe(50);
  });

  it("overrides with no filters key → insight filters fall through", () => {
    const params = resolveEffectiveParams(
      [{ field: "region", operator: "eq", value: "EMEA" }],
      undefined,
      undefined,
      { sorts: [{ field: "month", direction: "desc" }] }, // only sorts overridden
    );

    expect(params.filters).toHaveLength(1);
    expect(params.filters[0]!.field).toBe("region");
    expect(params.sorts[0]!.field).toBe("month");
  });
});

// ---------------------------------------------------------------------------
// §clear: explicit clear → widen (remove insight filter for that field)
// ---------------------------------------------------------------------------

describe("override-resolution — explicit clear widens (removes insight filter for field)", () => {
  it("cleared override on field F removes insight's filter for F", () => {
    const params = resolveEffectiveParams(
      [{ field: "region", operator: "eq", value: "EMEA" }],
      undefined,
      undefined,
      {
        filters: [
          { field: "region", operator: "eq", value: "EMEA", cleared: true },
        ],
      },
    );

    expect(params.filters).toHaveLength(0);
  });

  it("cleared field F does NOT affect insight filters on other fields", () => {
    const params = resolveEffectiveParams(
      [
        { field: "region", operator: "eq", value: "EMEA" },
        { field: "month", operator: "eq", value: "Nov" },
      ],
      undefined,
      undefined,
      {
        filters: [
          { field: "region", operator: "eq", value: "EMEA", cleared: true },
        ],
      },
    );

    // region cleared, month should remain
    expect(params.filters).toHaveLength(1);
    expect(params.filters[0]!.field).toBe("month");
    expect(params.filters[0]!.value).toBe("Nov");
  });

  it("cleared override is DISTINCT from absent override (absence inherits, clear widens)", () => {
    const inheritParams = resolveEffectiveParams(
      [{ field: "region", operator: "eq", value: "EMEA" }],
      undefined,
      undefined,
      undefined, // absent → inherit
    );
    expect(inheritParams.filters).toHaveLength(1); // inherited

    const clearParams = resolveEffectiveParams(
      [{ field: "region", operator: "eq", value: "EMEA" }],
      undefined,
      undefined,
      {
        filters: [
          { field: "region", operator: "eq", value: "EMEA", cleared: true },
        ],
      }, // explicit clear
    );
    expect(clearParams.filters).toHaveLength(0); // widened
  });

  it("cleared flag does not leak into effective InsightFilter (no cleared property on output)", () => {
    // A cell pinning region='APAC' (not cleared) must not carry `cleared` into SQL gen.
    const params = resolveEffectiveParams([], undefined, undefined, {
      filters: [{ field: "region", operator: "eq", value: "APAC" }],
    });

    expect(params.filters).toHaveLength(1);
    expect(
      Object.prototype.hasOwnProperty.call(params.filters[0], "cleared"),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §sort-limit-replace: scalar override replaces insight value
// ---------------------------------------------------------------------------

describe("override-resolution — sort/limit scalar replace", () => {
  it("sort override replaces insight sorts", () => {
    const params = resolveEffectiveParams(
      undefined,
      [{ field: "region", direction: "asc" }],
      undefined,
      { sorts: [{ field: "month", direction: "desc" }] },
    );

    expect(params.sorts).toHaveLength(1);
    expect(params.sorts[0]!.field).toBe("month");
    expect(params.sorts[0]!.direction).toBe("desc");
  });

  it("limit override replaces insight limit", () => {
    const params = resolveEffectiveParams(undefined, undefined, 100, {
      limit: 12,
    });

    expect(params.limit).toBe(12);
  });

  it("absent sort override → insight sorts fall through", () => {
    const params = resolveEffectiveParams(
      undefined,
      [{ field: "region", direction: "asc" }],
      undefined,
      { limit: 5 }, // only limit overridden
    );

    expect(params.sorts).toHaveLength(1);
    expect(params.sorts[0]!.field).toBe("region");
    expect(params.limit).toBe(5);
  });

  it("absent limit override → insight limit falls through", () => {
    const params = resolveEffectiveParams(
      undefined,
      undefined,
      100,
      { sorts: [{ field: "month", direction: "asc" }] }, // only sorts overridden
    );

    expect(params.limit).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// §read-only-invariant: insight NEVER mutated after resolution
// ---------------------------------------------------------------------------

describe("override-resolution — read-only invariant: insight is never mutated", () => {
  it("resolving overrides does NOT mutate the original insight's filters", () => {
    const insightFilters: InsightFilter[] = [
      { field: "region", operator: "eq", value: "EMEA" },
    ];
    const originalFiltersSnapshot = JSON.stringify(insightFilters);

    resolveEffectiveParams(insightFilters, undefined, undefined, {
      filters: [{ field: "region", operator: "eq", value: "APAC" }],
    });

    // The array itself must be unchanged
    expect(JSON.stringify(insightFilters)).toBe(originalFiltersSnapshot);
  });

  it("resolving overrides does NOT mutate the original insight object", () => {
    const insight: Insight = { ...BASE_INSIGHT };
    const snapshotBefore = JSON.stringify(insight);

    // Run several override combinations
    resolveEffectiveParams(insight.filters, insight.sorts, undefined, {
      filters: [{ field: "month", operator: "eq", value: "Nov" }],
      sorts: [{ field: "month", direction: "desc" }],
      limit: 12,
    });

    resolveEffectiveParams(insight.filters, insight.sorts, undefined, {
      filters: [
        { field: "region", operator: "eq", value: "EMEA", cleared: true },
      ],
    });

    expect(JSON.stringify(insight)).toBe(snapshotBefore);
  });

  it("insight filters array is not shared with effective params (mutation of result does not affect insight)", () => {
    const insightFilters: InsightFilter[] = [
      { field: "region", operator: "eq", value: "EMEA" },
    ];

    const params = resolveEffectiveParams(
      insightFilters,
      undefined,
      undefined,
      undefined,
    );

    // Mutate the returned filters array
    params.filters.push({ field: "month", operator: "eq", value: "Dec" });
    (params.filters[0] as InsightFilter & { value: unknown }).value = "MUTATED";

    // Insight is unchanged
    expect(insightFilters).toHaveLength(1);
    expect(insightFilters[0]!.value).toBe("EMEA");
  });
});

// ---------------------------------------------------------------------------
// §integration: effective filters feed WHERE/HAVING correctly through buildInsightSQL
// ---------------------------------------------------------------------------

describe("override-resolution — integration: effective params feed buildInsightSQL correctly", () => {
  it("effective filters after override appear in the WHERE clause of the SQL", () => {
    const sql = buildWithOverrides(
      {
        ...BASE_INSIGHT,
        filters: [{ field: "region", operator: "eq", value: "EMEA" }],
      },
      { filters: [{ field: "month", operator: "eq", value: "Nov" }] },
    );

    // Both filters should be in WHERE
    expect(sql).toContain(`"${regionAlias}" = 'EMEA'`);
    expect(sql).toContain(`"${monthAlias}" = 'Nov'`);
    expect(sql).toContain("WHERE");
  });

  it("cleared filter field produces NO WHERE predicate for that field", () => {
    const sql = buildWithOverrides(
      {
        ...BASE_INSIGHT,
        filters: [{ field: "region", operator: "eq", value: "EMEA" }],
      },
      {
        filters: [
          { field: "region", operator: "eq", value: "EMEA", cleared: true },
        ],
      },
    );

    // region cleared → no WHERE clause for region
    expect(sql).not.toContain("WHERE");
    expect(sql).not.toContain("EMEA");
  });

  it("sort override changes ORDER BY in SQL", () => {
    const insightWithNoSort: Insight = { ...BASE_INSIGHT, sorts: undefined };
    const sql = buildWithOverrides(insightWithNoSort, {
      sorts: [{ field: "region", direction: "desc" }],
    });

    expect(sql).toContain(`ORDER BY "${regionAlias}" DESC`);
  });
});
