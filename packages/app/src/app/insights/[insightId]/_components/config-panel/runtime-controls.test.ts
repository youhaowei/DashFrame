import type { InsightFilter, UUID } from "@dashframe/types";
import { describe, expect, it } from "vite-plus/test";
import { pruneRuntimeControls } from "./runtime-controls";

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
