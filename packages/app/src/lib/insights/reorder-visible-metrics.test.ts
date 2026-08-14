import type { InsightMetric } from "@dashframe/types";
import { describe, expect, it } from "vite-plus/test";

import { reorderVisibleMetrics } from "./reorder-visible-metrics";

const metric = (id: string, name = id): InsightMetric => ({
  id,
  name,
  aggregation: "sum",
  sourceTable: "table",
  columnName: `${id}_field`,
});

describe("reorderVisibleMetrics", () => {
  it("preserves hidden metrics in place while reordering visible metrics", () => {
    const internal = metric("internal", "_internal");
    const revenue = metric("revenue", "Revenue");
    const cost = metric("cost", "Cost");

    expect(
      reorderVisibleMetrics([internal, revenue, cost], [cost, revenue]),
    ).toEqual([internal, cost, revenue]);
  });

  it("does not delete visible metrics when the requested projection is incomplete", () => {
    const revenue = metric("revenue", "Revenue");
    const cost = metric("cost", "Cost");

    expect(reorderVisibleMetrics([revenue, cost], [cost])).toEqual([
      cost,
      revenue,
    ]);
  });
});
