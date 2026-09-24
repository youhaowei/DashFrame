import { analyzeFrameSample } from "@/lib/visualizations/analyze-frame-sample";
import type { DataTable, Field, Insight, UUID } from "@dashframe/types";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import {
  useChartStarterSample,
  type ChartStarterResult,
} from "./useChartStarterSample";

const TABLE_ID = "40000000-0000-4000-8000-000000000000" as UUID;
const FIELDS = [
  { name: "Category", type: "string" },
  { name: "Sales", type: "number" },
].map((field, index) => ({
  ...field,
  id: `40000000-0000-4000-8000-00000000000${index + 1}` as UUID,
  columnName: field.name,
  tableId: TABLE_ID,
})) as Field[];
const TABLE = {
  id: TABLE_ID,
  name: "sales",
  fields: FIELDS,
  metrics: [],
} as unknown as DataTable;
const INSIGHT = {
  id: "40000000-0000-4000-8000-0000000000aa",
  selectedFields: [],
  metrics: [],
} as unknown as Insight;

const alias = (field: Field) => `field_${field.id.replace(/-/g, "_")}`;
const SCHEMA = FIELDS.map((field) => ({
  id: alias(field),
  name: field.name,
  type: field.type,
}));

function result(
  rows: Record<string, unknown>[],
  isReady = true,
): ChartStarterResult {
  return {
    isReady,
    schema: SCHEMA,
    rows,
    totalCount: rows.length,
    analysis: analyzeFrameSample(SCHEMA, rows, rows.length),
  };
}

const [CATEGORY, SALES] = FIELDS as [Field, Field];
const row = (category: string, sales: number) => ({
  [alias(CATEGORY)]: category,
  [alias(SALES)]: sales,
});

describe("useChartStarterSample", () => {
  it("offers no cards while a source refresh is pending", () => {
    const before = result([row("A", 1), row("B", 2)]);
    const { result: hook, rerender } = renderHook(
      (props: { result: ChartStarterResult }) =>
        useChartStarterSample({
          enabled: true,
          insight: INSIGHT,
          dataTable: TABLE,
          result: props.result,
        }),
      { initialProps: { result: before } },
    );
    expect(hook.current.cards.length).toBeGreaterThan(0);

    // The source changed: the run for the new generation has not landed, so
    // the result still holds the old rows but is no longer ready.
    rerender({ result: { ...before, isReady: false } });
    expect(hook.current.cards).toEqual([]);
    // The preview keeps its rows, and the section stays in place.
    expect(hook.current.sample?.rows).toBe(before.rows);
    expect(hook.current.suggestions.length).toBeGreaterThan(0);

    // The new generation lands: cards come back, built from its rows.
    const after = result([row("C", 3), row("D", 4), row("E", 5)]);
    rerender({ result: after });
    expect(hook.current.sample?.rows).toBe(after.rows);
    expect(hook.current.cards.length).toBeGreaterThan(0);
  });

  it("keeps the pristine rows through a partial pick but offers no cards", () => {
    const before = result([row("A", 1), row("B", 2)]);
    const { result: hook, rerender } = renderHook(
      (props: { insight: Insight; result: ChartStarterResult }) =>
        useChartStarterSample({
          enabled: true,
          insight: props.insight,
          dataTable: TABLE,
          result: props.result,
        }),
      { initialProps: { insight: INSIGHT, result: before } },
    );
    const grouped = result([row("A", 1)]);
    rerender({
      insight: { ...INSIGHT, selectedFields: [CATEGORY.id] } as Insight,
      result: grouped,
    });
    expect(hook.current.sample?.rows).toBe(before.rows);
    expect(hook.current.cards).toEqual([]);
  });
});
