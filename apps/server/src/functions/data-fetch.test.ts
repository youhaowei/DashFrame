import type { Insight, InsightFetchFailed } from "@dashframe/types";
import { describe, expect, it } from "vitest";

import { applyInsightRuntime, toFetchFailure } from "./data-fetch";
import { PublishedSourceMaterializationError } from "./data-fetch/published-source-error";

const insight: Insight = {
  id: "insight-1",
  name: "Revenue",
  source: { sourceType: "dataTable", sourceId: "table-1" },
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
              {
                key: "region",
                filterId: "region-filter",
                label: "Region",
                required: true,
                allowClear: true,
              },
            ],
          },
        },
        { filters: { region: null } },
      ),
    ).toThrow("RUNTIME_FILTER_DECLARATION_INVALID");
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

  it("validates runtime values against saved scalar, in, and between operands", () => {
    const saved: Insight = {
      ...insight,
      filters: [
        { id: "scalar", field: "count", operator: "gte", value: 1 },
        { id: "members", field: "region", operator: "in", value: ["US"] },
        {
          id: "range",
          field: "amount",
          operator: "between",
          value: { low: 1, high: 10 },
        },
      ],
      runtimeControls: {
        filters: [
          { key: "scalar", filterId: "scalar", label: "Count" },
          { key: "members", filterId: "members", label: "Regions" },
          { key: "range", filterId: "range", label: "Amount" },
        ],
      },
    };

    expect(
      applyInsightRuntime(saved, {
        filters: {
          scalar: 2,
          members: ["US", "CA"],
          range: { low: 2, high: 9 },
        },
      }).filters,
    ).toEqual([
      { id: "scalar", field: "count", operator: "gte", value: 2 },
      {
        id: "members",
        field: "region",
        operator: "in",
        value: ["US", "CA"],
      },
      {
        id: "range",
        field: "amount",
        operator: "between",
        value: { low: 2, high: 9 },
      },
    ]);

    for (const filters of [
      { scalar: "2" },
      { members: "US" },
      { members: [1] },
      { range: 5 },
      { range: { low: "2", high: 9 } },
      { range: { low: 2, high: 9, extra: true } },
    ]) {
      expect(() => applyInsightRuntime(saved, { filters })).toThrow(
        "RUNTIME_FILTER_VALUE_INVALID",
      );
    }

    const emptySavedIn: Insight = {
      ...saved,
      filters: [{ id: "members", field: "region", operator: "in", value: [] }],
      runtimeControls: {
        filters: [{ key: "members", filterId: "members", label: "Regions" }],
      },
    };
    expect(() =>
      applyInsightRuntime(emptySavedIn, {
        filters: { members: ["US"] },
      }),
    ).toThrow("RUNTIME_FILTER_VALUE_INVALID");
  });

  it("uses the literal type inside a saved command operand wrapper", () => {
    const saved: Insight = {
      ...insight,
      filters: [
        {
          id: "wrapped",
          field: "region",
          operator: "eq",
          value: { kind: "value", v: "US" },
        },
      ],
      runtimeControls: {
        filters: [{ key: "wrapped", filterId: "wrapped", label: "Region" }],
      },
    };

    expect(
      applyInsightRuntime(saved, { filters: { wrapped: "CA" } }).filters,
    ).toEqual([
      { id: "wrapped", field: "region", operator: "eq", value: "CA" },
    ]);
    expect(() =>
      applyInsightRuntime(saved, { filters: { wrapped: 1 } }),
    ).toThrow("RUNTIME_FILTER_VALUE_INVALID");
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

  it("accepts publication pointers only from the branded materializer failure", () => {
    const tableId = "10000000-0000-4000-8000-000000000001";
    const dataFrameId = "10000000-0000-4000-8000-000000000002";
    const spoofed = new Error("provider failure") as Error & {
      sourceGenerations: unknown[];
    };
    spoofed.sourceGenerations = [
      { tableId: "secret-table", dataFrameId: "secret-frame", leak: "secret" },
    ];
    expect(
      toFetchFailure(spoofed, "FETCH_EXECUTION_FAILED"),
    ).not.toHaveProperty("sourceGenerations");

    const trusted = new PublishedSourceMaterializationError(
      new Error("FETCH_COMPILE_FAILED"),
      [
        { tableId, dataFrameId, extra: "discarded" },
        { tableId: "", dataFrameId: "invalid" },
      ],
    );
    expect(toFetchFailure(trusted, "FETCH_EXECUTION_FAILED")).toMatchObject({
      status: "failed",
      code: "FETCH_EXECUTION_FAILED",
      message: "Live data could not be fetched.",
      sourceGenerations: [{ tableId, dataFrameId }],
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
