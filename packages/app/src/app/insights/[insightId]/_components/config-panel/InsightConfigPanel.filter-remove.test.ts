import type { Insight, UUID } from "@dashframe/types";
import { describe, expect, it, vi } from "vite-plus/test";
import { removeFilterThroughCommands } from "./InsightConfigPanel";

describe("InsightConfigPanel filter removal mutation", () => {
  it("commits filter deletion and runtime-control pruning as one command batch", async () => {
    const insight = {
      id: "10000000-0000-4000-8000-000000000001" as UUID,
      name: "Revenue",
      baseTableId: "10000000-0000-4000-8000-000000000002" as UUID,
      selectedFields: ["10000000-0000-4000-8000-000000000003" as UUID],
      metrics: [],
      filters: [
        { id: "region", field: "region", operator: "eq", value: "EMEA" },
        {
          id: "period",
          field: "month",
          operator: "between",
          value: { low: 1, high: 6 },
        },
      ],
      runtimeControls: {
        filters: [
          { key: "region", filterId: "region", label: "Region" },
          { key: "period", filterId: "period", label: "Period" },
        ],
        limit: { min: 1, max: 100 },
      },
      createdAt: 0,
    } satisfies Insight;
    const commitBatch = vi.fn(async (_input: { commands: unknown[] }) => ({}));

    await removeFilterThroughCommands(
      commitBatch,
      insight,
      "region",
      insight.selectedFields,
    );

    expect(commitBatch).toHaveBeenCalledOnce();
    expect(commitBatch).toHaveBeenCalledWith({
      commands: [
        {
          path: "setInsightFilter",
          args: {
            id: insight.id,
            filters: [
              {
                id: "period",
                field: "month",
                operator: "between",
                value: { low: 1, high: 6 },
              },
            ],
          },
        },
        {
          path: "setInsightRuntimeControls",
          args: {
            id: insight.id,
            runtimeControls: {
              filters: [{ key: "period", filterId: "period", label: "Period" }],
              limit: { min: 1, max: 100 },
            },
          },
        },
      ],
    });
  });
});
