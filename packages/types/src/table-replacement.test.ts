import { describe, expect, it } from "vite-plus/test";

import type { Field, Metric } from "./index";
import {
  mergeReplacementFields,
  retainReplacementMetrics,
} from "./table-replacement";

const field = (
  id: string,
  columnName: string,
  type: Field["type"] = "number",
): Field => ({
  id,
  tableId: "table",
  name: columnName,
  columnName,
  type,
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

  it("drops incompatible numeric metrics without dropping compatible metrics", () => {
    const metrics: Metric[] = [
      {
        id: "revenue-sum",
        tableId: "table",
        name: "Revenue",
        columnName: "revenue",
        aggregation: "sum",
      },
      {
        id: "quantity-sum",
        tableId: "table",
        name: "Quantity",
        columnName: "quantity",
        aggregation: "sum",
      },
    ];

    expect(
      retainReplacementMetrics(metrics, [
        field("field-revenue", "revenue", "string"),
        field("field-quantity", "quantity", "number"),
      ]),
    ).toMatchObject([{ id: "quantity-sum" }]);
  });

  it("keeps min and max on every column type while sum and avg stay numeric", () => {
    const metric = (
      id: string,
      columnName: string,
      aggregation: Metric["aggregation"],
    ): Metric => ({ id, tableId: "table", name: id, columnName, aggregation });
    const metrics = [
      metric("date-max", "order_date", "max"),
      metric("date-min", "order_date", "min"),
      metric("date-sum", "order_date", "sum"),
      metric("date-avg", "order_date", "avg"),
      metric("text-max", "customer", "max"),
      metric("text-min", "customer", "min"),
      metric("text-avg", "customer", "avg"),
      metric("text-distinct", "customer", "count_distinct"),
      metric("bool-max", "paid", "max"),
      metric("amount-sum", "amount", "sum"),
      metric("amount-max", "amount", "max"),
      metric("gone-max", "gone", "max"),
    ];

    expect(
      retainReplacementMetrics(metrics, [
        field("field-date", "order_date", "date"),
        field("field-text", "customer", "string"),
        field("field-bool", "paid", "boolean"),
        field("field-amount", "amount", "number"),
      ]).map((retained) => retained.id),
    ).toEqual([
      "date-max",
      "date-min",
      "text-max",
      "text-min",
      "text-distinct",
      "bool-max",
      "amount-sum",
      "amount-max",
    ]);
  });
});
