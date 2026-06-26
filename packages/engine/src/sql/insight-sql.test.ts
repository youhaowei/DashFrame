import type {
  DataTable,
  Field,
  Insight,
  InsightFilter,
  InsightMetric,
  UUID,
} from "@dashframe/types";
import { describe, expect, it } from "bun:test";

import {
  buildInsightAvailableFields,
  buildInsightSQL,
  extractColumnAliasComponents,
  extractUUIDFromColumnAlias,
  fieldIdToColumnAlias,
  metricIdToColumnAlias,
  metricToSqlExpression,
  type BuildInsightSQLOptions,
} from "./insight-sql";

// ---------------------------------------------------------------------------
// Fixtures
//
// A single base table with two dimension fields (region, order_date) and a
// numeric field (amount) that a metric aggregates. No joins — exercises the
// simple/aggregated path, which is where filter routing lives.
// ---------------------------------------------------------------------------

const TABLE_ID = "11111111-1111-1111-1111-111111111111" as UUID;
const DATAFRAME_ID = "22222222-2222-2222-2222-222222222222" as UUID;

const REGION_FIELD_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" as UUID;
const DATE_FIELD_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" as UUID;
const AMOUNT_FIELD_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc" as UUID;
const REVENUE_METRIC_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd" as UUID;

const regionAlias = fieldIdToColumnAlias(REGION_FIELD_ID);
const dateAlias = fieldIdToColumnAlias(DATE_FIELD_ID);
const amountAlias = fieldIdToColumnAlias(AMOUNT_FIELD_ID);

function field(
  id: UUID,
  name: string,
  columnName: string,
  type: Field["type"],
): Field {
  return { id, name, tableId: TABLE_ID, columnName, type };
}

const REGION_FIELD = field(REGION_FIELD_ID, "Region", "region", "string");
const DATE_FIELD = field(DATE_FIELD_ID, "Order Date", "order_date", "date");
const AMOUNT_FIELD = field(AMOUNT_FIELD_ID, "Amount", "amount", "number");

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
  fields: [REGION_FIELD, DATE_FIELD, AMOUNT_FIELD],
  metrics: [],
  dataFrameId: DATAFRAME_ID,
  createdAt: 0,
};

/** Build an insight grouped by region with a SUM(amount) revenue metric. */
function groupedInsight(filters?: InsightFilter[]): Insight {
  return {
    id: "99999999-9999-9999-9999-999999999999" as UUID,
    name: "Revenue by Region",
    baseTableId: TABLE_ID,
    selectedFields: [REGION_FIELD_ID],
    metrics: [REVENUE_METRIC],
    filters,
    createdAt: 0,
  };
}

/** Build a metrics-only insight (SUM(amount), no selected dimensions → no GROUP BY). */
function metricsOnlyInsight(filters?: InsightFilter[]): Insight {
  return {
    id: "88888888-8888-8888-8888-888888888888" as UUID,
    name: "Total Revenue",
    baseTableId: TABLE_ID,
    selectedFields: [],
    metrics: [REVENUE_METRIC],
    filters,
    createdAt: 0,
  };
}

const QUERY_OPTS: BuildInsightSQLOptions = { mode: "query" };

function build(
  insight: Insight,
  opts: BuildInsightSQLOptions = QUERY_OPTS,
): string {
  const sql = buildInsightSQL(BASE_TABLE, new Map(), insight, opts);
  expect(sql).not.toBeNull();
  return sql!;
}

describe("buildInsightSQL — filter clause routing", () => {
  it("emits a WHERE clause for a filter on a grouped dimension (not HAVING)", () => {
    const sql = build(
      groupedInsight([{ field: "region", operator: "eq", value: "EMEA" }]),
    );

    expect(sql).toContain(`WHERE "${regionAlias}" = 'EMEA'`);
    expect(sql).not.toContain("HAVING");
    // WHERE must precede GROUP BY (pre-aggregation)
    expect(sql.indexOf("WHERE")).toBeLessThan(sql.indexOf("GROUP BY"));
  });

  it("emits a HAVING clause for a filter on a metric (not WHERE)", () => {
    // Filter references the metric's source column → post-aggregation HAVING.
    const sql = build(
      groupedInsight([{ field: "amount", operator: "gt", value: 1000 }]),
    );

    expect(sql).toContain("HAVING");
    expect(sql).toContain(`SUM("${amountAlias}") > 1000`);
    // HAVING references the aggregate, not the raw column in a WHERE
    expect(sql).not.toMatch(/WHERE/);
    // HAVING must follow GROUP BY (post-aggregation)
    expect(sql.indexOf("GROUP BY")).toBeLessThan(sql.indexOf("HAVING"));
  });

  it("splits mixed dimension + metric filters into both WHERE and HAVING", () => {
    const sql = build(
      groupedInsight([
        { field: "region", operator: "eq", value: "EMEA" },
        { field: "amount", operator: "gte", value: 500 },
      ]),
    );

    expect(sql).toContain(`WHERE "${regionAlias}" = 'EMEA'`);
    expect(sql).toContain(`HAVING SUM("${amountAlias}") >= 500`);
    // Ordering: WHERE … GROUP BY … HAVING
    expect(sql.indexOf("WHERE")).toBeLessThan(sql.indexOf("GROUP BY"));
    expect(sql.indexOf("GROUP BY")).toBeLessThan(sql.indexOf("HAVING"));
  });
});

describe("buildInsightSQL — operators", () => {
  it("renders BETWEEN low AND high (inclusive) for a date range, correctly quoted", () => {
    const sql = build(
      groupedInsight([
        {
          field: "order_date",
          operator: "between",
          value: { low: "2024-01-01", high: "2024-12-31" },
        },
      ]),
    );

    // order_date is not in selectedFields and not a metric, so it routes to WHERE.
    // Inclusive BETWEEN with both bounds quoted as string literals.
    expect(sql).toContain(
      `"${dateAlias}" BETWEEN '2024-01-01' AND '2024-12-31'`,
    );
    expect(sql).toContain("WHERE");
  });

  it("renders IN (...) for the in operator", () => {
    const sql = build(
      groupedInsight([
        { field: "region", operator: "in", value: ["EMEA", "APAC"] },
      ]),
    );

    expect(sql).toContain(`"${regionAlias}" IN ('EMEA', 'APAC')`);
  });

  it("maps each scalar operator to the right SQL comparison operator", () => {
    const cases: Array<[InsightFilter["operator"], string]> = [
      ["eq", "="],
      ["ne", "<>"],
      ["gt", ">"],
      ["gte", ">="],
      ["lt", "<"],
      ["lte", "<="],
    ];

    for (const [operator, sqlOp] of cases) {
      const sql = build(
        groupedInsight([{ field: "region", operator, value: "EMEA" }]),
      );
      expect(sql).toContain(`"${regionAlias}" ${sqlOp} 'EMEA'`);
    }
  });

  it("renders contains as a LIKE %..% match", () => {
    const sql = build(
      groupedInsight([{ field: "region", operator: "contains", value: "ME" }]),
    );

    expect(sql).toContain(`"${regionAlias}" LIKE '%ME%'`);
  });
});

describe("buildInsightSQL — regression: filters are no longer silently dropped", () => {
  it("emits a filter clause when the insight has saved filters", () => {
    const withFilter = build(
      groupedInsight([{ field: "region", operator: "eq", value: "EMEA" }]),
    );
    const withoutFilter = build(groupedInsight());

    // The bug: filters were accepted but never emitted. Assert the clause is
    // now PRESENT when filters exist, and ABSENT when they don't.
    expect(withFilter).toContain("WHERE");
    expect(withoutFilter).not.toContain("WHERE");
    expect(withoutFilter).not.toContain("HAVING");
  });
});

describe("buildInsightSQL — value quoting / injection guard", () => {
  it("escapes a single-quote in a value so the SQL is not broken", () => {
    const sql = build(
      groupedInsight([{ field: "region", operator: "eq", value: "O'Brien" }]),
    );

    // Single quote doubled per SQL escaping — the value stays a single literal.
    expect(sql).toContain(`"${regionAlias}" = 'O''Brien'`);
    // A naive injection attempt does not terminate the string early.
    const injection = build(
      groupedInsight([
        { field: "region", operator: "eq", value: "x'; DROP TABLE sales; --" },
      ]),
    );
    expect(injection).toContain(`'x''; DROP TABLE sales; --'`);
    expect(injection).not.toContain(`'x'; DROP`);
  });
});

describe("buildInsightSQL — null handling and edge cases", () => {
  it("emits IS NULL for an eq filter with a null value (not = NULL)", () => {
    const sql = build(
      groupedInsight([{ field: "region", operator: "eq", value: null }]),
    );
    expect(sql).toContain(`"${regionAlias}" IS NULL`);
    expect(sql).not.toContain("= NULL");
  });

  it("emits IS NOT NULL for a ne filter with a null value", () => {
    const sql = build(
      groupedInsight([{ field: "region", operator: "ne", value: null }]),
    );
    expect(sql).toContain(`"${regionAlias}" IS NOT NULL`);
    expect(sql).not.toContain("<> NULL");
  });

  it("routes a metric filter to HAVING even with no GROUP BY (metrics-only insight)", () => {
    // No selectedFields → no GROUP BY, but the query still aggregates (SUM).
    // A predicate on the metric must land in HAVING, not WHERE.
    const sql = build(
      metricsOnlyInsight([{ field: "amount", operator: "gt", value: 1000 }]),
    );
    expect(sql).toContain(`HAVING SUM("${amountAlias}") > 1000`);
    expect(sql).not.toContain("WHERE");
    expect(sql).not.toContain("GROUP BY");
  });

  it("routes a shared dimension+metric column to WHERE (dimension membership wins)", () => {
    // `amount` is both selected as a grouped dimension AND the metric's source.
    // Dimension membership takes precedence → WHERE (the grouped value is in
    // scope pre-aggregation).
    const insight: Insight = {
      id: "77777777-7777-7777-7777-777777777777" as UUID,
      name: "Amount grouped + summed",
      baseTableId: TABLE_ID,
      selectedFields: [AMOUNT_FIELD_ID],
      metrics: [REVENUE_METRIC], // SUM(amount)
      filters: [{ field: "amount", operator: "gt", value: 10 }],
      createdAt: 0,
    };
    const sql = build(insight);
    expect(sql).toContain(`WHERE "${amountAlias}" > 10`);
    expect(sql).not.toContain("HAVING");
  });

  it("emits a no-op predicate (not a throw) for a malformed between value", () => {
    // A persisted/garbled between value missing its bounds must not throw or
    // silently drop every row — it emits an always-true guard instead.
    const sql = build(
      groupedInsight([
        { field: "order_date", operator: "between", value: null },
      ]),
    );
    expect(sql).toContain("1=1");
    expect(sql).not.toContain("BETWEEN");
  });

  it("references COUNT(*) in HAVING for a count metric filtered by its output alias", () => {
    // A COUNT(*) metric has no source column — HAVING must reference COUNT(*),
    // not a quoted column. The filter targets the metric's output alias.
    const countMetricId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" as UUID;
    const insight: Insight = {
      id: "66666666-6666-6666-6666-666666666666" as UUID,
      name: "Row count by region",
      baseTableId: TABLE_ID,
      selectedFields: [REGION_FIELD_ID],
      metrics: [
        {
          id: countMetricId,
          name: "Rows",
          sourceTable: TABLE_ID,
          aggregation: "count",
        },
      ],
      filters: [
        {
          field: metricIdToColumnAlias(countMetricId),
          operator: "gt",
          value: 5,
        },
      ],
      createdAt: 0,
    };
    const sql = build(insight);
    expect(sql).toContain("HAVING COUNT(*) > 5");
    expect(sql).not.toContain("WHERE");
  });
});

describe("buildInsightSQL — model-mode previews are unfiltered", () => {
  it("does NOT emit a filter clause in model mode even when the insight has saved filters", () => {
    // A preview shows raw source rows so the user can see what they're working
    // with before filtering. Applying result-filters would defeat that, and the
    // joined model path doesn't filter either — both paths stay consistent.
    const insight = groupedInsight([
      { field: "region", operator: "eq", value: "EMEA" },
    ]);

    const modelSQL = build(insight, { mode: "model" });
    expect(modelSQL).not.toContain("WHERE");
    expect(modelSQL).not.toContain("HAVING");

    // Same insight in query mode DOES filter — proves the gate is mode-based,
    // not a blanket drop.
    const querySQL = build(insight, { mode: "query" });
    expect(querySQL).toContain(`WHERE "${regionAlias}" = 'EMEA'`);
  });
});

describe("buildInsightSQL — filter on a dropped join key is safely skipped", () => {
  // Join fixtures: a base "orders" table joined to a "customers" table on
  // customer_id. processSingleJoin drops the right-side join key (customer_id
  // from customers) from the joined subquery to avoid duplication — so a filter
  // targeting that dropped column must NOT emit a reference to it.
  const ORDERS_ID = "12121212-1212-1212-1212-121212121212" as UUID;
  const ORDERS_DF = "34343434-3434-3434-3434-343434343434" as UUID;
  const CUSTOMERS_ID = "56565656-5656-5656-5656-565656565656" as UUID;
  const CUSTOMERS_DF = "78787878-7878-7878-7878-787878787878" as UUID;

  const O_ID_FIELD = {
    id: "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1" as UUID,
    name: "Order ID",
    tableId: ORDERS_ID,
    columnName: "order_id",
    type: "string" as const,
  };
  const O_CUSTID_FIELD = {
    id: "b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2" as UUID,
    name: "Customer ID (orders)",
    tableId: ORDERS_ID,
    columnName: "customer_id",
    type: "string" as const,
  };
  // Right-side join key — this is the column processSingleJoin drops.
  const C_CUSTID_FIELD = {
    id: "c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3" as UUID,
    name: "Customer ID (customers)",
    tableId: CUSTOMERS_ID,
    columnName: "customer_id",
    type: "string" as const,
  };
  const C_NAME_FIELD = {
    id: "d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4" as UUID,
    name: "Customer Name",
    tableId: CUSTOMERS_ID,
    columnName: "customer_name",
    type: "string" as const,
  };

  const ordersTable: DataTable = {
    id: ORDERS_ID,
    name: "orders",
    dataSourceId: "33333333-3333-3333-3333-333333333333" as UUID,
    table: "orders.csv",
    fields: [O_ID_FIELD, O_CUSTID_FIELD],
    metrics: [],
    dataFrameId: ORDERS_DF,
    createdAt: 0,
  };
  const customersTable: DataTable = {
    id: CUSTOMERS_ID,
    name: "customers",
    dataSourceId: "33333333-3333-3333-3333-333333333333" as UUID,
    table: "customers.csv",
    fields: [C_CUSTID_FIELD, C_NAME_FIELD],
    metrics: [],
    dataFrameId: CUSTOMERS_DF,
    createdAt: 0,
  };

  const droppedRightKeyAlias = fieldIdToColumnAlias(C_CUSTID_FIELD.id);

  it("skips a filter on the dropped right join-key instead of emitting a broken column ref", () => {
    const insight: Insight = {
      id: "11112222-3333-4444-5555-666677778888" as UUID,
      name: "Orders joined to customers",
      baseTableId: ORDERS_ID,
      selectedFields: [O_ID_FIELD.id],
      metrics: [],
      joins: [
        {
          type: "inner",
          rightTableId: CUSTOMERS_ID,
          leftKey: "customer_id",
          rightKey: "customer_id",
        },
      ],
      // Filter targets the right-side customer_id — the column that gets dropped
      // from the joined subquery. Pre-fix this emitted a reference to a
      // non-existent alias and crashed the whole query.
      filters: [{ field: "customer_id", operator: "eq", value: "C-1" }],
      createdAt: 0,
    };

    const sql = buildInsightSQL(
      ordersTable,
      new Map([[CUSTOMERS_ID, customersTable]]),
      insight,
      { mode: "query" },
    );
    expect(sql).not.toBeNull();

    // The dropped right-key alias must NOT appear anywhere in a WHERE clause.
    // The filter resolves to the left "customer_id" (retained, id b2b2…), which
    // IS in the subquery — so either it routes to the retained alias OR is
    // skipped; either way the dropped right alias (c3c3…) is never referenced.
    expect(sql!).not.toContain(`WHERE "${droppedRightKeyAlias}"`);
    expect(sql!).not.toContain(`"${droppedRightKeyAlias}" =`);
  });

  it("still filters on a RETAINED joined-table column (the fix must not drop legitimate joined filters)", () => {
    // customer_name is a non-key column from the joined table — it survives into
    // the subquery and must remain filterable.
    const nameAlias = fieldIdToColumnAlias(C_NAME_FIELD.id);
    const insight: Insight = {
      id: "abababab-cdcd-efef-0101-202020202020" as UUID,
      name: "Orders filtered by customer name",
      baseTableId: ORDERS_ID,
      selectedFields: [O_ID_FIELD.id],
      metrics: [],
      joins: [
        {
          type: "inner",
          rightTableId: CUSTOMERS_ID,
          leftKey: "customer_id",
          rightKey: "customer_id",
        },
      ],
      filters: [{ field: "customer_name", operator: "eq", value: "Acme" }],
      createdAt: 0,
    };
    const sql = buildInsightSQL(
      ordersTable,
      new Map([[CUSTOMERS_ID, customersTable]]),
      insight,
      { mode: "query" },
    );
    expect(sql).not.toBeNull();
    expect(sql!).toContain(`WHERE "${nameAlias}" = 'Acme'`);
  });

  it("safely skips a filter whose field is absent from the result set entirely (no broken ref, no throw)", () => {
    // A filter on a column that exists in NEITHER table (e.g. stale saved filter
    // after a schema change) must not emit `WHERE "ghost_col" = …` — that would
    // crash the query. It is dropped fail-safe.
    const insight: Insight = {
      id: "99990000-1111-2222-3333-444455556666" as UUID,
      name: "Orders with a stale filter",
      baseTableId: ORDERS_ID,
      selectedFields: [O_ID_FIELD.id],
      metrics: [],
      filters: [{ field: "ghost_column", operator: "eq", value: "x" }],
      createdAt: 0,
    };

    const sql = buildInsightSQL(ordersTable, new Map(), insight, {
      mode: "query",
    });
    expect(sql).not.toBeNull();
    // No reference to the ghost column, and no dangling WHERE.
    expect(sql!).not.toContain("ghost_column");
    expect(sql!).not.toContain("WHERE");
  });
});

// ---------------------------------------------------------------------------
// Security guard tests — every bad-input class must THROW (fail-closed)
// ---------------------------------------------------------------------------

describe("buildInsightSQL — sink guards: non-finite numbers throw", () => {
  it("throws when a filter value is NaN", () => {
    expect(() =>
      build(groupedInsight([{ field: "region", operator: "eq", value: NaN }])),
    ).toThrow("non-finite number");
  });

  it("throws when a filter value is Infinity", () => {
    expect(() =>
      build(
        groupedInsight([{ field: "region", operator: "gt", value: Infinity }]),
      ),
    ).toThrow("non-finite number");
  });

  it("throws when a filter value is -Infinity", () => {
    expect(() =>
      build(
        groupedInsight([{ field: "region", operator: "lt", value: -Infinity }]),
      ),
    ).toThrow("non-finite number");
  });

  it("throws when an effectiveFilters value is NaN (validated at coalesce time)", () => {
    const insight = groupedInsight();
    expect(() =>
      buildInsightSQL(BASE_TABLE, new Map(), insight, {
        mode: "query",
        effectiveFilters: [{ field: "region", operator: "eq", value: NaN }],
      }),
    ).toThrow("non-finite number");
  });

  it("throws when an effectiveFilters between value contains a non-finite bound", () => {
    const insight = groupedInsight();
    expect(() =>
      buildInsightSQL(BASE_TABLE, new Map(), insight, {
        mode: "query",
        effectiveFilters: [
          {
            field: "region",
            operator: "between",
            value: { low: 1, high: Infinity },
          },
        ],
      }),
    ).toThrow("non-finite number");
  });

  it("throws when an effectiveFilters in-array value contains NaN", () => {
    const insight = groupedInsight();
    expect(() =>
      buildInsightSQL(BASE_TABLE, new Map(), insight, {
        mode: "query",
        effectiveFilters: [
          { field: "region", operator: "in", value: ["EMEA", NaN] },
        ],
      }),
    ).toThrow("non-finite number");
  });
});

describe("buildInsightSQL — sink guards: LIMIT/OFFSET must be non-negative integers", () => {
  it("throws when limit is NaN", () => {
    expect(() =>
      build(groupedInsight(), { mode: "query", limit: NaN }),
    ).toThrow("invalid limit");
  });

  it("throws when limit is Infinity", () => {
    expect(() =>
      build(groupedInsight(), { mode: "query", limit: Infinity }),
    ).toThrow("invalid limit");
  });

  it("throws when limit is negative", () => {
    expect(() => build(groupedInsight(), { mode: "query", limit: -1 })).toThrow(
      "invalid limit",
    );
  });

  it("throws when limit is a non-integer float", () => {
    expect(() =>
      build(groupedInsight(), { mode: "query", limit: 1.5 }),
    ).toThrow("invalid limit");
  });

  it("throws when offset is NaN", () => {
    expect(() =>
      build(groupedInsight(), { mode: "query", offset: NaN }),
    ).toThrow("invalid offset");
  });

  it("throws when offset is negative", () => {
    expect(() =>
      build(groupedInsight(), { mode: "query", offset: -5 }),
    ).toThrow("invalid offset");
  });

  it("throws when offset is Infinity", () => {
    expect(() =>
      build(groupedInsight(), { mode: "query", offset: Infinity }),
    ).toThrow("invalid offset");
  });

  it("accepts limit=0 and offset=0 (edge: zero is a valid non-negative integer)", () => {
    // limit=0 emits LIMIT 0 (valid DuckDB SQL — returns empty result); offset=0 is a no-op.
    const sql = build(groupedInsight(), { mode: "query", limit: 0, offset: 0 });
    expect(sql).toContain("LIMIT 0");
    expect(sql).toContain("OFFSET 0");
  });
});

describe("buildInsightSQL — sink guards: invalid join type throws", () => {
  const JOIN_TABLE_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" as UUID;
  const JOIN_DF_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff" as UUID;
  const BASE_ID_FIELD: Field = {
    id: "11111111-aaaa-aaaa-aaaa-111111111111" as UUID,
    name: "ID",
    tableId: TABLE_ID,
    columnName: "id",
    type: "string",
  };
  const JOIN_ID_FIELD: Field = {
    id: "22222222-bbbb-bbbb-bbbb-222222222222" as UUID,
    name: "ID",
    tableId: JOIN_TABLE_ID,
    columnName: "id",
    type: "string",
  };
  const joinedTable: DataTable = {
    id: JOIN_TABLE_ID,
    name: "dim",
    dataSourceId: "33333333-3333-3333-3333-333333333333" as UUID,
    table: "dim.csv",
    fields: [JOIN_ID_FIELD],
    metrics: [],
    dataFrameId: JOIN_DF_ID,
    createdAt: 0,
  };
  const baseTableWithId: DataTable = {
    ...BASE_TABLE,
    fields: [BASE_ID_FIELD, ...BASE_TABLE.fields!],
  };

  it("throws when join.type is not a whitelisted value", () => {
    const insight: Insight = {
      id: "aaaabbbb-cccc-dddd-eeee-ffffaaaabbbb" as UUID,
      name: "Bad join",
      baseTableId: TABLE_ID,
      selectedFields: [],
      metrics: [],
      // Cast to bypass TS — simulates a deserialized value from untrusted source
      joins: [
        {
          type: "cross" as unknown as "inner",
          rightTableId: JOIN_TABLE_ID,
          leftKey: "id",
          rightKey: "id",
        },
      ],
      createdAt: 0,
    };
    expect(() =>
      buildInsightSQL(
        baseTableWithId,
        new Map([[JOIN_TABLE_ID, joinedTable]]),
        insight,
        {
          mode: "query",
        },
      ),
    ).toThrow("invalid join type");
  });

  it("does not throw for each valid join type (inner, left, right, full)", () => {
    for (const type of ["inner", "left", "right", "full"] as const) {
      const insight: Insight = {
        id: "aaaabbbb-cccc-dddd-eeee-ffffaaaabbbb" as UUID,
        name: "Valid join",
        baseTableId: TABLE_ID,
        selectedFields: [],
        metrics: [],
        joins: [
          { type, rightTableId: JOIN_TABLE_ID, leftKey: "id", rightKey: "id" },
        ],
        createdAt: 0,
      };
      expect(() =>
        buildInsightSQL(
          baseTableWithId,
          new Map([[JOIN_TABLE_ID, joinedTable]]),
          insight,
          {
            mode: "query",
          },
        ),
      ).not.toThrow();
    }
  });
});

describe("buildInsightSQL — sink guards: invalid aggregation throws", () => {
  it("throws when metric.aggregation is not a whitelisted value (SELECT path via buildMetricExpressionWithUUID)", () => {
    // This exercises buildMetricExpressionWithUUID (the aggregation whitelist in
    // the SELECT/GROUP BY path). The metric is referenced in selectedFields+metrics
    // without a HAVING filter, so only buildMetricExpressionWithUUID fires.
    const badMetric: InsightMetric = {
      id: "aaaabbbb-1111-2222-3333-444455556666" as UUID,
      name: "Bad agg",
      sourceTable: TABLE_ID,
      columnName: "amount",
      aggregation: "inject" as unknown as "sum",
    };
    const insight: Insight = {
      id: "bbbbcccc-1111-2222-3333-444455556666" as UUID,
      name: "Insight with bad aggregation",
      baseTableId: TABLE_ID,
      selectedFields: [REGION_FIELD_ID],
      metrics: [badMetric],
      createdAt: 0,
    };
    expect(() =>
      buildInsightSQL(BASE_TABLE, new Map(), insight, { mode: "query" }),
    ).toThrow("invalid aggregation");
  });

  it("throws when metric.aggregation is invalid on the HAVING path (resolveMetricAggRef)", () => {
    // A filter targeting the metric's source column routes to HAVING via resolveMetricAggRef,
    // which has its own independent aggregation whitelist. This test confirms that path throws.
    const badMetricId = "ffffffff-1111-2222-3333-444455556666" as UUID;
    const badMetric: InsightMetric = {
      id: badMetricId,
      name: "Bad agg",
      sourceTable: TABLE_ID,
      columnName: "amount",
      aggregation: "inject" as unknown as "sum",
    };
    const insight: Insight = {
      id: "eeeeeeee-1111-2222-3333-444455556666" as UUID,
      name: "Bad agg with HAVING filter",
      baseTableId: TABLE_ID,
      selectedFields: [REGION_FIELD_ID],
      metrics: [badMetric],
      // Filter on the metric's output alias → routes to HAVING → resolveMetricAggRef
      filters: [{ field: "amount", operator: "gt", value: 100 }],
      createdAt: 0,
    };
    expect(() =>
      buildInsightSQL(BASE_TABLE, new Map(), insight, { mode: "query" }),
    ).toThrow("invalid aggregation");
  });

  it("does not throw for each valid aggregation type", () => {
    const validAggs = [
      "sum",
      "avg",
      "count",
      "min",
      "max",
      "count_distinct",
    ] as const;
    for (const aggregation of validAggs) {
      const metric: InsightMetric = {
        id: "ccccdddd-1111-2222-3333-444455556666" as UUID,
        name: "Valid agg",
        sourceTable: TABLE_ID,
        columnName: aggregation === "count" ? undefined : "amount",
        aggregation,
      };
      const insight: Insight = {
        id: "ddddeeeee-1111-2222-3333-444455556666" as UUID,
        name: "Insight with valid aggregation",
        baseTableId: TABLE_ID,
        selectedFields: [REGION_FIELD_ID],
        metrics: [metric],
        createdAt: 0,
      };
      expect(() =>
        buildInsightSQL(BASE_TABLE, new Map(), insight, { mode: "query" }),
      ).not.toThrow();
    }
  });
});

describe("buildInsightSQL — sink guards: sortDirection whitelist", () => {
  it("throws when sortDirection is not 'asc' or 'desc'", () => {
    const sortAlias = fieldIdToColumnAlias(REGION_FIELD_ID);
    expect(() =>
      buildInsightSQL(BASE_TABLE, new Map(), groupedInsight(), {
        mode: "query",
        sortColumn: sortAlias,
        sortDirection: "ASC" as unknown as "asc", // uppercase, not in whitelist
      }),
    ).toThrow("invalid sortDirection");
  });

  it("does not throw for 'asc'", () => {
    const sortAlias = fieldIdToColumnAlias(REGION_FIELD_ID);
    expect(() =>
      buildInsightSQL(BASE_TABLE, new Map(), groupedInsight(), {
        mode: "query",
        sortColumn: sortAlias,
        sortDirection: "asc",
      }),
    ).not.toThrow();
  });

  it("does not throw for 'desc'", () => {
    const sortAlias = fieldIdToColumnAlias(REGION_FIELD_ID);
    expect(() =>
      buildInsightSQL(BASE_TABLE, new Map(), groupedInsight(), {
        mode: "query",
        sortColumn: sortAlias,
        sortDirection: "desc",
      }),
    ).not.toThrow();
  });

  it("silently drops ORDER BY when sortColumn is not in the valid column set", () => {
    // Guard: a sort referencing a non-existent column (e.g. a metric alias in model
    // mode) must be dropped, not emitted — an unknown column reference breaks the query.
    const sql = buildInsightSQL(BASE_TABLE, new Map(), groupedInsight(), {
      mode: "query",
      sortColumn: "non_existent_col",
      sortDirection: "asc",
    });
    expect(sql).not.toBeNull();
    expect(sql!).not.toContain("ORDER BY");
    expect(sql!).not.toContain("non_existent_col");
  });
});

describe("buildInsightSQL — COALESCE for RIGHT/FULL join key", () => {
  // Fixtures: base "employees" table joined to "departments" on dept_id.
  // For a RIGHT or FULL join an unmatched right-side row has NULL in the left
  // join key (emp_dept_id alias), while the dropped right key (dept_id from
  // departments) carries the real value.  The fix must project
  // COALESCE("left_alias", "departments"."dept_id") AS "left_alias" so the
  // result is never NULL for unmatched rows.
  const EMP_TABLE_ID = "ee000000-0000-0000-0000-000000000001" as UUID;
  const EMP_DF_ID = "ee000000-0000-0000-0000-000000000002" as UUID;
  const DEPT_TABLE_ID = "dd000000-0000-0000-0000-000000000001" as UUID;
  const DEPT_DF_ID = "dd000000-0000-0000-0000-000000000002" as UUID;

  const EMP_ID_FIELD: Field = {
    id: "ee111111-aaaa-aaaa-aaaa-111111111111" as UUID,
    name: "Employee ID",
    tableId: EMP_TABLE_ID,
    columnName: "emp_id",
    type: "string",
  };
  const EMP_DEPT_ID_FIELD: Field = {
    id: "ee222222-bbbb-bbbb-bbbb-222222222222" as UUID,
    name: "Department ID (emp)",
    tableId: EMP_TABLE_ID,
    columnName: "dept_id",
    type: "string",
  };
  const DEPT_DEPT_ID_FIELD: Field = {
    id: "dd333333-cccc-cccc-cccc-333333333333" as UUID,
    name: "Department ID",
    tableId: DEPT_TABLE_ID,
    columnName: "dept_id",
    type: "string",
  };
  const DEPT_NAME_FIELD: Field = {
    id: "dd444444-dddd-dddd-dddd-444444444444" as UUID,
    name: "Dept Name",
    tableId: DEPT_TABLE_ID,
    columnName: "dept_name",
    type: "string",
  };

  const empTable: DataTable = {
    id: EMP_TABLE_ID,
    name: "employees",
    dataSourceId: "33333333-3333-3333-3333-333333333333" as UUID,
    table: "employees.csv",
    fields: [EMP_ID_FIELD, EMP_DEPT_ID_FIELD],
    metrics: [],
    dataFrameId: EMP_DF_ID,
    createdAt: 0,
  };
  const deptTable: DataTable = {
    id: DEPT_TABLE_ID,
    name: "departments",
    dataSourceId: "33333333-3333-3333-3333-333333333333" as UUID,
    table: "departments.csv",
    fields: [DEPT_DEPT_ID_FIELD, DEPT_NAME_FIELD],
    metrics: [],
    dataFrameId: DEPT_DF_ID,
    createdAt: 0,
  };

  const leftKeyAlias = fieldIdToColumnAlias(EMP_DEPT_ID_FIELD.id);

  for (const joinType of ["right", "full"] as const) {
    it(`emits COALESCE for the join key on a ${joinType.toUpperCase()} join`, () => {
      const insight: Insight = {
        id: "yw305000-0000-0000-0000-000000000001" as UUID,
        name: `Employees ${joinType} join departments`,
        baseTableId: EMP_TABLE_ID,
        selectedFields: [EMP_ID_FIELD.id, EMP_DEPT_ID_FIELD.id],
        metrics: [],
        joins: [
          {
            type: joinType,
            rightTableId: DEPT_TABLE_ID,
            leftKey: "dept_id",
            rightKey: "dept_id",
          },
        ],
        createdAt: 0,
      };

      const sql = buildInsightSQL(
        empTable,
        new Map([[DEPT_TABLE_ID, deptTable]]),
        insight,
        { mode: "query" },
      );
      expect(sql).not.toBeNull();

      // Single scoped assertion: the exact COALESCE projection. A bare
      // `toContain("dept_id")` would pass in the bug state too (it appears in
      // the ON clause); this substring only holds when the join key is
      // projected via COALESCE(left_alias, right_table.right_col).
      expect(sql!).toContain(
        `COALESCE("${leftKeyAlias}", "departments"."dept_id")`,
      );
    });
  }

  for (const joinType of ["inner", "left"] as const) {
    it(`does NOT emit COALESCE for a ${joinType.toUpperCase()} join (existing behavior preserved)`, () => {
      const insight: Insight = {
        id: "yw305000-0000-0000-0000-000000000002" as UUID,
        name: `Employees ${joinType} join departments`,
        baseTableId: EMP_TABLE_ID,
        selectedFields: [EMP_ID_FIELD.id, EMP_DEPT_ID_FIELD.id],
        metrics: [],
        joins: [
          {
            type: joinType,
            rightTableId: DEPT_TABLE_ID,
            leftKey: "dept_id",
            rightKey: "dept_id",
          },
        ],
        createdAt: 0,
      };

      const sql = buildInsightSQL(
        empTable,
        new Map([[DEPT_TABLE_ID, deptTable]]),
        insight,
        { mode: "query" },
      );
      expect(sql).not.toBeNull();
      expect(sql!).not.toContain("COALESCE");
    });
  }
});

describe("buildInsightSQL — identifier quoting: embedded double-quotes in display names", () => {
  it("produces valid SQL when the table name contains an embedded double-quote", () => {
    // A CSV column named 'sales "2024"' becomes the table display alias after
    // shortenAutoGeneratedName strips the UUID suffix. The identifier quoting must
    // double the embedded " so the SQL identifier is syntactically valid.
    const tableWithQuotedName: typeof BASE_TABLE = {
      ...BASE_TABLE,
      name: 'my "best" sales table',
    };
    const sql = buildInsightSQL(
      tableWithQuotedName,
      new Map(),
      groupedInsight(),
      { mode: "query" },
    );
    expect(sql).not.toBeNull();
    // The display name with embedded " must be double-escaped in the SQL identifier.
    // quoteIdentifier produces "my ""best"" sales table" — never a bare unescaped "
    // that would break the SQL identifier boundary.
    expect(sql!).toContain('""');
    // The SQL must not contain a raw unescaped " adjacent to non-quote chars that would
    // break out of the identifier — if the SQL were broken, DuckDB would reject it.
    // A simple structural check: the AS alias must be wrapped in outer quotes.
    expect(sql!).toMatch(/AS "my ""best"" sales table"/);
  });
});

// ---------------------------------------------------------------------------
// metricToSqlExpression — DSL format contract
//
// Contract: metricToSqlExpression emits UNQUOTED column names.
// This string is consumed by vgplot's parseEncodingValue DSL parser, which
// extracts the column name via regex (e.g. /^sum\((.+)\)$/i) and passes it
// to the Mosaic API (api.sum(columnName)). Mosaic quotes identifiers itself.
// Quoting here would double-process: the regex would extract '"amount"' (with
// embedded quotes) and Mosaic would look for a column literally named "amount"
// (with quotes), which does not exist — charts would fail to render.
//
// The SQL injection guard for metricToSqlExpression is Mosaic, not this layer.
// The real SQL sinks that need quoting are:
//   - applyDateTransformToSql (date_trunc / monthname expressions)
//   - buildColumnSelectWithFieldId, resolveMetricAggRef, buildMetricExpressionWithUUID
//     (all inside buildInsightSQL — these call quoteIdentifier already)
// ---------------------------------------------------------------------------

describe("metricToSqlExpression — DSL format contract", () => {
  const baseMetric = (overrides: Partial<InsightMetric>): InsightMetric => ({
    id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" as UUID,
    name: "Test Metric",
    sourceTable: TABLE_ID,
    aggregation: "sum",
    ...overrides,
  });

  it("count(*) emits unquoted star", () => {
    const expr = metricToSqlExpression(
      baseMetric({ aggregation: "count", columnName: undefined }),
    );
    expect(expr).toBe("count(*)");
  });

  it("standard aggregation emits unquoted column name (vgplot DSL format)", () => {
    // Must NOT be sum("amount") — vgplot regex would extract '"amount"' with quotes
    const expr = metricToSqlExpression(
      baseMetric({ aggregation: "sum", columnName: "amount" }),
    );
    expect(expr).toBe("sum(amount)");
    expect(expr).not.toContain('"amount"');
  });

  it("count_distinct emits unquoted column name (vgplot DSL format)", () => {
    // Must NOT be count_distinct("user_id") — same round-trip breakage
    const expr = metricToSqlExpression(
      baseMetric({ aggregation: "count_distinct", columnName: "user_id" }),
    );
    expect(expr).toBe("count_distinct(user_id)");
    expect(expr).not.toContain('"user_id"');
  });

  it("aggregation with no columnName falls back to *", () => {
    const expr = metricToSqlExpression(
      baseMetric({ aggregation: "sum", columnName: undefined }),
    );
    expect(expr).toBe("sum(*)");
  });
});

// ---------------------------------------------------------------------------
// extractUUIDFromColumnAlias + extractColumnAliasComponents — round-trip with
// join-instance suffixes (_j1, _j2 …).
//
// Contract:
//  - extractUUIDFromColumnAlias strips the suffix and returns the bare UUID
//    (all consumers that only need the field ID continue to work).
//  - extractColumnAliasComponents returns { uuid, instanceIndex } so consumers
//    that must distinguish join instances can do so.
// ---------------------------------------------------------------------------

describe("extractUUIDFromColumnAlias — join-instance suffix stripping", () => {
  const FIELD_UUID = "dd05ef4b-1234-5678-abcd-ef1234567890" as UUID;
  const canonicalAlias = fieldIdToColumnAlias(FIELD_UUID);

  it("round-trip: canonical alias (no suffix) → original UUID", () => {
    expect(extractUUIDFromColumnAlias(canonicalAlias)).toBe(FIELD_UUID);
  });

  it("round-trip: _j1-suffixed alias → same original UUID (suffix stripped)", () => {
    const suffixed = `${canonicalAlias}_j1`;
    expect(extractUUIDFromColumnAlias(suffixed)).toBe(FIELD_UUID);
  });

  it("round-trip: _j9-suffixed alias → same original UUID", () => {
    const suffixed = `${canonicalAlias}_j9`;
    expect(extractUUIDFromColumnAlias(suffixed)).toBe(FIELD_UUID);
  });

  it("returns null for non-field/metric aliases (no regression)", () => {
    expect(extractUUIDFromColumnAlias("some_random_column")).toBeNull();
  });
});

describe("extractColumnAliasComponents — instance-index disambiguation", () => {
  const FIELD_UUID = "dd05ef4b-1234-5678-abcd-ef1234567890" as UUID;
  const canonicalAlias = fieldIdToColumnAlias(FIELD_UUID);

  it("canonical alias → { uuid, instanceIndex: 0 }", () => {
    const result = extractColumnAliasComponents(canonicalAlias);
    expect(result).not.toBeNull();
    expect(result!.uuid).toBe(FIELD_UUID);
    expect(result!.instanceIndex).toBe(0);
  });

  it("_j1-suffixed alias → { uuid, instanceIndex: 1 }", () => {
    const result = extractColumnAliasComponents(`${canonicalAlias}_j1`);
    expect(result).not.toBeNull();
    expect(result!.uuid).toBe(FIELD_UUID);
    expect(result!.instanceIndex).toBe(1);
  });

  it("_j2-suffixed alias → { uuid, instanceIndex: 2 }", () => {
    const result = extractColumnAliasComponents(`${canonicalAlias}_j2`);
    expect(result).not.toBeNull();
    expect(result!.uuid).toBe(FIELD_UUID);
    expect(result!.instanceIndex).toBe(2);
  });

  it("returns null for unrecognised alias", () => {
    expect(extractColumnAliasComponents("totally_random")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Two joins to the same table — alias emission + buildInsightAvailableFields.
//
// Scenario: orders→users on created_by (instance 0) AND approved_by (instance 1).
// The two joins share the same rightTableId and therefore the same Field UUIDs.
// The fix ensures:
//  (a) the second join's non-key columns get `_j1`-suffixed SQL aliases;
//  (b) buildInsightAvailableFields returns synthetic Fields whose IDs encode the
//      instance index, so display-name/type maps keyed on fieldIdToColumnAlias
//      match what DuckDB actually emitted.
// ---------------------------------------------------------------------------

describe("join-instance identity — two joins to the same table", () => {
  // Table IDs
  const ORDERS_TABLE_ID = "10101010-1010-1010-1010-101010101010" as UUID;
  const ORDERS_DF_ID = "20202020-2020-2020-2020-202020202020" as UUID;
  const USERS_TABLE_ID = "30303030-3030-3030-3030-303030303030" as UUID;
  const USERS_DF_ID = "40404040-4040-4040-4040-404040404040" as UUID;

  // Orders fields
  const O_ID_FIELD: Field = {
    id: "a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0" as UUID,
    name: "Order ID",
    tableId: ORDERS_TABLE_ID,
    columnName: "id",
    type: "string",
  };
  const O_CREATED_BY_FIELD: Field = {
    id: "b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0" as UUID,
    name: "Created By",
    tableId: ORDERS_TABLE_ID,
    columnName: "created_by",
    type: "string",
  };
  const O_APPROVED_BY_FIELD: Field = {
    id: "c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0" as UUID,
    name: "Approved By",
    tableId: ORDERS_TABLE_ID,
    columnName: "approved_by",
    type: "string",
  };

  // Users fields (same DataTable joined twice)
  const U_ID_FIELD: Field = {
    id: "d0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0" as UUID,
    name: "User ID",
    tableId: USERS_TABLE_ID,
    columnName: "id",
    type: "string",
  };
  const U_NAME_FIELD: Field = {
    id: "e0e0e0e0-e0e0-e0e0-e0e0-e0e0e0e0e0e0" as UUID,
    name: "User Name",
    tableId: USERS_TABLE_ID,
    columnName: "name",
    type: "string",
  };
  const U_EMAIL_FIELD: Field = {
    id: "f0f0f0f0-f0f0-f0f0-f0f0-f0f0f0f0f0f0" as UUID,
    name: "User Email",
    tableId: USERS_TABLE_ID,
    columnName: "email",
    type: "string",
  };

  const ordersTable: DataTable = {
    id: ORDERS_TABLE_ID,
    name: "orders",
    dataSourceId: "33333333-3333-3333-3333-333333333333" as UUID,
    table: "orders.csv",
    fields: [O_ID_FIELD, O_CREATED_BY_FIELD, O_APPROVED_BY_FIELD],
    metrics: [],
    dataFrameId: ORDERS_DF_ID,
    createdAt: 0,
  };

  const usersTable: DataTable = {
    id: USERS_TABLE_ID,
    name: "users",
    dataSourceId: "33333333-3333-3333-3333-333333333333" as UUID,
    table: "users.csv",
    fields: [U_ID_FIELD, U_NAME_FIELD, U_EMAIL_FIELD],
    metrics: [],
    dataFrameId: USERS_DF_ID,
    createdAt: 0,
  };

  // Insight: orders joined to users on created_by→id AND approved_by→id.
  const doubleJoinInsight: Insight = {
    id: "50505050-5050-5050-5050-505050505050" as UUID,
    name: "Orders with creator and approver",
    baseTableId: ORDERS_TABLE_ID,
    selectedFields: [],
    metrics: [],
    joins: [
      {
        type: "inner",
        rightTableId: USERS_TABLE_ID,
        leftKey: "created_by",
        rightKey: "id",
      },
      {
        type: "inner",
        rightTableId: USERS_TABLE_ID,
        leftKey: "approved_by",
        rightKey: "id",
      },
    ],
    createdAt: 0,
  };

  // Canonical (first instance) aliases
  const nameAliasJ0 = fieldIdToColumnAlias(U_NAME_FIELD.id);
  const emailAliasJ0 = fieldIdToColumnAlias(U_EMAIL_FIELD.id);
  // Suffixed (second instance) aliases
  const nameAliasJ1 = `${nameAliasJ0}_j1`;
  const emailAliasJ1 = `${emailAliasJ0}_j1`;

  it("emits NO duplicate AS clause when the same table is joined twice", () => {
    const sql = buildInsightSQL(
      ordersTable,
      new Map([[USERS_TABLE_ID, usersTable]]),
      doubleJoinInsight,
      { mode: "model" },
    );
    expect(sql).not.toBeNull();

    const countDefs = (alias: string) =>
      (sql!.match(new RegExp(`AS "${alias}"`, "g")) ?? []).length;

    // Both first-instance aliases defined exactly once
    expect(countDefs(nameAliasJ0)).toBe(1);
    expect(countDefs(emailAliasJ0)).toBe(1);
    // Both second-instance aliases also defined exactly once (distinct from first)
    expect(countDefs(nameAliasJ1)).toBe(1);
    expect(countDefs(emailAliasJ1)).toBe(1);
  });

  it("includes both instances' non-key columns in the SELECT", () => {
    const sql = buildInsightSQL(
      ordersTable,
      new Map([[USERS_TABLE_ID, usersTable]]),
      doubleJoinInsight,
      { mode: "model" },
    );
    expect(sql).not.toBeNull();
    expect(sql!).toContain(`AS "${nameAliasJ0}"`);
    expect(sql!).toContain(`AS "${emailAliasJ0}"`);
    expect(sql!).toContain(`AS "${nameAliasJ1}"`);
    expect(sql!).toContain(`AS "${emailAliasJ1}"`);
  });

  it("single join still emits canonical (unsuffixed) alias — no regression", () => {
    const singleJoinInsight: Insight = {
      ...doubleJoinInsight,
      joins: [doubleJoinInsight.joins![0]!],
    };
    const sql = buildInsightSQL(
      ordersTable,
      new Map([[USERS_TABLE_ID, usersTable]]),
      singleJoinInsight,
      { mode: "model" },
    );
    expect(sql).not.toBeNull();
    expect(sql!).toContain(`AS "${nameAliasJ0}"`);
    expect(sql!).not.toContain(`_j1`);
  });

  it("counter does NOT advance when first join instance is skipped (missing left key)", () => {
    // A join whose leftKey doesn't exist in the base table is skipped.  The
    // valid second join must still get instance index 0 (not 1), so its alias
    // is the canonical `field_<uuid>` — not `field_<uuid>_j1`.
    const insightWithBadFirstJoin: Insight = {
      ...doubleJoinInsight,
      joins: [
        // invalid: "no_such_field" not in ordersTable → skip
        {
          type: "inner",
          rightTableId: USERS_TABLE_ID,
          leftKey: "no_such_field",
          rightKey: "id",
        },
        // valid: approved_by → id (must become instance 0, not 1)
        {
          type: "inner",
          rightTableId: USERS_TABLE_ID,
          leftKey: "approved_by",
          rightKey: "id",
        },
      ],
    };
    const sql = buildInsightSQL(
      ordersTable,
      new Map([[USERS_TABLE_ID, usersTable]]),
      insightWithBadFirstJoin,
      { mode: "model" },
    );
    expect(sql).not.toBeNull();
    // Second (valid) join must use canonical aliases — index 0, no suffix
    expect(sql!).toContain(`AS "${nameAliasJ0}"`);
    expect(sql!).toContain(`AS "${emailAliasJ0}"`);
    // No suffix should appear — the failed first join did not consume an index slot
    expect(sql!).not.toContain(`_j1`);
  });

  it("buildInsightAvailableFields returns synthetic suffixed Fields for repeat-join instances", () => {
    const fields = buildInsightAvailableFields(
      ordersTable,
      new Map([[USERS_TABLE_ID, usersTable]]),
      doubleJoinInsight,
    );
    expect(fields).not.toBeNull();

    // First-instance fields: canonical IDs (no suffix)
    const j0Name = fields!.find((f) => f.id === U_NAME_FIELD.id);
    const j0Email = fields!.find((f) => f.id === U_EMAIL_FIELD.id);
    expect(j0Name).toBeDefined();
    expect(j0Email).toBeDefined();

    // Second-instance fields: synthetic IDs with _j1 suffix
    const j1NameId = `${U_NAME_FIELD.id}_j1` as UUID;
    const j1EmailId = `${U_EMAIL_FIELD.id}_j1` as UUID;
    const j1Name = fields!.find((f) => f.id === j1NameId);
    const j1Email = fields!.find((f) => f.id === j1EmailId);
    expect(j1Name).toBeDefined();
    expect(j1Email).toBeDefined();

    // Synthetic fields carry the canonical field name (for display-name lookup)
    expect(j1Name!.name).toBe(U_NAME_FIELD.name);
    expect(j1Email!.name).toBe(U_EMAIL_FIELD.name);

    // fieldIdToColumnAlias(syntheticId) must equal the alias the SQL builder emitted
    expect(fieldIdToColumnAlias(j1NameId)).toBe(nameAliasJ1);
    expect(fieldIdToColumnAlias(j1EmailId)).toBe(emailAliasJ1);
  });

  it("buildInsightAvailableFields: counter stays at 0 when first join is skipped", () => {
    // Mirror the counter-fix test above but for the field-list computation.
    const insightWithBadFirstJoin: Insight = {
      ...doubleJoinInsight,
      joins: [
        {
          type: "inner",
          rightTableId: USERS_TABLE_ID,
          leftKey: "no_such_field",
          rightKey: "id",
        },
        {
          type: "inner",
          rightTableId: USERS_TABLE_ID,
          leftKey: "approved_by",
          rightKey: "id",
        },
      ],
    };
    const fields = buildInsightAvailableFields(
      ordersTable,
      new Map([[USERS_TABLE_ID, usersTable]]),
      insightWithBadFirstJoin,
    );
    expect(fields).not.toBeNull();
    // Valid join must appear at instance 0 — canonical IDs, no suffix
    expect(fields!.find((f) => f.id === U_NAME_FIELD.id)).toBeDefined();
    expect(fields!.find((f) => f.id === U_EMAIL_FIELD.id)).toBeDefined();
    // No _j1-suffixed entry should exist
    expect(fields!.find((f) => f.id.endsWith("_j1"))).toBeUndefined();
  });

  it("counter does NOT advance when join is skipped due to missing right key", () => {
    // Symmetric counterpart to the missing-leftKey test: the right table exists
    // but its join key is not present as a column → join is skipped.
    // The second valid join must still get instance index 0 (canonical alias).
    const insightWithBadRightKey: Insight = {
      ...doubleJoinInsight,
      joins: [
        // invalid: rightKey "no_such_col" not in usersTable → skip
        {
          type: "inner",
          rightTableId: USERS_TABLE_ID,
          leftKey: "created_by",
          rightKey: "no_such_col",
        },
        // valid: approved_by → id (must become instance 0, not 1)
        {
          type: "inner",
          rightTableId: USERS_TABLE_ID,
          leftKey: "approved_by",
          rightKey: "id",
        },
      ],
    };
    const sql = buildInsightSQL(
      ordersTable,
      new Map([[USERS_TABLE_ID, usersTable]]),
      insightWithBadRightKey,
      { mode: "model" },
    );
    expect(sql).not.toBeNull();
    expect(sql!).toContain(`AS "${nameAliasJ0}"`);
    expect(sql!).toContain(`AS "${emailAliasJ0}"`);
    expect(sql!).not.toContain(`_j1`);

    // Mirror for buildInsightAvailableFields
    const fields = buildInsightAvailableFields(
      ordersTable,
      new Map([[USERS_TABLE_ID, usersTable]]),
      insightWithBadRightKey,
    );
    expect(fields).not.toBeNull();
    expect(fields!.find((f) => f.id === U_NAME_FIELD.id)).toBeDefined();
    expect(fields!.find((f) => f.id.endsWith("_j1"))).toBeUndefined();
  });

  it("counter is not disrupted by a skip between two successful joins — [valid, invalid, valid]", () => {
    // Pattern: first join succeeds (instance 0, canonical), second join is
    // skipped (bad leftKey), third join must get instance 1 (NOT 2).
    // A regression here would produce `_j2` for the third join.
    const insightMiddleSkip: Insight = {
      ...doubleJoinInsight,
      joins: [
        // valid: created_by → id → instance 0
        {
          type: "inner",
          rightTableId: USERS_TABLE_ID,
          leftKey: "created_by",
          rightKey: "id",
        },
        // invalid: bad left key → skipped, counter stays at 1
        {
          type: "inner",
          rightTableId: USERS_TABLE_ID,
          leftKey: "no_such_field",
          rightKey: "id",
        },
        // valid: approved_by → id → must be instance 1 (alias _j1)
        {
          type: "inner",
          rightTableId: USERS_TABLE_ID,
          leftKey: "approved_by",
          rightKey: "id",
        },
      ],
    };
    const sql = buildInsightSQL(
      ordersTable,
      new Map([[USERS_TABLE_ID, usersTable]]),
      insightMiddleSkip,
      { mode: "model" },
    );
    expect(sql).not.toBeNull();
    // Instance 0: canonical aliases present
    expect(sql!).toContain(`AS "${nameAliasJ0}"`);
    expect(sql!).toContain(`AS "${emailAliasJ0}"`);
    // Instance 1: _j1 aliases present (NOT _j2)
    expect(sql!).toContain(`AS "${nameAliasJ1}"`);
    expect(sql!).toContain(`AS "${emailAliasJ1}"`);
    expect(sql!).not.toContain(`_j2`);

    // Mirror for buildInsightAvailableFields
    const fields = buildInsightAvailableFields(
      ordersTable,
      new Map([[USERS_TABLE_ID, usersTable]]),
      insightMiddleSkip,
    );
    expect(fields).not.toBeNull();
    const j1NameId = `${U_NAME_FIELD.id}_j1` as UUID;
    expect(fields!.find((f) => f.id === U_NAME_FIELD.id)).toBeDefined();
    expect(fields!.find((f) => f.id === j1NameId)).toBeDefined();
    expect(fields!.find((f) => f.id.endsWith("_j2"))).toBeUndefined();
  });

  it("buildInsightAvailableFields field IDs match buildInsightSQL column aliases — round-trip", () => {
    // The single-source contract: every alias that buildInsightAvailableFields
    // implies (via fieldIdToColumnAlias) must appear in the SQL that buildInsightSQL emits.
    const sql = buildInsightSQL(
      ordersTable,
      new Map([[USERS_TABLE_ID, usersTable]]),
      doubleJoinInsight,
      { mode: "model" },
    );
    const fields = buildInsightAvailableFields(
      ordersTable,
      new Map([[USERS_TABLE_ID, usersTable]]),
      doubleJoinInsight,
    );
    expect(sql).not.toBeNull();
    expect(fields).not.toBeNull();

    // Every non-base-table field's implied alias must appear in the SQL
    const ordersFieldIds = new Set(ordersTable.fields?.map((f) => f.id) ?? []);
    const joinedFields = fields!.filter(
      (f) => !ordersFieldIds.has(f.id as UUID),
    );
    for (const f of joinedFields) {
      const alias = fieldIdToColumnAlias(f.id);
      expect(sql!).toContain(`AS "${alias}"`);
    }
  });

  it("counters are independent per table — mixed tables (orders→users×2 AND orders→products×1)", () => {
    // Introduce a separate "products" table joined once.
    // The products join must get instance index 0 regardless of the users joins.
    const PRODUCTS_TABLE_ID = "60606060-6060-6060-6060-606060606060" as UUID;
    const PRODUCTS_DF_ID = "70707070-7070-7070-7070-707070707070" as UUID;
    const P_ID_FIELD: Field = {
      id: "11111111-2222-3333-4444-555555555555" as UUID,
      name: "Product ID",
      tableId: PRODUCTS_TABLE_ID,
      columnName: "id",
      type: "string",
    };
    const P_NAME_FIELD: Field = {
      id: "aaaabbbb-cccc-dddd-eeee-ffffffffffff" as UUID,
      name: "Product Name",
      tableId: PRODUCTS_TABLE_ID,
      columnName: "name",
      type: "string",
    };
    const productsTable: DataTable = {
      id: PRODUCTS_TABLE_ID,
      name: "products",
      dataSourceId: "33333333-3333-3333-3333-333333333333" as UUID,
      table: "products.csv",
      fields: [P_ID_FIELD, P_NAME_FIELD],
      metrics: [],
      dataFrameId: PRODUCTS_DF_ID,
      createdAt: 0,
    };
    const ordersFieldsExtended = [
      ...ordersTable.fields!,
      {
        id: "99998888-7777-6666-5555-444433332222" as UUID,
        name: "Product ID Ref",
        tableId: ORDERS_TABLE_ID,
        columnName: "product_id",
        type: "string" as const,
      },
    ];
    const ordersTableExtended: DataTable = {
      ...ordersTable,
      fields: ordersFieldsExtended,
    };
    const mixedJoinInsight: Insight = {
      ...doubleJoinInsight,
      joins: [
        // users join 0 (instance 0)
        {
          type: "inner",
          rightTableId: USERS_TABLE_ID,
          leftKey: "created_by",
          rightKey: "id",
        },
        // products join (independent counter, instance 0)
        {
          type: "inner",
          rightTableId: PRODUCTS_TABLE_ID,
          leftKey: "product_id",
          rightKey: "id",
        },
        // users join 1 (instance 1 for users counter)
        {
          type: "inner",
          rightTableId: USERS_TABLE_ID,
          leftKey: "approved_by",
          rightKey: "id",
        },
      ],
    };
    const productNameAlias = fieldIdToColumnAlias(P_NAME_FIELD.id);

    const sql = buildInsightSQL(
      ordersTableExtended,
      new Map([
        [USERS_TABLE_ID, usersTable],
        [PRODUCTS_TABLE_ID, productsTable],
      ]),
      mixedJoinInsight,
      { mode: "model" },
    );
    expect(sql).not.toBeNull();
    // Users instance 0 (canonical)
    expect(sql!).toContain(`AS "${nameAliasJ0}"`);
    // Products canonical (no suffix — independent counter)
    expect(sql!).toContain(`AS "${productNameAlias}"`);
    expect(sql!).not.toContain(`${productNameAlias}_j`);
    // Users instance 1
    expect(sql!).toContain(`AS "${nameAliasJ1}"`);

    // Mirror for buildInsightAvailableFields
    const fields = buildInsightAvailableFields(
      ordersTableExtended,
      new Map([
        [USERS_TABLE_ID, usersTable],
        [PRODUCTS_TABLE_ID, productsTable],
      ]),
      mixedJoinInsight,
    );
    expect(fields).not.toBeNull();
    expect(fields!.find((f) => f.id === P_NAME_FIELD.id)).toBeDefined();
    expect(
      fields!.find((f) => f.id === (`${P_NAME_FIELD.id}_j1` as UUID)),
    ).toBeUndefined();
  });
});
