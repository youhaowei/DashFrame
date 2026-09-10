import { buildInsightSQL, fieldIdToColumnAlias } from "@dashframe/engine";
import type { DataTable, Insight, UUID } from "@dashframe/types";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { arrowIpcToJsonRows } from "./arrow-data-path";
import { NativeDuckDBEngine } from "./native-engine";

describe("Insight SQL filters against real DuckDB", () => {
  let engine: NativeDuckDBEngine | null = null;

  afterEach(async () => {
    await engine?.dispose();
    engine = null;
  });

  it("applies a canonical field alias filter to selective source data", async () => {
    const tableId = "11111111-1111-1111-1111-111111111111" as UUID;
    const dataFrameId = "22222222-2222-2222-2222-222222222222" as UUID;
    const regionId = "33333333-3333-3333-3333-333333333333" as UUID;
    const table: DataTable = {
      id: tableId,
      name: "orders",
      dataSourceId: "44444444-4444-4444-4444-444444444444" as UUID,
      table: "orders",
      dataFrameId,
      fields: [
        {
          id: regionId,
          name: "Region",
          tableId,
          columnName: "region",
          type: "string",
        },
      ],
      metrics: [],
      createdAt: 0,
    };
    const insight: Insight = {
      id: "55555555-5555-5555-5555-555555555555" as UUID,
      name: "EMEA orders",
      source: { sourceType: "dataTable", sourceId: tableId },
      selectedFields: [],
      metrics: [],
      filters: [
        {
          field: fieldIdToColumnAlias(regionId),
          operator: "eq",
          value: "EMEA",
        },
      ],
      createdAt: 0,
    };
    const sql = buildInsightSQL(table, new Map(), insight, { mode: "query" });
    expect(sql).toContain(`WHERE "region" = 'EMEA'`);

    engine = new NativeDuckDBEngine();
    await engine.initialize();
    await engine.queryArrow(`
      CREATE TABLE df_22222222_2222_2222_2222_222222222222 AS
      SELECT * FROM (VALUES ('EMEA'), ('APAC'), ('EMEA')) AS rows(region)
    `);
    const result = arrowIpcToJsonRows(await engine.queryArrow(sql!));

    expect(result).toHaveLength(2);
    expect(result.map((row) => row[fieldIdToColumnAlias(regionId)])).toEqual([
      "EMEA",
      "EMEA",
    ]);
  });
});
