import type { Insight, InsightFetchFailed } from "@dashframe/types";
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
    expect(() => applyInsightRuntime(insight, undefined)).toThrow(
      "RUNTIME_FILTER_REQUIRED",
    );
  });

  it("rejects duplicate external keys and dangling filter declarations before use", () => {
    expect(() =>
      applyInsightRuntime(
        {
          ...insight,
          runtimeControls: {
            filters: [
              { key: "x", filterId: "region-filter", label: "X" },
              { key: "x", filterId: "date-filter", label: "X" },
            ],
          },
        },
        undefined,
      ),
    ).toThrow("RUNTIME_FILTER_KEY_DUPLICATE");
    expect(() =>
      applyInsightRuntime(
        {
          ...insight,
          runtimeControls: {
            filters: [{ key: "x", filterId: "missing", label: "X" }],
          },
        },
        undefined,
      ),
    ).toThrow("RUNTIME_FILTER_DECLARATION_INVALID");
    expect(() =>
      applyInsightRuntime(
        {
          ...insight,
          runtimeControls: {
            filters: [
              { key: "one", filterId: "region-filter", label: "Region" },
              { key: "two", filterId: "region-filter", label: "Duplicate" },
            ],
          },
        },
        undefined,
      ),
    ).toThrow("RUNTIME_FILTER_DECLARATION_INVALID");
    expect(() =>
      applyInsightRuntime(
        {
          ...insight,
          filters: [...insight.filters!, { ...insight.filters![0]! }],
          runtimeControls: {
            filters: [{ key: "x", filterId: "region-filter", label: "Region" }],
          },
        },
        undefined,
      ),
    ).toThrow("RUNTIME_FILTER_DECLARATION_INVALID");
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
    ).toEqual([{ field: "field_date", direction: "asc" }]);
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

  it("maps declared metric runtime sorts to their exact result alias", () => {
    const saved = {
      ...insight,
      metrics: [
        {
          id: "revenue-total",
          name: "Revenue",
          sourceTable: "table-1",
          columnName: "revenue",
          aggregation: "sum" as const,
        },
      ],
      runtimeControls: {
        sort: { allowedFieldIds: ["revenue-total"], maxKeys: 1 },
      },
    };
    expect(
      applyInsightRuntime(saved, {
        sort: [{ fieldId: "revenue-total", direction: "desc" }],
      }).sorts,
    ).toEqual([{ field: "metric_revenue_total", direction: "desc" }]);
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
        new Error("RUNTIME_connector token=secret"),
        "FETCH_EXECUTION_FAILED",
      ),
    ).toMatchObject({
      status: "failed",
      code: "FETCH_EXECUTION_FAILED",
      message: "Live data could not be fetched.",
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
    expect(
      toFetchFailure(new Error("SOURCE_SCHEMA_CHANGED"), "FETCH_SOURCE_FAILED"),
    ).toMatchObject({
      status: "failed",
      code: "SOURCE_SCHEMA_CHANGED",
      retryable: false,
    });
    expect(
      toFetchFailure(new Error("TARGET_NOT_READY"), "FETCH_SOURCE_FAILED"),
    ).toMatchObject({
      status: "failed",
      code: "TARGET_NOT_READY",
      retryable: true,
    });
  });

  it("types retained success metadata as explicitly stale", () => {
    const result: InsightFetchFailed = {
      status: "failed",
      code: "SOURCE_SCHEMA_CHANGED",
      message: "safe",
      retryable: false,
      diagnosticId: "diagnostic",
      lastSuccessful: {
        stale: true,
        dataFrameId: "frame",
        schema: [],
        rowCount: 1,
        definitionFingerprint: "fingerprint",
        provenance: { connectorKind: "notion", bindingVersion: "v1" },
        fetchedAt: 1,
      },
    };
    expect(result.lastSuccessful).toMatchObject({
      stale: true,
      dataFrameId: "frame",
    });
  });
});
