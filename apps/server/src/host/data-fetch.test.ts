import type {
  Insight,
  InsightFetchFailed,
  InsightFetchResult,
} from "@dashframe/types";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  applyInsightRuntime,
  createDataFetchFunctions,
  fingerprintEffectiveInsight,
  toFetchFailure,
} from "./data-fetch";
import type { HostContext } from "./context";
import { PublishedSourceMaterializationError } from "./data-fetch/published-source-error";
import { productionMaterializerDependencies } from "./data-fetch/production";
import { fieldIdToColumnAlias } from "@dashframe/engine";

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

function fetchContext(): HostContext {
  return {
    principal: { kind: "user", userId: "user" },
    metadata: {
      getDataTable: async (id: string) => ({ id }),
      getInsight: async () => undefined,
    },
  } as unknown as HostContext;
}

const productFieldId = "10000000-0000-4000-8000-000000000001";
const countryFieldId = "10000000-0000-4000-8000-000000000002";
const otherFieldId = "10000000-0000-4000-8000-000000000003";

const previewDefinition = {
  baseTableId: "table-1",
  selectedFields: [productFieldId],
  metrics: [],
};

describe("fetchData sort schema", () => {
  it("preserves the complete strict pivot tuple", async () => {
    const execute = vi.fn(async (): Promise<InsightFetchResult> => ({
      status: "failed",
      code: "EXPECTED",
      message: "expected",
      retryable: false,
      diagnosticId: "diagnostic",
    }));
    const { fetchData } = createDataFetchFunctions(execute);
    const pivotValues = [
      { fieldId: "country", value: "US" },
      { fieldId: "year", value: 2026 },
      { fieldId: "active", value: true },
      { fieldId: "segment", value: null },
    ];

    await fetchData(fetchContext(), {
      insight: {
        ...previewDefinition,
        sorts: [{ field: "metric_revenue", direction: "desc", pivotValues }],
      },
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        insight: expect.objectContaining({
          sorts: [{ field: "metric_revenue", direction: "desc", pivotValues }],
        }),
      }),
    );
  });

  it.each([
    [{ fieldId: "country", value: Number.NaN }],
    [{ fieldId: "country", value: { nested: true } }],
    [{ fieldId: "country", value: "US", extra: true }],
  ])("rejects a malformed pivot tuple", async (pivotValues) => {
    const execute = vi.fn();
    const { fetchData } = createDataFetchFunctions(execute);

    const result = await fetchData(fetchContext(), {
      insight: {
        ...previewDefinition,
        sorts: [{ field: "metric_revenue", direction: "desc", pivotValues }],
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      code: "FETCH_INVALID_DEFINITION",
    });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("Insight presentation requests", () => {
  it("passes a validated presentation to an ephemeral preview", async () => {
    const execute = vi.fn(async (): Promise<InsightFetchResult> => ({
      status: "failed",
      code: "EXPECTED",
      message: "expected",
      retryable: false,
      diagnosticId: "diagnostic",
    }));
    const { fetchData } = createDataFetchFunctions(execute);

    await fetchData(fetchContext(), {
      insight: previewDefinition,
      presentation: {
        dimensions: [productFieldId],
        transforms: {
          [productFieldId]: { kind: "temporal", aggregation: "yearMonth" },
        },
      },
    });

    expect(execute).toHaveBeenCalledWith({
      context: expect.anything(),
      insight: expect.objectContaining({
        presentation: {
          dimensions: [productFieldId],
          transforms: {
            [productFieldId]: {
              kind: "temporal",
              aggregation: "yearMonth",
            },
          },
        },
      }),
      target: { kind: "ephemeral" },
    });
  });

  it("accepts a date transform for a selected repeat-join field", async () => {
    const repeatFieldId = `${productFieldId}_j1`;
    const execute = vi.fn(async (): Promise<InsightFetchResult> => ({
      status: "failed",
      code: "EXPECTED",
      message: "expected",
      retryable: false,
      diagnosticId: "diagnostic",
    }));
    const { fetchData } = createDataFetchFunctions(execute);

    await fetchData(fetchContext(), {
      insight: { ...previewDefinition, selectedFields: [repeatFieldId] },
      presentation: {
        dimensions: [repeatFieldId],
        transforms: {
          [repeatFieldId]: { kind: "temporal", aggregation: "yearMonth" },
        },
      },
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        insight: expect.objectContaining({
          presentation: {
            dimensions: [repeatFieldId],
            transforms: {
              [repeatFieldId]: {
                kind: "temporal",
                aggregation: "yearMonth",
              },
            },
          },
        }),
      }),
    );
  });

  it.each([
    [{ dimensions: [productFieldId, productFieldId] }, "FETCH_INVALID_REQUEST"],
    [
      {
        dimensions: [productFieldId],
        transforms: {
          [productFieldId]: { kind: "temporal", aggregation: "day" },
        },
      },
      "FETCH_INVALID_REQUEST",
    ],
    [
      {
        dimensions: [productFieldId],
        transforms: {
          [otherFieldId]: { kind: "categorical", groupBy: "monthName" },
        },
      },
      "RUNTIME_PRESENTATION_NOT_ALLOWED",
    ],
  ] as const)(
    "rejects invalid presentation input %#",
    async (presentation, code) => {
      const execute = vi.fn();
      const { fetchData } = createDataFetchFunctions(execute);

      const result = await fetchData(fetchContext(), {
        insight: previewDefinition,
        presentation,
      });

      expect(result).toMatchObject({
        status: "failed",
        code,
      });
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("uses an ephemeral frame after runtime selection and never offers a saved fallback", async () => {
    const insightId = "00000000-0000-4000-8000-000000000001";
    const listDataFramesByInsight = vi.fn(async () => []);
    const context = {
      principal: { kind: "user", userId: "user" },
      metadata: {
        getInsight: async () => ({
          id: insightId,
          name: "Saved",
          createdAt: 0,
          definition: {
            source: { sourceType: "dataTable", sourceId: "table-1" },
            selectedFields: [productFieldId, countryFieldId],
            metrics: [],
            runtimeControls: {
              dimensions: {
                allowedIds: [productFieldId, countryFieldId],
                maxSelected: 1,
              },
            },
          },
        }),
        listDataFramesByInsight,
      },
    } as unknown as HostContext;
    const execute = vi.fn(async (): Promise<InsightFetchResult> => ({
      status: "failed",
      code: "FETCH_EXECUTION_FAILED",
      message: "failed",
      retryable: false,
      diagnosticId: "diagnostic",
    }));
    const { runInsight } = createDataFetchFunctions(execute);

    const result = await runInsight(context, {
      insightId,
      runtime: { dimensions: [countryFieldId] },
      presentation: { dimensions: [countryFieldId] },
    });

    expect(result.status).toBe("failed");
    expect(execute).toHaveBeenCalledWith({
      context,
      insight: expect.objectContaining({
        selectedFields: [countryFieldId],
        presentation: { dimensions: [countryFieldId] },
      }),
      target: { kind: "ephemeral" },
    });
    expect(listDataFramesByInsight).not.toHaveBeenCalled();

    execute.mockClear();
    execute.mockResolvedValueOnce({
      status: "ready",
      dataFrameId: "canonical-frame",
      schema: [],
      rowCount: 0,
      definitionFingerprint: "canonical-fingerprint",
      provenance: { connectorKind: "notion", bindingVersion: "v1" },
      fetchedAt: 123,
    });
    await runInsight(context, {
      insightId,
      runtime: { dimensions: [countryFieldId] },
    });
    expect(execute).toHaveBeenCalledWith({
      context,
      insight: expect.not.objectContaining({ presentation: expect.anything() }),
      target: { kind: "saved", insightId },
    });
  });

  it("cross-validates presentation against the effective runtime dimensions", async () => {
    const insightId = "00000000-0000-4000-8000-000000000001";
    const context = {
      principal: { kind: "user", userId: "user" },
      metadata: {
        getInsight: async () => ({
          id: insightId,
          name: "Saved",
          createdAt: 0,
          definition: {
            source: { sourceType: "dataTable", sourceId: "table-1" },
            selectedFields: [productFieldId, countryFieldId],
            metrics: [],
            runtimeControls: {
              dimensions: {
                allowedIds: [productFieldId, countryFieldId],
                maxSelected: 1,
              },
            },
          },
        }),
      },
    } as unknown as HostContext;
    const execute = vi.fn();
    const { runInsight } = createDataFetchFunctions(execute);

    const result = await runInsight(context, {
      insightId,
      runtime: { dimensions: [countryFieldId] },
      presentation: { dimensions: [productFieldId] },
    });

    expect(result).toMatchObject({
      status: "failed",
      code: "RUNTIME_PRESENTATION_NOT_ALLOWED",
    });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("applyInsightRuntime", () => {
  it("switches declared dimensions and measures without dropping calculation dependencies or mutating the report", () => {
    const saved: Insight = {
      ...insight,
      metrics: [
        {
          id: "orders",
          name: "Orders",
          sourceTable: "table-1",
          aggregation: "count",
        },
        {
          id: "rate",
          name: "Rate",
          sourceTable: "table-1",
          aggregation: "count",
          expression: {
            kind: "binary",
            operator: "divide",
            left: { kind: "measure", measureId: "orders" },
            right: { kind: "constant", value: 10 },
          },
        },
      ],
      runtimeControls: {
        dimensions: { allowedIds: ["region", "date"], maxSelected: 1 },
        measures: { allowedIds: ["orders", "rate"], maxSelected: 1 },
      },
    };
    const original = JSON.stringify(saved);
    const result = applyInsightRuntime(saved, {
      dimensions: ["region"],
      measures: ["rate"],
    });
    expect(result.selectedFields).toEqual(["region"]);
    expect(result.runtimeDimensionsChanged).toBe(true);
    expect(result.reporting?.measureIds).toEqual(["rate"]);
    expect(result.metrics).toHaveLength(2);
    expect(JSON.stringify(saved)).toBe(original);
    for (const runtime of [
      { dimensions: ["unknown"] },
      { dimensions: ["region", "date"] },
      { measures: [] },
      { measures: ["orders", "orders"] },
      { measures: ["unknown"] },
    ])
      expect(() => applyInsightRuntime(saved, runtime)).toThrow(
        "RUNTIME_SELECTION_NOT_ALLOWED",
      );
    expect(() =>
      applyInsightRuntime(insight, { dimensions: ["region"] }),
    ).toThrow("RUNTIME_SELECTION_NOT_ALLOWED");
  });

  it("keeps the saved fields and measures that are not viewer choices", () => {
    const saved: Insight = {
      ...insight,
      selectedFields: ["region", "date"],
      metrics: [
        {
          id: "orders",
          name: "Orders",
          sourceTable: "table-1",
          aggregation: "count",
        },
        {
          id: "rate",
          name: "Rate",
          sourceTable: "table-1",
          aggregation: "count",
        },
      ],
      runtimeControls: {
        // Only date and product are viewer choices; region always shows.
        dimensions: { allowedIds: ["date", "product"], maxSelected: 2 },
        measures: { allowedIds: ["rate"], maxSelected: 1 },
      },
    };
    const result = applyInsightRuntime(saved, {
      dimensions: ["region", "product"],
      measures: ["orders"],
    });
    expect(result.selectedFields).toEqual(["region", "product"]);
    expect(result.reporting?.measureIds).toEqual(["orders"]);
    // The cap counts only the viewer's picks, never the fixed fields.
    expect(
      applyInsightRuntime(saved, {
        dimensions: ["region", "date", "product"],
      }).selectedFields,
    ).toEqual(["region", "date", "product"]);
    const oneChoice: Insight = {
      ...saved,
      runtimeControls: {
        dimensions: { allowedIds: ["date", "product"], maxSelected: 1 },
      },
    };
    expect(() =>
      applyInsightRuntime(oneChoice, {
        dimensions: ["region", "date", "product"],
      }),
    ).toThrow("RUNTIME_SELECTION_NOT_ALLOWED");
    for (const runtime of [
      // Dropping a fixed field or measure is refused.
      { dimensions: ["date"] },
      { measures: ["rate"] },
      // A field outside the saved selection must be a viewer choice.
      { dimensions: ["region", "country"] },
    ])
      expect(() => applyInsightRuntime(saved, runtime)).toThrow(
        "RUNTIME_SELECTION_NOT_ALLOWED",
      );
  });

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

    const optionalWithoutClearPermission: Insight = {
      ...insight,
      runtimeControls: {
        filters: [
          { key: "region", filterId: "region-filter", label: "Region" },
        ],
      },
    };
    expect(() =>
      applyInsightRuntime(optionalWithoutClearPermission, {
        filters: { region: null },
      }),
    ).toThrow("RUNTIME_FILTER_CLEAR_NOT_ALLOWED");
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
    const result = applyInsightRuntime(saved, {
      sort: [{ fieldId: "revenue-total", direction: "desc" }],
    });
    expect(result.sorts).toEqual([
      { field: "metric_revenue_total", direction: "desc" },
    ]);
    expect(result.runtimeSortOverride).toBe(true);
  });

  it("preserves the saved pivot tuple when runtime changes its metric sort direction", () => {
    const pivotValues = [{ fieldId: "region", value: "US" }];
    const saved: Insight = {
      ...insight,
      metrics: [
        {
          id: "revenue-total",
          name: "Revenue",
          sourceTable: "table-1",
          columnName: "revenue",
          aggregation: "sum",
        },
      ],
      reporting: { pivotFields: ["region"] },
      sorts: [
        {
          field: "metric_revenue_total",
          direction: "desc",
          pivotValues,
        },
      ],
      runtimeControls: {
        sort: { allowedFieldIds: ["revenue-total"], maxKeys: 1 },
      },
    };

    expect(
      applyInsightRuntime(saved, {
        sort: [{ fieldId: "revenue-total", direction: "asc" }],
      }).sorts,
    ).toEqual([
      {
        field: "metric_revenue_total",
        direction: "asc",
        pivotValues,
      },
    ]);
  });

  it("rejects an explicit dimension sort removed by the runtime selection", () => {
    const saved: Insight = {
      ...insight,
      runtimeControls: {
        dimensions: { allowedIds: ["region", "date"], maxSelected: 1 },
        sort: { allowedFieldIds: ["region", "date"], maxKeys: 1 },
      },
    };

    expect(() =>
      applyInsightRuntime(saved, {
        dimensions: ["region"],
        sort: [{ fieldId: "date", direction: "asc" }],
      }),
    ).toThrow("RUNTIME_SORT_FIELD_NOT_ALLOWED");
  });

  it("includes internal runtime provenance in the effective fingerprint", () => {
    const effective = applyInsightRuntime(
      {
        ...insight,
        runtimeControls: {
          dimensions: { allowedIds: ["region", "date"], maxSelected: 1 },
        },
      },
      { dimensions: ["region"] },
    );
    const { runtimeDimensionsChanged: _changed, ...withoutProvenance } =
      effective;

    expect(fingerprintEffectiveInsight(effective)).not.toBe(
      fingerprintEffectiveInsight(withoutProvenance),
    );
  });

  it("distinguishes a presentation frame from its canonical report frame", () => {
    const effective = {
      baseTableId: "table-1",
      selectedFields: ["region"],
      metrics: [],
    };

    expect(
      fingerprintEffectiveInsight({
        ...effective,
        presentation: { dimensions: ["region"] },
      }),
    ).not.toBe(fingerprintEffectiveInsight(effective));
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
        new Error("RUNTIME_PIVOT_SORT_REQUIRES_TUPLE"),
        "FETCH_EXECUTION_FAILED",
      ),
    ).toMatchObject({
      code: "RUNTIME_PIVOT_SORT_REQUIRES_TUPLE",
      message:
        "This pivot report requires a saved pivot cell for metric sorting. Choose a pivot-cell sort first.",
    });
    expect(
      toFetchFailure(new Error("__proto__"), "FETCH_EXECUTION_FAILED"),
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
      toFetchFailure(
        new Error("RUNTIME_SORT_REFERENCE_AMBIGUOUS"),
        "FETCH_EXECUTION_FAILED",
      ),
    ).toMatchObject({
      code: "RUNTIME_SORT_REFERENCE_AMBIGUOUS",
      message:
        "The saved sort matches more than one field. Choose the sort field again.",
    });
    expect(
      toFetchFailure(
        new Error("RUNTIME_SORT_REFERENCE_INVALID"),
        "FETCH_EXECUTION_FAILED",
      ),
    ).toMatchObject({
      code: "RUNTIME_SORT_REFERENCE_INVALID",
      message:
        "The saved sort field is no longer available. Choose another sort field.",
    });
    expect(
      toFetchFailure(
        new Error("RUNTIME_LIMIT_REQUIRES_SORT"),
        "FETCH_EXECUTION_FAILED",
      ),
    ).toMatchObject({
      code: "RUNTIME_LIMIT_REQUIRES_SORT",
      message:
        "The selected dimensions removed the sort required by the row limit. Choose another sort or remove the limit.",
    });
    expect(
      toFetchFailure(
        new Error("RUNTIME_TOPN_MEASURE_NOT_ADDITIVE"),
        "FETCH_EXECUTION_FAILED",
      ),
    ).toMatchObject({
      code: "RUNTIME_TOPN_MEASURE_NOT_ADDITIVE",
      message:
        "This measure can't rank by the selected dimension across another dimension; rank by an additive measure.",
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
      message:
        "The requested data isn't ready. Check that its sources and tables exist.",
      retryable: false,
    });
    expect(
      toFetchFailure(
        new Error("FETCH_COMPILE_FAILED"),
        "FETCH_EXECUTION_FAILED",
      ),
    ).toMatchObject({
      status: "failed",
      code: "FETCH_COMPILE_FAILED",
      message:
        "This insight couldn't be compiled. Its source table may not have data yet.",
      retryable: false,
    });
    expect(
      toFetchFailure(
        new Error("SOURCE_NOT_REFRESHABLE"),
        "FETCH_SOURCE_FAILED",
      ),
    ).toMatchObject({
      status: "failed",
      code: "SOURCE_NOT_REFRESHABLE",
      retryable: false,
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
        { tableId, dataFrameId, lastFetchedAt: 123, extra: "discarded" },
        { tableId: "", dataFrameId: "invalid" },
        { tableId, dataFrameId },
        { tableId, dataFrameId, lastFetchedAt: Infinity },
      ],
    );
    expect(toFetchFailure(trusted, "FETCH_EXECUTION_FAILED")).toMatchObject({
      status: "failed",
      code: "FETCH_COMPILE_FAILED",
      message:
        "This insight couldn't be compiled. Its source table may not have data yet.",
      retryable: false,
      sourceGenerations: [{ tableId, dataFrameId, lastFetchedAt: 123 }],
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

it("reports unsupported source values separately from schema changes", () => {
  expect(
    toFetchFailure(
      new Error("SOURCE_VALUE_UNSUPPORTED"),
      "FETCH_SOURCE_FAILED",
    ),
  ).toMatchObject({
    status: "failed",
    code: "SOURCE_VALUE_UNSUPPORTED",
    retryable: false,
  });
});

describe("fetchData exclusive", () => {
  it("asks for an exclusive ephemeral frame only when the caller does", async () => {
    const execute = vi.fn(
      async (_args: { target: unknown }): Promise<InsightFetchResult> => ({
        status: "failed",
        code: "EXPECTED",
        message: "expected",
        retryable: false,
        diagnosticId: "diagnostic",
      }),
    );
    const { fetchData } = createDataFetchFunctions(execute);
    await fetchData(fetchContext(), {
      insight: previewDefinition,
      exclusive: true,
    });
    await fetchData(fetchContext(), { insight: previewDefinition });
    expect(execute.mock.calls.map(([args]) => args.target)).toEqual([
      { kind: "ephemeral", exclusive: true },
      { kind: "ephemeral" },
    ]);
  });
});

describe("fetchData measure contracts", () => {
  const tableId = "50000000-0000-4000-8000-000000000000";
  const week = "50000000-0000-4000-8000-000000000001";
  const channel = "50000000-0000-4000-8000-000000000002";
  const sessions = "50000000-0000-4000-8000-000000000003";
  const table = {
    id: tableId,
    name: "ga4",
    dataFrameId: "50000000-0000-4000-8000-0000000000ff",
    fields: [
      {
        id: week,
        name: "Week",
        columnName: "week",
        type: "date",
        scope: "time",
      },
      {
        id: channel,
        name: "Channel",
        columnName: "channel",
        type: "string",
        scope: "session",
      },
      {
        id: sessions,
        name: "Sessions",
        columnName: "sessions",
        type: "number",
      },
    ].map((field) => ({ ...field, tableId })),
    metrics: [],
    createdAt: 0,
  };
  const metric = (contract?: unknown) => ({
    id: "50000000-0000-4000-8000-0000000000aa",
    name: "Total Sessions",
    sourceTable: tableId,
    columnName: "sessions",
    aggregation: "sum",
    ...(contract ? { contract } : {}),
  });

  /** Compiles what the host would run, with the production compiler. */
  async function compiledSql(contract?: unknown) {
    let sql: string | undefined;
    const { fetchData } = createDataFetchFunctions(async ({ insight }) => {
      sql = productionMaterializerDependencies().compile({
        insight,
        tables: new Map([[tableId, table as never]]),
      } as never);
      return {
        status: "failed",
        code: "EXPECTED",
        message: "compiled",
        retryable: false,
        diagnosticId: "d",
      };
    });
    const result = await fetchData(fetchContext(), {
      insight: {
        baseTableId: tableId,
        selectedFields: [week],
        metrics: [metric(contract)],
      },
      presentation: { dimensions: [week] },
      exclusive: true,
    });
    return { sql, result };
  }

  it("honours a scope-restricted additive measure in a preview", async () => {
    // Summed over time only: grouping by week drops the session-scoped
    // channel, which must block the total rather than sum across it.
    const { sql } = await compiledSql({
      kind: "additive",
      additiveOver: ["time"],
    });
    expect(sql).toContain(
      `COUNT(DISTINCT ROW("${fieldIdToColumnAlias(channel)}")) <= 1`,
    );
    const plain = await compiledSql();
    expect(plain.sql).not.toContain("COUNT(DISTINCT ROW");
  });

  it("rejects a malformed or invalid contract", async () => {
    for (const contract of [
      { kind: "ratio" },
      { kind: "additive", additiveOver: ["galaxy"] },
    ]) {
      const { sql, result } = await compiledSql(contract);
      expect(sql).toBeUndefined();
      expect(result).toMatchObject({ code: "FETCH_INVALID_DEFINITION" });
    }
  });
});
