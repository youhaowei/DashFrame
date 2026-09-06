import { fieldIdToColumnAlias } from "@dashframe/engine";
import type {
  ChartEncoding,
  Field,
  InsightMetric,
  UUID,
} from "@dashframe/types";
import { describe, expect, it } from "vite-plus/test";
import { mergeFieldsAndMetrics, parseChartEncoding } from "./InsightView";

const TABLE_ID = "10000000-0000-4000-8000-000000000001" as UUID;
const REVENUE_FIELD_ID = "20000000-0000-4000-8000-000000000001" as UUID;
const COST_FIELD_ID = "20000000-0000-4000-8000-000000000002" as UUID;

const fields: Field[] = [
  {
    id: REVENUE_FIELD_ID,
    name: "Revenue",
    tableId: TABLE_ID,
    columnName: "revenue",
    type: "number",
  },
  {
    id: COST_FIELD_ID,
    name: "Cost",
    tableId: TABLE_ID,
    columnName: "cost",
    type: "number",
  },
];

const fieldIdMap = new Map<string, UUID>(
  fields.flatMap((field) => [
    [field.columnName!, field.id],
    [fieldIdToColumnAlias(field.id), field.id],
  ]),
);

const existingRevenueMetric: InsightMetric = {
  id: "30000000-0000-4000-8000-000000000001" as UUID,
  name: "Total Revenue",
  sourceTable: TABLE_ID,
  columnName: "revenue",
  aggregation: "sum",
};

function parseSuggestionMetric(expression: string): InsightMetric {
  const parsed = parseChartEncoding(
    { y: expression } as ChartEncoding,
    (value) => {
      const match = value.match(/^(sum|avg)\(([^)]+)\)$/);
      return match?.[1] && match[2]
        ? {
            aggregation: match[1] as InsightMetric["aggregation"],
            columnName: match[2],
          }
        : null;
    },
    TABLE_ID,
  );
  const metric = parsed.metrics[0];
  if (!metric) throw new Error(`Expected a metric for ${expression}`);
  return metric;
}

function mergeSuggestionMetric(metric: InsightMetric): InsightMetric[] {
  return mergeFieldsAndMetrics(
    [],
    [metric],
    [],
    [existingRevenueMetric],
    fields,
    fieldIdMap,
  ).mergedMetrics;
}

describe("mergeFieldsAndMetrics", () => {
  it("keeps one metric when a suggestion aliases the panel metric's field", () => {
    const suggestionMetric = parseSuggestionMetric(
      `sum(${fieldIdToColumnAlias(REVENUE_FIELD_ID)})`,
    );

    expect(mergeSuggestionMetric(suggestionMetric)).toEqual([
      existingRevenueMetric,
    ]);
  });

  it.each([
    ["a different field", `sum(${fieldIdToColumnAlias(COST_FIELD_ID)})`],
    [
      "a different aggregation",
      `avg(${fieldIdToColumnAlias(REVENUE_FIELD_ID)})`,
    ],
  ])("preserves %s", (_case, expression) => {
    const suggestionMetric = parseSuggestionMetric(expression);

    expect(mergeSuggestionMetric(suggestionMetric)).toEqual([
      existingRevenueMetric,
      suggestionMetric,
    ]);
  });
});
