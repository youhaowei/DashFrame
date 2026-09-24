/**
 * Suggested charts for an empty chart — the three first-slice rules:
 *
 * - date + number → line over time
 * - text with at most 12 values → row-count bar
 * - text + number → bar sorted by value
 *
 * One card per rule first (in rule order), then the rest, capped at four;
 * candidates in column order; identifier columns never suggested; no
 * suggestions (the plain table) for an empty or very wide table.
 */
import type { Field, UUID } from "@dashframe/types";
import { describe, expect, it } from "vite-plus/test";

import { analyzeFrameSample } from "./analyze-frame-sample";
import {
  MAX_CHART_STARTER_COLUMNS,
  suggestChartStarters,
} from "./chart-starter";

const TABLE_ID = "00000000-0000-4000-8000-000000000000" as UUID;

type ColumnSpec = { name: string; type: "string" | "number" | "date" };

function table(columns: ColumnSpec[], rows: unknown[][]) {
  const fields: Field[] = columns.map((column, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` as UUID,
    name: column.name,
    columnName: column.name,
    tableId: TABLE_ID,
    type: column.type,
  }));
  const schema = fields.map((field) => ({
    // The server names result columns by their field alias.
    id: `field_${field.id.replace(/-/g, "_")}` as UUID,
    name: field.name,
    type: field.type,
  }));
  const records = rows.map((row) =>
    Object.fromEntries(schema.map((column, index) => [column.id, row[index]])),
  );
  const analysis = analyzeFrameSample(schema, records, rows.length);
  return {
    fields,
    suggest: (rowCount = rows.length) =>
      suggestChartStarters(fields, analysis, rowCount).map(
        (suggestion) =>
          `${suggestion.chartType} ${suggestion.aggregation}(${suggestion.measure?.name ?? ""}) by ${suggestion.group.name}`,
      ),
  };
}

const SALES = table(
  [
    { name: "Date", type: "date" },
    { name: "Product", type: "string" },
    { name: "Category", type: "string" },
    { name: "Sales", type: "number" },
    { name: "Quantity", type: "number" },
  ],
  [
    ["2023-01-01", "Laptop", "Electronics", 1200, 5],
    ["2023-01-02", "Mouse", "Electronics", 25, 10],
    ["2023-01-03", "Chair", "Furniture", 150, 4],
    ["2023-01-04", "Desk", "Furniture", 300, 2],
    ["2023-01-05", "Laptop", "Electronics", 1200, 3],
  ],
);

describe("suggestChartStarters", () => {
  it("offers one card per rule in rule order, then fills to four", () => {
    expect(SALES.suggest()).toEqual([
      "line sum(Sales) by Date",
      "barY count() by Product",
      // The first pass prefers a grouping no earlier card uses.
      "barX sum(Sales) by Category",
      "line sum(Quantity) by Date",
    ]);
  });

  it("gives a text + number pair a count and a sorted bar", () => {
    const sorted = table(
      [
        { name: "Region", type: "string" },
        { name: "Revenue", type: "number" },
      ],
      [
        ["North", 3],
        ["South", 5],
      ],
    );
    expect(sorted.suggest()).toEqual([
      "barY count() by Region",
      "barX sum(Revenue) by Region",
    ]);
  });

  it("applies each rule on its own", () => {
    const dateNumber = table(
      [
        { name: "Day", type: "date" },
        { name: "Visits", type: "number" },
      ],
      [
        ["2024-01-01", 3],
        ["2024-01-02", 4],
      ],
    );
    expect(dateNumber.suggest()).toEqual(["line sum(Visits) by Day"]);

    const textOnly = table(
      [{ name: "Status", type: "string" }],
      [["open"], ["closed"], ["open"]],
    );
    expect(textOnly.suggest()).toEqual(["barY count() by Status"]);
  });

  it("draws a line only over at least two dates", () => {
    const oneDate = table(
      [
        { name: "Date", type: "date" },
        { name: "Sales", type: "number" },
      ],
      [
        ["2023-01-01", 5],
        ["2023-01-01", 7],
        [null, 9],
      ],
    );
    expect(oneDate.suggest().some((card) => card.startsWith("line"))).toBe(
      false,
    );
    const twoDates = table(
      [
        { name: "Date", type: "date" },
        { name: "Sales", type: "number" },
      ],
      [
        ["2023-01-01", 5],
        ["2023-01-02", 7],
      ],
    );
    expect(twoDates.suggest()).toContain("line sum(Sales) by Date");
  });

  it("counts rows only for text with at most 12 values", () => {
    const values = (count: number) =>
      Array.from({ length: count }, (_, index) => [`v${index}`, index + 1]);
    const columns: ColumnSpec[] = [
      { name: "Label", type: "string" },
      { name: "Amount", type: "number" },
    ];
    expect(table(columns, values(12)).suggest()).toContain(
      "barY count() by Label",
    );
    expect(table(columns, values(13)).suggest()).toEqual([
      "barX sum(Amount) by Label",
    ]);
  });

  it("caps the cards at four", () => {
    const wide = table(
      [
        { name: "When", type: "date" },
        { name: "A", type: "number" },
        { name: "B", type: "number" },
        { name: "C", type: "number" },
        { name: "D", type: "number" },
        { name: "E", type: "number" },
      ],
      [
        ["2024-01-01", 1, 2, 3, 4, 5],
        ["2024-01-02", 2, 3, 4, 5, 6],
      ],
    );
    expect(wide.suggest()).toEqual([
      "line sum(A) by When",
      "line sum(B) by When",
      "line sum(C) by When",
      "line sum(D) by When",
    ]);
  });

  it("breaks ties by column order", () => {
    const columns: ColumnSpec[] = [
      { name: "Region", type: "string" },
      { name: "Channel", type: "string" },
      { name: "Revenue", type: "number" },
    ];
    const rows = [
      ["North", "Web", 1],
      ["South", "Store", 2],
    ];
    expect(table(columns, rows).suggest()[0]).toBe("barY count() by Region");
    const swapped = table(
      [columns[1]!, columns[0]!, columns[2]!],
      rows.map(([region, channel, revenue]) => [channel, region, revenue]),
    );
    expect(swapped.suggest()[0]).toBe("barY count() by Channel");
  });

  it("never suggests an identifier column", () => {
    const withIds = table(
      [
        { name: "order_id", type: "number" },
        { name: "customer_id", type: "string" },
        { name: "Region", type: "string" },
        { name: "Amount", type: "number" },
      ],
      [
        [1, "c1", "North", 10],
        [2, "c2", "South", 20],
      ],
    );
    const suggestions = withIds.suggest();
    expect(suggestions.join(" ")).not.toMatch(/_id/);
    expect(suggestions).toEqual([
      "barY count() by Region",
      "barX sum(Amount) by Region",
    ]);
  });

  it("falls back to the plain table for an empty or very wide table", () => {
    expect(SALES.suggest(0)).toEqual([]);
    const columns = Array.from(
      { length: MAX_CHART_STARTER_COLUMNS + 1 },
      (_, index): ColumnSpec => ({
        name: `Column ${index}`,
        type: index === 0 ? "string" : "number",
      }),
    );
    const row = columns.map((_, index) => (index === 0 ? "a" : index));
    expect(table(columns, [row]).suggest()).toEqual([]);
  });
});
