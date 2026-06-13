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
