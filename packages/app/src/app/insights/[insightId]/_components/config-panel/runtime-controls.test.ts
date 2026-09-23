import type { InsightFilter, UUID } from "@dashframe/types";
import { describe, expect, it } from "vite-plus/test";
import { pruneRuntimeControls, withoutViewerField } from "./runtime-controls";

describe("pruneRuntimeControls", () => {
  it("removes declarations whose saved targets disappeared", () => {
    const filters = [
      { id: "kept", field: "region", operator: "eq", value: "US" },
    ] as InsightFilter[];
    expect(
      pruneRuntimeControls(
        {
          filters: [
            { key: "region", filterId: "kept", label: "Region" },
            { key: "gone", filterId: "gone", label: "Gone" },
          ],
          sort: {
            allowedFieldIds: ["field-a", "field-gone"] as UUID[],
            maxKeys: 1,
          },
          limit: { min: 1, max: 100 },
        },
        filters,
        ["field-a" as UUID],
      ),
    ).toEqual({
      filters: [{ key: "region", filterId: "kept", label: "Region" }],
      sort: { allowedFieldIds: ["field-a"], maxKeys: 1 },
      limit: { min: 1, max: 100 },
    });
  });
});

it("keeps unselected dimension choices and surviving measures after removing a filter", () => {
  const declaration = {
    filters: [{ key: "region", filterId: "removed", label: "Region" }],
    dimensions: { allowedIds: ["month", "channel", "country"], maxSelected: 2 },
    measures: { allowedIds: ["revenue", "orders", "rate"], maxSelected: 3 },
  };
  const pruned = pruneRuntimeControls(
    declaration,
    [],
    ["month", "channel", "revenue", "rate"],
  );
  expect(pruned?.filters).toBeUndefined();
  expect(pruned?.dimensions).toEqual(declaration.dimensions);
  expect(pruned?.measures).toEqual({
    allowedIds: ["revenue", "rate"],
    maxSelected: 3,
  });
  expect(declaration.measures.allowedIds).toEqual([
    "revenue",
    "orders",
    "rate",
  ]);
});

it("retains a dimension-only declaration and removes empty measure choices", () => {
  expect(
    pruneRuntimeControls(
      {
        dimensions: { allowedIds: ["country"], maxSelected: 1 },
        measures: { allowedIds: ["removed"], maxSelected: 1 },
      },
      [],
      [],
    ),
  ).toEqual({ dimensions: { allowedIds: ["country"], maxSelected: 1 } });
  expect(
    pruneRuntimeControls(
      { measures: { allowedIds: ["removed"], maxSelected: 1 } },
      [],
      [],
    ),
  ).toBeUndefined();
});

describe("withoutViewerField", () => {
  it("stops offering a removed field to viewers", () => {
    expect(
      withoutViewerField(
        { dimensions: { allowedIds: ["region", "date"], maxSelected: 2 } },
        "region" as UUID,
      ),
    ).toEqual({ dimensions: { allowedIds: ["date"], maxSelected: 1 } });
    expect(
      withoutViewerField(
        { dimensions: { allowedIds: ["region"], maxSelected: 1 } },
        "region" as UUID,
      ),
    ).toBeUndefined();
  });
});
