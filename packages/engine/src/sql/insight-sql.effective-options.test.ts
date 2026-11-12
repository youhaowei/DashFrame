/**
 * Tests for the `effectiveLimit` and `effectiveSorts` options of
 * `buildInsightSQL`, which replace the insight's own limit and sorts for one
 * query.
 */

import type {
  DataTable,
  Field,
  Insight,
  InsightMetric,
  UUID,
} from "@dashframe/types";
import { describe, expect, it } from "bun:test";

import { buildInsightSQL, fieldIdToColumnAlias } from "./insight-sql";

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
  source: { sourceType: "dataTable", sourceId: TABLE_ID },
  selectedFields: [REGION_FIELD_ID],
  metrics: [REVENUE_METRIC],
  filters: [{ field: "region", operator: "eq", value: "EMEA" }],
  sorts: [{ field: "region", direction: "asc" }],
  createdAt: 0,
};

const regionAlias = fieldIdToColumnAlias(REGION_FIELD_ID);

describe("buildInsightSQL — effectiveLimit and effectiveSorts options", () => {
  it("effectiveLimit overrides insight query limit in the compiled SQL", () => {
    const sql = buildInsightSQL(BASE_TABLE, new Map(), BASE_INSIGHT, {
      mode: "query",
      effectiveLimit: 12,
    });
    expect(sql).not.toBeNull();
    expect(sql).toContain("LIMIT 12");
  });

  it("effectiveSorts produces an ORDER BY clause in the compiled SQL", () => {
    // Sort overrides must actually appear in the SQL — not be silently dropped.
    const insightNoSort: Insight = { ...BASE_INSIGHT, sorts: undefined };
    const sql = buildInsightSQL(BASE_TABLE, new Map(), insightNoSort, {
      mode: "query",
      effectiveSorts: [{ field: "region", direction: "desc" }],
    });
    expect(sql).not.toBeNull();
    expect(sql).toContain(`ORDER BY "${regionAlias}" DESC`);
  });
});
