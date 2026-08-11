/**
 * `encoding` is stored as opaque jsonb, so a row written before the write gate
 * existed can hold any shape at a channel. Both readers below have a deliberate
 * legacy fallback that treats an unparseable value as a raw column name — for a
 * non-string that would forward the value itself into SQL construction, so both
 * must screen the type instead.
 */

import { describe, expect, it } from "bun:test";

import {
  resolveEncodingToResultFrame,
  resolveForAnalysis,
  resolveToSql,
} from "./encoding-resolution";
import { buildInsightSQL } from "./insight-sql";

const CONTEXT = { fields: [], metrics: [] } as never;

// The exact payload from GH #289, plus the other non-string shapes jsonb allows.
const MALFORMED = [{ field: "region" }, 42, true, ["field:a"], null] as never[];

describe("encoding resolution — malformed stored values", () => {
  it("resolveToSql returns undefined rather than emitting the value as SQL", () => {
    for (const bad of MALFORMED) {
      expect(resolveToSql(bad, CONTEXT)).toBeUndefined();
    }
  });

  it("resolveForAnalysis reports invalid rather than naming a column", () => {
    for (const bad of MALFORMED) {
      const resolved = resolveForAnalysis(bad, CONTEXT);
      expect(resolved.valid).toBe(false);
      expect(resolved.columnName).toBeUndefined();
    }
  });

  it("still passes a legacy raw column name through", () => {
    // The fallback exists for saved visualizations that stored bare column
    // names; screening the type must not close it.
    expect(resolveToSql("sum(revenue)", CONTEXT)).toBe("sum(revenue)");
    expect(resolveForAnalysis("sum(revenue)", CONTEXT)).toEqual({
      columnName: "sum(revenue)",
      isMetric: false,
      valid: true,
    });
  });
});

describe("encoding resolution — materialized Insight results", () => {
  it("references computed metric aliases without aggregating source columns again", () => {
    const context = {
      fields: [{ id: "category-id", name: "Category", columnName: "category" }],
      metrics: [
        {
          id: "revenue-id",
          name: "Revenue",
          columnName: "revenue",
          aggregation: "sum",
        },
      ],
    } as never;

    const resolved = resolveEncodingToResultFrame(
      { x: "field:category-id", y: "metric:revenue-id" },
      context,
    );

    expect(resolved).toEqual({
      x: "field_category_id",
      y: "metric_revenue_id",
      color: undefined,
      size: undefined,
    });
    expect(resolved.y).not.toBe("sum(revenue)");
  });

  it("rejects a metric missing from the materialized result definition", () => {
    expect(
      resolveEncodingToResultFrame(
        { y: "metric:missing" },
        { fields: [], metrics: [] },
      ).y,
    ).toBeUndefined();
  });

  it("rejects legacy raw SQL rather than forwarding it to Mosaic", () => {
    expect(
      resolveEncodingToResultFrame(
        { y: "sum(revenue)" },
        { fields: [], metrics: [] },
      ).y,
    ).toBeUndefined();
  });

  it("targets the exact metric alias emitted by Insight materialization", () => {
    const field = {
      id: "revenue-id",
      name: "Revenue",
      columnName: "revenue",
      type: "number",
    };
    const metric = {
      id: "total-revenue-id",
      name: "Total revenue",
      columnName: "revenue",
      aggregation: "sum",
    };
    const insight = {
      id: "insight-id",
      name: "Revenue insight",
      baseTableId: "table-id",
      selectedFields: [],
      metrics: [metric],
      filters: [],
      sorts: [],
      joins: [],
      createdAt: 0,
    };
    const sql = buildInsightSQL(
      {
        id: "table-id",
        name: "Orders",
        dataFrameId: "frame-id",
        fields: [field],
      } as never,
      new Map(),
      insight as never,
      { mode: "query" },
    );
    const resolved = resolveEncodingToResultFrame(
      { y: "metric:total-revenue-id" },
      { fields: [field], metrics: [metric] } as never,
    );

    expect(sql).toContain('AS "metric_total_revenue_id"');
    expect(resolved.y).toBe("metric_total_revenue_id");
  });

  it("rolls composable result metrics up to a coarser transformed date grain", () => {
    const context = {
      fields: [{ id: "date-id", name: "Date", type: "date" }],
      metrics: [
        {
          id: "revenue-id",
          name: "Revenue",
          sourceTable: "table-id",
          columnName: "revenue",
          aggregation: "sum",
        },
      ],
    } as never;

    expect(
      resolveEncodingToResultFrame(
        {
          x: "field:date-id",
          y: "metric:revenue-id",
          xTransform: {
            type: "date",
            transform: { kind: "temporal", aggregation: "yearMonth" },
          },
        },
        context,
      ),
    ).toMatchObject({
      x: `date_trunc('month', "field_date_id")`,
      y: "sum(metric_revenue_id)",
    });
  });

  it("fails closed when a transformed grain cannot faithfully recombine a metric", () => {
    const encoding = {
      x: "field:date-id",
      y: "metric:value-id",
      xTransform: {
        type: "date" as const,
        transform: {
          kind: "temporal" as const,
          aggregation: "yearMonth" as const,
        },
      },
    };
    const contextFor = (aggregation: "avg" | "count_distinct") =>
      ({
        fields: [{ id: "date-id", name: "Date", type: "date" }],
        metrics: [
          {
            id: "value-id",
            name: "Value",
            sourceTable: "table-id",
            columnName: "value",
            aggregation,
          },
        ],
      }) as never;

    expect(
      resolveEncodingToResultFrame(encoding, contextFor("avg")).y,
    ).toBeUndefined();
    expect(
      resolveEncodingToResultFrame(encoding, contextFor("count_distinct")).y,
    ).toBeUndefined();
  });
});
