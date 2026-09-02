import { describe, expect, it } from "vite-plus/test";

import type { Field, Metric } from "./index";
import {
  mergeReplacementFields,
  retainReplacementMetrics,
} from "./table-replacement";

const field = (id: string, columnName: string): Field => ({
  id,
  tableId: "table",
  name: columnName,
  columnName,
  type: "number",
});

describe("table replacement metadata", () => {
  it("preserves an identity only for an unambiguous source-column match", () => {
    const fields = [field("new-revenue", "revenue")];

    expect(
      mergeReplacementFields(fields, [field("old-revenue", "revenue")]),
    ).toMatchObject([{ id: "old-revenue" }]);
    expect(
      mergeReplacementFields(fields, [
        field("first-revenue", "revenue"),
        field("second-revenue", "revenue"),
      ]),
    ).toMatchObject([{ id: "new-revenue" }]);
    expect(
      mergeReplacementFields(
        [field("new-revenue", "revenue"), field("duplicate", "revenue")],
        [field("old-revenue", "revenue")],
      ),
    ).toMatchObject([{ id: "new-revenue" }, { id: "duplicate" }]);
  });

  it("retains count and metrics backed by columns that still exist", () => {
    const metrics: Metric[] = [
      { id: "count", tableId: "table", name: "Count", aggregation: "count" },
      {
        id: "revenue",
        tableId: "table",
        name: "Revenue",
        columnName: "revenue",
        aggregation: "sum",
      },
      {
        id: "quantity",
        tableId: "table",
        name: "Quantity",
        columnName: "quantity",
        aggregation: "sum",
      },
    ];

    expect(
      retainReplacementMetrics(metrics, [field("field-revenue", "revenue")]),
    ).toMatchObject([{ id: "count" }, { id: "revenue" }]);
  });
});
