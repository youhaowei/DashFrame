import type { UUID } from "@dashframe/types";
import { describe, expect, it } from "vite-plus/test";

import { analyzeFrameSample } from "./analyze-frame-sample";

describe("analyzeFrameSample", () => {
  it("derives chart-suggestion metadata from bounded server-frame rows", () => {
    const category = "field_10000000_0000_4000_8000_000000000001" as UUID;
    const amount = "field_10000000_0000_4000_8000_000000000002" as UUID;
    const analysis = analyzeFrameSample(
      [
        { id: category, name: "Category", type: "string" },
        { id: amount, name: "Amount", type: "number" },
      ],
      [
        { [category]: "A", [amount]: 10 },
        { [category]: "B", [amount]: 25 },
      ],
      2,
    );

    expect(analysis).toEqual([
      expect.objectContaining({
        columnName: category,
        dataType: "string",
        semantic: "categorical",
        cardinality: 2,
      }),
      expect.objectContaining({
        columnName: amount,
        dataType: "number",
        semantic: "numerical",
        min: 10,
        max: 25,
      }),
    ]);
  });

  it("estimates nulls from the bounded sample instead of treating unsampled rows as null", () => {
    const field = "field_10000000_0000_4000_8000_000000000001" as UUID;
    const [analysis] = analyzeFrameSample(
      [{ id: field, name: "Category", type: "string" }],
      [{ [field]: "A" }, { [field]: "B" }],
      10_000,
    );

    expect(analysis?.nullCount).toBe(0);
  });
});
