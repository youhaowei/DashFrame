import { describe, expect, it } from "vitest";

import { buildJoinPreviewInsight } from "./DataPreviewSection";

describe("buildJoinPreviewInsight", () => {
  it("keeps persisted topology but removes result transformations", () => {
    const insight = {
      id: "insight-1",
      name: "Configured",
      baseTableId: "table-1",
      selectedFields: ["field-1"],
      metrics: [{ id: "metric-1" }],
      filters: [{ id: "filter-1" }],
      sorts: [{ field: "created_at", direction: "desc" }],
      joins: [{ rightTableId: "table-2" }],
      createdAt: 1,
    } as never;

    expect(buildJoinPreviewInsight(insight)).toMatchObject({
      baseTableId: "table-1",
      selectedFields: [],
      metrics: [],
      filters: undefined,
      sorts: undefined,
      joins: [{ rightTableId: "table-2" }],
    });
  });
});
