import type { InsightFetchDefinition } from "@dashframe/types";
import { describe, expect, it } from "vitest";

import { applyInsightRuntime } from "./data-fetch";

const insight: InsightFetchDefinition = {
  baseTableId: "table-1",
  selectedFields: ["field-1"],
  metrics: [],
  filters: [
    { id: "region", field: "region", operator: "eq", value: "US" },
    {
      id: "date",
      field: "date",
      operator: "gte",
      value: "2026-01-01",
      allowClear: true,
    },
  ],
  sorts: [{ field: "date", direction: "desc" }],
};

describe("applyInsightRuntime", () => {
  it("only substitutes values for declared saved filter slots", () => {
    expect(
      applyInsightRuntime(insight, { filterValues: { region: "CA" } }),
    ).toMatchObject({
      filters: [
        { id: "region", value: "CA" },
        { id: "date", value: "2026-01-01" },
      ],
    });
  });

  it("rejects an undeclared filter edit before execution", () => {
    expect(() =>
      applyInsightRuntime(insight, { filterValues: { providerQuery: "SQL" } }),
    ).toThrow("RUNTIME_FILTER_NOT_DECLARED");
  });

  it("defaults clearing to forbidden and only clears opt-in filters", () => {
    expect(() =>
      applyInsightRuntime(insight, { clearFilterIds: ["region"] }),
    ).toThrow("RUNTIME_FILTER_CLEAR_NOT_ALLOWED");
    expect(
      applyInsightRuntime(insight, { clearFilterIds: ["date"] }).filters,
    ).toEqual([{ id: "region", field: "region", operator: "eq", value: "US" }]);
  });

  it("accepts one declared sort and rejects arbitrary sort keys", () => {
    expect(
      applyInsightRuntime(insight, {
        sort: { field: "date", direction: "desc" },
      }).sorts,
    ).toEqual([{ field: "date", direction: "desc" }]);
    expect(() =>
      applyInsightRuntime(insight, {
        sort: { field: "secret", direction: "asc" },
      }),
    ).toThrow("RUNTIME_SORT_NOT_DECLARED");
  });
});
