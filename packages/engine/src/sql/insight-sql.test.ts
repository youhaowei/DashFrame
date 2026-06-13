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
  buildInsightSQL,
  fieldIdToColumnAlias,
  metricIdToColumnAlias,
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
