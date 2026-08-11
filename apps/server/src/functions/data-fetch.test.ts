import type { Insight } from "@dashframe/types";
import { describe, expect, it } from "vitest";

import { applyInsightRuntime, toFetchFailure } from "./data-fetch";

const insight: Insight = {
  id: "insight-1",
  name: "Revenue",
  baseTableId: "table-1",
  selectedFields: ["region", "date"],
  metrics: [],
  createdAt: 0,
  filters: [
    { id: "region-filter", field: "region", operator: "eq", value: "US" },
    { id: "date-filter", field: "date", operator: "gte", value: "2026-01-01" },
  ],
  runtimeControls: {
    filters: [
      {
        key: "region",
        filterId: "region-filter",
        label: "Region",
        required: true,
      },
      { key: "from", filterId: "date-filter", label: "From", allowClear: true },
    ],
    sort: { allowedFieldIds: ["date"], maxKeys: 1 },
    limit: { min: 1, max: 100 },
  },
};

describe("applyInsightRuntime", () => {
  it("uses only declared keys while retaining saved field and operator", () => {
    expect(
      applyInsightRuntime(insight, { filters: { region: "CA" } }).filters,
    ).toEqual([
      { id: "region-filter", field: "region", operator: "eq", value: "CA" },
      {
        id: "date-filter",
        field: "date",
        operator: "gte",
        value: "2026-01-01",
      },
    ]);
  });

  it("rejects unknown keys and missing required values", () => {
    expect(() =>
      applyInsightRuntime(insight, { filters: { sql: "select" } }),
    ).toThrow("RUNTIME_FILTER_NOT_DECLARED");
    expect(() => applyInsightRuntime(insight, { filters: {} })).toThrow(
      "RUNTIME_FILTER_REQUIRED",
    );
  });

  it("defaults clear to forbidden and respects explicit clear declarations", () => {
    expect(() =>
      applyInsightRuntime(insight, { filters: { region: null } }),
    ).toThrow("RUNTIME_FILTER_REQUIRED");
    expect(
      applyInsightRuntime(insight, { filters: { region: "US", from: null } })
        .filters,
    ).toEqual([
      { id: "region-filter", field: "region", operator: "eq", value: "US" },
    ]);
  });

  it("validates one-key sort by field allowlist, independently of direction", () => {
    expect(
      applyInsightRuntime(insight, {
        filters: { region: "US" },
        sort: [{ fieldId: "date", direction: "asc" }],
      }).sorts,
    ).toEqual([{ field: "date", direction: "asc" }]);
    expect(() =>
      applyInsightRuntime(insight, {
        filters: { region: "US" },
        sort: [{ fieldId: "region", direction: "desc" }],
      }),
    ).toThrow("RUNTIME_SORT_FIELD_NOT_ALLOWED");
    expect(() =>
      applyInsightRuntime(insight, {
        filters: { region: "US" },
        sort: [
          { fieldId: "date", direction: "asc" },
          { fieldId: "date", direction: "desc" },
        ],
      }),
    ).toThrow("RUNTIME_SORT_MAX_KEYS");
  });

  it("applies only a declared bounded limit", () => {
    expect(
      applyInsightRuntime(insight, { filters: { region: "US" }, limit: 50 })
        .limit,
    ).toBe(50);
    expect(() =>
      applyInsightRuntime(insight, { filters: { region: "US" }, limit: 101 }),
    ).toThrow("RUNTIME_LIMIT_OUT_OF_RANGE");
  });

  it("converts internal failures to safe, row-free failed results", () => {
    expect(
      toFetchFailure(
        new Error("connector password leaked"),
        "FETCH_EXECUTION_FAILED",
      ),
    ).toMatchObject({
      status: "failed",
      code: "FETCH_EXECUTION_FAILED",
      message: "Live data could not be fetched.",
      retryable: true,
    });
    expect(
      toFetchFailure(
        new Error("RUNTIME_LIMIT_OUT_OF_RANGE"),
        "FETCH_SOURCE_FAILED",
      ),
    ).toMatchObject({
      status: "failed",
      code: "RUNTIME_LIMIT_OUT_OF_RANGE",
      retryable: false,
    });
  });
});
