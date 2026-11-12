import {
  getMetricDisplayLabel,
  isGeneratedColumnLabel,
} from "@dashframe/engine";
import type { Field, InsightMetric } from "@dashframe/types";
import { describe, expect, test } from "vite-plus/test";

const field = (id: string, name: string, columnName: string): Field =>
  ({ id, name, columnName, type: "string" }) as unknown as Field;

const metric = (
  aggregation: InsightMetric["aggregation"],
  columnName: string | undefined,
  name = "",
): InsightMetric =>
  ({ id: "m1", aggregation, columnName, name }) as unknown as InsightMetric;

describe("getMetricDisplayLabel", () => {
  test("count without column returns metric name or 'Count of rows'", () => {
    expect(
      getMetricDisplayLabel(metric("count", undefined, "Total rows")),
    ).toBe("Total rows");
    expect(getMetricDisplayLabel(metric("count", undefined, ""))).toBe(
      "Count of rows",
    );
  });

  test("resolves source label via field.columnName match", () => {
    const fields = [field("f1", "Revenue", "revenue_usd")];
    expect(getMetricDisplayLabel(metric("sum", "revenue_usd"), fields)).toBe(
      "Sum of Revenue",
    );
  });

  test("names the source column from the source table, not from a result frame", () => {
    // A result frame's fields carry their alias as the column, and only the
    // fields the chart draws, so they cannot name a metric's source column.
    const resultFields = [field("f2", "Region", "field_f2")];
    const revenue = metric("sum", "revenue_usd");
    expect(getMetricDisplayLabel(revenue, resultFields)).toBe(
      "Sum of revenue_usd",
    );
    expect(
      getMetricDisplayLabel(revenue, [
        field("f1", "Revenue", "revenue_usd"),
        ...resultFields,
      ]),
    ).toBe("Sum of Revenue");
  });

  test("names the column of the table the metric reads when joined tables share it", () => {
    const tableField = (tableId: string, name: string): Field =>
      ({ ...field(tableId, name, "amount"), tableId }) as Field;
    const fields = [
      tableField("orders", "Order amount"),
      tableField("refunds", "Refund amount"),
    ];
    const refunds = {
      ...metric("sum", "amount"),
      sourceTable: "refunds",
    } as InsightMetric;
    expect(getMetricDisplayLabel(refunds, fields)).toBe("Sum of Refund amount");
    // A field list that leaves the metric's table out still names the column.
    expect(getMetricDisplayLabel(refunds, fields.slice(0, 1))).toBe(
      "Sum of Order amount",
    );
  });

  test("resolves source label via field.name match (raw column passthrough)", () => {
    const fields = [field("f1", "Revenue", "revenue_usd")];
    expect(getMetricDisplayLabel(metric("avg", "Revenue"), fields)).toBe(
      "Average of Revenue",
    );
  });

  test("resolves source label via generated SQL alias", () => {
    // fieldIdToColumnAlias turns "abc-123" into "field_abc_123"
    const fields = [field("abc-123", "Revenue", "revenue_usd")];
    expect(getMetricDisplayLabel(metric("sum", "field_abc_123"), fields)).toBe(
      "Sum of Revenue",
    );
  });

  test("prefers an instance-aware display name over the canonical field", () => {
    const fields = [field("abc-123", "Revenue", "revenue_usd")];
    expect(
      getMetricDisplayLabel(metric("sum", "field_abc_123_j1"), fields, {
        field_abc_123_j1: "Revenue (approved_by)",
      }),
    ).toBe("Sum of Revenue (approved_by)");
  });

  test("falls back to aggregation-only when column resolves to a generated alias and no field matches", () => {
    // Generated aliases may be canonical or repeat-join instance-qualified.
    expect(getMetricDisplayLabel(metric("sum", "field_deadbeef"), [])).toBe(
      "Sum",
    );
    expect(getMetricDisplayLabel(metric("sum", "field_deadbeef_j1"), [])).toBe(
      "Sum",
    );
  });

  test("returns metric.name when sourceLabel itself looks like a metric alias", () => {
    expect(
      getMetricDisplayLabel(
        metric("max", "metric_cafe_42", "Peak Revenue"),
        [],
      ),
    ).toBe("Peak Revenue");
  });

  test("falls back to aggregation when no columnName provided (non-count)", () => {
    expect(getMetricDisplayLabel(metric("sum", undefined), [])).toBe("Sum");
  });
});

describe("isGeneratedColumnLabel", () => {
  test("matches field_<hex> and metric_<hex> aliases (case-insensitive)", () => {
    expect(isGeneratedColumnLabel("field_abc_123")).toBe(true);
    expect(isGeneratedColumnLabel("metric_def_456")).toBe(true);
    expect(isGeneratedColumnLabel("FIELD_ABC_123")).toBe(true);
    expect(isGeneratedColumnLabel("field_abc_123_j1")).toBe(true);
    expect(isGeneratedColumnLabel("metric_def_456_j2")).toBe(true);
  });

  test("does not match user-visible labels (even if they share the prefix)", () => {
    // Real user column literally named 'field_count' — should be treated as user-visible
    expect(isGeneratedColumnLabel("field_count")).toBe(false);
    expect(isGeneratedColumnLabel("Revenue")).toBe(false);
    expect(isGeneratedColumnLabel("")).toBe(false);
    expect(isGeneratedColumnLabel(undefined)).toBe(false);
  });
});
