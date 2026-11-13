import { describe, expect, it } from "vite-plus/test";

import type { Field, Metric } from "./index";
import {
  mergeReplacementFields,
  reconcileReplacementSensitivity,
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

  it("decides replacement sensitivity from the stored fields at commit", () => {
    const marker = {
      sensitivity: "sensitive" as const,
      sensitivityReason: "Marked sensitive by you",
      sensitivitySource: "user" as const,
    };
    const reset = {
      sensitivity: "unclassified" as const,
      sensitivityReason: "Reset to unclassified by you",
      sensitivitySource: "user" as const,
    };
    const stored = [
      { ...field("customer", "customer", "string"), ...marker },
      { ...field("email", "email", "string"), ...marker },
      {
        ...field("region", "region", "string"),
        sensitivity: "cleared" as const,
      },
      { ...field("note", "note", "string"), ...reset },
      field("phone", "phone", "string"),
    ];
    const replacement = [
      // Matched by id: the stored marker is carried over.
      field("customer", "customer", "string"),
      // A fresh id (a connector's reviewed field) is not a stored field.
      {
        ...field("fresh-email", "email", "string"),
        sensitivity: "cleared" as const,
      },
      // The snapshot said sensitive; the user cleared it meanwhile. New data
      // resets a clearance, as the merge does.
      { ...field("region", "region", "string"), ...marker },
      // The snapshot said sensitive; the stored reset and its reason win.
      { ...field("note", "note", "string"), ...marker },
      // The snapshot said sensitive; the stored field was never classified.
      { ...field("phone", "phone", "string"), ...marker },
      // No stored counterpart: untouched.
      field("added", "added", "number"),
    ];

    expect(reconcileReplacementSensitivity(replacement, stored)).toEqual([
      { ...replacement[0], ...marker },
      replacement[1],
      {
        ...replacement[2],
        sensitivity: "unclassified",
        sensitivityReason: undefined,
        sensitivitySource: undefined,
      },
      { ...replacement[3], ...reset },
      {
        ...replacement[4],
        sensitivity: undefined,
        sensitivityReason: undefined,
        sensitivitySource: undefined,
      },
      replacement[5],
    ]);
    expect(reconcileReplacementSensitivity(replacement, [])).toEqual(
      replacement,
    );
  });
});
