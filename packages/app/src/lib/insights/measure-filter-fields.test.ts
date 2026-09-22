import { describe, expect, it } from "vite-plus/test";
import type { InsightMetric } from "@dashframe/types";
import type { CombinedField } from "./compute-combined-fields";
import { measureFilterFields } from "./measure-filter-fields";

const date: CombinedField = {
  id: "order-date",
  tableId: "source",
  sourceTableId: "source",
  name: "Order date",
  displayName: "Order date",
  columnName: "ordered_at",
  type: "date",
};
const country: CombinedField = {
  ...date,
  id: "country",
  name: "Country",
  columnName: "country",
  type: "string",
};
const latest: InsightMetric = {
  id: "latest",
  name: "Latest order",
  sourceTable: "source",
  columnName: "field_order_date",
  aggregation: "max",
};
describe("measure filter value types", () => {
  it("retains date and string types for canonical source aliases", () => {
    const result = measureFilterFields(
      {
        id: "report",
        metrics: [
          latest,
          {
            ...latest,
            id: "first",
            name: "First country",
            columnName: "field_country",
            aggregation: "min",
          },
        ],
      },
      [date, country],
    );
    expect(
      result.map((field) => ({
        name: field.displayName,
        type: field.type,
        column: field.columnName,
      })),
    ).toEqual([
      { name: "Latest order (measure)", type: "date", column: "metric_latest" },
      {
        name: "First country (measure)",
        type: "string",
        column: "metric_first",
      },
    ]);
  });
  it("keeps calculated measures numeric even when their placeholder aggregation is max", () => {
    expect(
      measureFilterFields(
        {
          id: "report",
          metrics: [
            { ...latest, expression: { kind: "constant", value: 0.25 } },
          ],
        },
        [date],
      )[0]?.type,
    ).toBe("number");
  });
});
