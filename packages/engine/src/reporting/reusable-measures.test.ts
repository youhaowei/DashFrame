import { describe, expect, it } from "bun:test";
import type { InsightMetric } from "@dashframe/types";
import {
  saveReusableMeasure,
  importReusableMeasure,
} from "./reusable-measures";
const measures: InsightMetric[] = [
  { id: "visits", name: "Visits", sourceTable: "source", aggregation: "count" },
  {
    id: "orders",
    name: "Orders",
    sourceTable: "source",
    aggregation: "count",
    filters: [{ field: "converted", operator: "eq", value: true }],
  },
  {
    id: "rate",
    name: "Conversion",
    sourceTable: "source",
    aggregation: "count",
    expression: {
      kind: "binary",
      operator: "divide",
      left: { kind: "measure", measureId: "orders" },
      right: { kind: "measure", measureId: "visits" },
    },
    format: { style: "percent", decimals: 2 },
  },
];
function identities(prefix: string) {
  let index = 0;
  return () => `${prefix}${++index}`;
}
describe("reusable report measures", () => {
  it("round trips a filtered ratio with complete independent dependencies and formatting", () => {
    const library = saveReusableMeasure(
      measures,
      "rate",
      "source",
      identities("saved"),
    );
    const restored = importReusableMeasure(
      JSON.parse(JSON.stringify(library)),
      library[2]!.id,
      "source",
      identities("report"),
    );
    expect(restored.map((measure) => measure.id)).toEqual([
      "report1",
      "report2",
      "report3",
    ]);
    expect(restored[2]!.expression).toEqual({
      kind: "binary",
      operator: "divide",
      left: { kind: "measure", measureId: "report1" },
      right: { kind: "measure", measureId: "report2" },
    });
    expect(restored[2]!.format).toEqual({ style: "percent", decimals: 2 });
    expect(restored[0]!.filters).toEqual(measures[1]!.filters);
    restored[0]!.filters![0]!.value = false;
    expect(library[0]!.filters![0]!.value).toBe(true);
    expect(measures[1]!.filters![0]!.value).toBe(true);
  });
  it("rejects missing, cyclic, cross-source and colliding definitions", () => {
    expect(() =>
      saveReusableMeasure(measures.slice(1), "rate", "source"),
    ).toThrow("Missing measure");
    const cycle: InsightMetric = {
      ...measures[2]!,
      expression: { kind: "measure", measureId: "rate" },
    };
    expect(() => saveReusableMeasure([cycle], "rate", "source")).toThrow(
      "Cyclic",
    );
    expect(() => saveReusableMeasure(measures, "rate", "other")).toThrow(
      "same data source",
    );
    expect(() =>
      saveReusableMeasure(measures, "rate", "source", () => "orders"),
    ).toThrow("unique");
  });
  it("copies a shared dependency once and excludes unrelated measures", () => {
    const repeated: InsightMetric = {
      ...measures[2]!,
      expression: {
        kind: "binary",
        operator: "add",
        left: { kind: "measure", measureId: "orders" },
        right: { kind: "measure", measureId: "orders" },
      },
    };
    const saved = saveReusableMeasure(
      [...measures.slice(0, 2), repeated],
      "rate",
      "source",
      identities("saved"),
    );
    expect(saved.map((measure) => measure.name)).toEqual([
      "Orders",
      "Conversion",
    ]);
    expect(saved[1]!.expression).toEqual({
      kind: "binary",
      operator: "add",
      left: { kind: "measure", measureId: "saved1" },
      right: { kind: "measure", measureId: "saved1" },
    });
  });
});
