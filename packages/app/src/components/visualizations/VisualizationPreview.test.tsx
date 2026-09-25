import { nativeQueryMock, hostQueryMock } from "@/test/native-query-fixture";
/**
 * Tests for VisualizationPreview terminal-state routing.
 *
 * Three branch contracts:
 * (a) Loading — spinner is shown while insight or view is not yet ready.
 * (b) View-creation error — terminal/error UI is shown (not spinner) even when
 *     `isReady` is false (guard ordering bug: error must be checked before
 *     the loading guard to avoid an indefinite spinner).
 * (c) Missing encoding — "Encoding missing" text is shown (not spinner) when
 *     `resolvedEncoding` has no x/y channel after the view is ready.
 *
 * Scope: VisualizationPreview.tsx only.
 */
import { render, screen } from "@testing-library/react";
import type { UseInsightPaginationOptions } from "@/hooks/useInsightPagination";
import { fieldIdToColumnAlias } from "@dashframe/engine";
import { describe, expect, it, vi } from "vite-plus/test";
import { VisualizationPreview } from "./VisualizationPreview";

type PaginationMockResult = {
  dataFrameId?: string | null;
  isReady?: boolean;
  error?: string | null;
  resolvedFields: import("@dashframe/types").Field[];
};

// ── Mocks ────────────────────────────────────────────────────────────────────

const {
  mockUseInsightView,
  mockUseInsightPagination,
  mockResolveEncoding,
  mockChart,
} = vi.hoisted(() => ({
  mockUseInsightView: vi.fn(),
  mockUseInsightPagination: vi.fn(
    (_options?: UseInsightPaginationOptions): PaginationMockResult => ({
      resolvedFields: [],
    }),
  ),
  mockResolveEncoding: vi.fn().mockReturnValue({}),
  mockChart: vi.fn(),
}));

vi.mock("@/hooks/useInsightView", () => ({
  useInsightView: (...args: unknown[]) => mockUseInsightView(...args),
}));

vi.mock("@/hooks/useInsightPagination", () => ({
  useInsightPagination: (options: UseInsightPaginationOptions) =>
    mockUseInsightPagination(options),
}));

const { mockUseInsight, mockUseDataTables } = vi.hoisted(() => ({
  mockUseInsight: vi.fn(),
  mockUseDataTables: vi.fn(),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock((ref: { _path: string }) => {
    if (ref._path === "getInsight") return mockUseInsight();
    if (ref._path === "listDataTables") return mockUseDataTables();
    if (ref._path === "listInsights") return { data: [], isLoading: false };
    throw new Error(`Unexpected query: ${ref._path}`);
  }),
}));
vi.mock("@/data/host", () => ({
  useHostQuery: hostQueryMock((ref: { _path: string }) => {
    if (ref._path === "getInsight") return mockUseInsight();
    if (ref._path === "listDataTables") return mockUseDataTables();
    throw new Error(`Unexpected query: ${ref._path}`);
  }),
}));

vi.mock("@dashframe/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dashframe/engine")>();
  return {
    ...actual,
    resolveEncodingToResultFrame: mockResolveEncoding,
  };
});

// Chart is a heavy dependency — stub it out so tests focus on guard logic.
vi.mock("@dashframe/visualization", () => ({
  Chart: (props: { tableName: string; detailRowsOnly: boolean }) => {
    mockChart(props);
    return <div data-testid="chart" />;
  },
}));

// ── Shared fixture ───────────────────────────────────────────────────────────

const visualization = {
  id: "viz-1",
  name: "Test Chart",
  insightId: "ins-1",
  visualizationType: "bar",
  encoding: { x: "field:f1", y: "metric:m1" },
  createdAt: 0,
} as unknown as import("@dashframe/types").Visualization;

const insight = {
  id: "ins-1",
  name: "Test",
  source: { sourceType: "dataTable", sourceId: "t1" },
  selectedFields: [],
  metrics: [],
  joins: [],
  createdAt: 0,
} as unknown as import("@dashframe/types").Insight;

const dataTable = {
  id: "t1",
  name: "Test",
  dataSourceId: "ds1",
  table: "test",
  fields: [],
  metrics: [],
  createdAt: 0,
} as unknown as import("@dashframe/types").DataTable;

function setDataReady() {
  mockUseInsight.mockReturnValue({ data: insight, isLoading: false });
  mockUseDataTables.mockReturnValue({ data: [dataTable] });
}

it("renders from a supplied materialization without starting preview hooks", () => {
  mockUseInsight.mockClear();
  mockUseDataTables.mockClear();
  mockUseInsightView.mockClear();
  mockUseInsightPagination.mockClear();
  mockResolveEncoding.mockReturnValueOnce({ x: "field_f1" });

  render(
    <VisualizationPreview
      visualization={visualization}
      materialization={{
        insight,
        dataTable,
        dataFrameId: "frame-shared",
        isReady: true,
        error: null,
        resolvedFields: [],
      }}
    />,
  );

  expect(mockUseInsight).not.toHaveBeenCalled();
  expect(mockUseDataTables).not.toHaveBeenCalled();
  expect(mockUseInsightView).not.toHaveBeenCalled();
  expect(mockUseInsightPagination).not.toHaveBeenCalled();
  expect(screen.getByTestId("chart")).toBeTruthy();
});

it("requests and renders a presentation frame for a supplied metric materialization", () => {
  const fieldId = "10000000-0000-4000-8000-000000000001";
  const metricId = "20000000-0000-4000-8000-000000000001";
  const metricInsight = {
    ...insight,
    selectedFields: [fieldId],
    metrics: [
      {
        id: metricId,
        name: "Revenue",
        sourceTable: "t1",
        columnName: "revenue",
        aggregation: "sum",
      },
    ],
    reporting: { totals: true },
  } as import("@dashframe/types").Insight;
  const metricVisualization = {
    ...visualization,
    encoding: { x: `field:${fieldId}`, y: `metric:${metricId}` },
  } as import("@dashframe/types").Visualization;
  const metricTable = {
    ...dataTable,
    fields: [
      {
        id: fieldId,
        tableId: "t1",
        name: "Product",
        columnName: "product",
        type: "string",
      },
    ],
  } as import("@dashframe/types").DataTable;
  mockResolveEncoding.mockReturnValueOnce({
    x: `field_${fieldId.replaceAll("-", "_")}`,
    y: `metric_${metricId.replaceAll("-", "_")}`,
  });
  mockUseInsightPagination.mockReturnValueOnce({
    dataFrameId: "frame-presentation",
    isReady: true,
    error: null,
    resolvedFields: metricTable.fields,
  });

  render(
    <VisualizationPreview
      visualization={metricVisualization}
      materialization={{
        insight: metricInsight,
        dataTable: metricTable,
        dataFrameId: "frame-canonical",
        isReady: true,
        error: null,
        resolvedFields: metricTable.fields,
        runtime: { limit: 1 },
      }}
    />,
  );

  expect(mockUseInsightPagination).toHaveBeenCalledWith({
    insight: metricInsight,
    showModelPreview: false,
    enabled: true,
    runtime: { limit: 1 },
    presentation: { dimensions: [fieldId] },
  });
  expect(mockChart).toHaveBeenCalledWith(
    expect.objectContaining({
      tableName: "frame-presentation",
      detailRowsOnly: false,
    }),
  );
  expect(screen.getByTestId("chart")).toBeTruthy();
});

// ── (a) Loading — spinner while insight or view not ready ────────────────────

describe("VisualizationPreview — (a) loading branch", () => {
  it("renders a spinner while insight is still loading", () => {
    mockUseInsight.mockReturnValue({ data: undefined, isLoading: true });
    mockUseDataTables.mockReturnValue({ data: [] });
    mockUseInsightView.mockReturnValue({
      viewName: null,
      isReady: false,
      error: null,
    });

    const { container } = render(
      <VisualizationPreview visualization={visualization} />,
    );

    // Spinner is rendered — no error text, no chart
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.queryByText("Failed to load")).toBeNull();
    expect(screen.queryByText("Encoding missing")).toBeNull();
    expect(screen.queryByTestId("chart")).toBeNull();
  });

  it("renders a spinner when insight loaded but view is not yet ready (no error)", () => {
    setDataReady();
    mockUseInsightView.mockReturnValue({
      viewName: null,
      isReady: false,
      error: null,
    });

    const { container } = render(
      <VisualizationPreview visualization={visualization} />,
    );

    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.queryByText("Failed to load")).toBeNull();
  });
});

// ── (b) View-creation error — terminal UI, not spinner ───────────────────────

describe("VisualizationPreview — (b) view-creation error branch", () => {
  it("shows terminal error UI (not spinner) when error is set with isReady=false", () => {
    // This was the bug: isReady=false + error → loading guard fired before error
    // guard, resulting in indefinite spinner.
    setDataReady();
    mockUseInsightView.mockReturnValue({
      viewName: null,
      isReady: false,
      error: "View creation failed: loopback 500",
    });

    const { container } = render(
      <VisualizationPreview visualization={visualization} />,
    );

    // Must show terminal text, not a spinner
    expect(screen.getByText("Failed to load")).not.toBeNull();
    // No spinner SVG visible
    expect(container.querySelector("svg")).toBeNull();
  });

  it("passes fallback through when caller provides one and error occurs", () => {
    setDataReady();
    mockUseInsightView.mockReturnValue({
      viewName: null,
      isReady: false,
      error: "some error",
    });

    render(
      <VisualizationPreview
        visualization={visualization}
        fallback={<span data-testid="custom-fallback">custom</span>}
      />,
    );

    expect(screen.getByTestId("custom-fallback")).not.toBeNull();
    expect(screen.queryByText("Failed to load")).toBeNull();
  });

  it("does NOT show stale error from prior insight while the new insight is loading", () => {
    // Regression: after the guard reorder (error before loading), a stale error
    // from insight A can persist in useInsightView while insight B is loading
    // (isLoadingInsight=true). The `!isLoadingInsight` guard prevents the stale
    // error from surfacing as "Failed to load" during the transition.
    //
    // Simulate: component re-rendered for a new visualization/insight.
    // isLoadingInsight=true (new insight fetch in flight).
    // error is still set from the prior insight's view-creation failure.
    mockUseInsight.mockReturnValue({ data: undefined, isLoading: true });
    mockUseDataTables.mockReturnValue({ data: [] });
    mockUseInsightView.mockReturnValue({
      viewName: null,
      isReady: false,
      error: "stale error from prior insight A",
    });

    const { container } = render(
      <VisualizationPreview visualization={visualization} />,
    );

    // Must show spinner, NOT the stale error UI
    expect(screen.queryByText("Failed to load")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

// ── (c) Encoding missing — distinct text, not spinner ───────────────────────

describe("VisualizationPreview — (c) encoding-missing branch", () => {
  it("shows 'Encoding missing' text (not spinner) when resolvedEncoding has no x/y", () => {
    // resolveEncodingToSql is already mocked to return {} (no x/y)
    setDataReady();
    mockUseInsightView.mockReturnValue({
      viewName: "v_ins1",
      isReady: true,
      error: null,
    });

    const vizNoEncoding = {
      ...visualization,
      encoding: {},
    } as unknown as import("@dashframe/types").Visualization;

    const { container } = render(
      <VisualizationPreview visualization={vizNoEncoding} />,
    );

    expect(screen.getByText("Encoding missing")).not.toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.queryByTestId("chart")).toBeNull();
  });

  it("resolves a composed Insight from its materialized result fields", () => {
    mockUseInsight.mockReturnValue({
      data: {
        ...insight,
        source: { sourceType: "insight", sourceId: "upstream" },
      },
      isLoading: false,
    });
    mockUseDataTables.mockReturnValue({ data: [] });
    mockUseInsightPagination.mockReturnValue({
      resolvedFields: [{ id: "f1", name: "Revenue", tableId: "upstream" }],
    });
    mockResolveEncoding.mockReturnValue({ x: "field_f1" });
    mockUseInsightView.mockReturnValue({
      viewName: "frame-composed",
      isReady: true,
      error: null,
    });

    render(<VisualizationPreview visualization={visualization} />);

    expect(mockResolveEncoding).toHaveBeenCalledWith(
      visualization.encoding,
      expect.objectContaining({
        fields: [expect.objectContaining({ id: "f1" })],
      }),
    );
    expect(screen.getByTestId("chart")).not.toBeNull();
  });
});

it("titles a measure from its source column's display name", () => {
  const metricId = "40000000-0000-4000-8000-000000000001";
  const sourceAlias = "field_50000000_0000_4000_8000_000000000001";
  const metricInsight = {
    ...insight,
    metrics: [
      {
        id: metricId,
        name: "",
        sourceTable: "t1",
        columnName: sourceAlias,
        aggregation: "sum",
      },
    ],
  } as import("@dashframe/types").Insight;
  mockChart.mockClear();
  mockResolveEncoding.mockReturnValueOnce({ y: "metric_y" });
  mockUseInsightPagination.mockReturnValueOnce({
    dataFrameId: "frame-presentation",
    isReady: true,
    error: null,
    resolvedFields: [],
  });

  render(
    <VisualizationPreview
      visualization={{
        ...visualization,
        encoding: { y: `metric:${metricId}` },
      }}
      thumbnail={false}
      columnDisplayNames={{ [sourceAlias]: "Revenue" }}
      materialization={{
        insight: metricInsight,
        dataTable,
        dataFrameId: "frame-shared",
        isReady: true,
        error: null,
        resolvedFields: [],
      }}
    />,
  );

  expect(mockChart).toHaveBeenLastCalledWith(
    expect.objectContaining({
      encoding: expect.objectContaining({ yLabel: "Sum of Revenue" }),
    }),
  );
});

describe("VisualizationPreview — report cell overrides", () => {
  function renderWithOverrides(
    overrides: import("@dashframe/types").DashboardItemOverrides,
  ) {
    mockUseInsightView.mockClear();
    mockUseInsight.mockReturnValue({
      data: { ...insight, runtimeControls: { limit: { max: 100 } } },
      isLoading: false,
    });
    mockUseDataTables.mockReturnValue({ data: [dataTable] });
    mockUseInsightView.mockReturnValue({
      viewName: null,
      isReady: false,
      error: null,
    });
    render(
      <VisualizationPreview
        visualization={visualization}
        overrides={overrides}
        fallback={<span data-testid="custom-fallback">custom</span>}
      />,
    );
  }

  it("runs the chart with the cell's declared overrides", () => {
    renderWithOverrides({ limit: 5 });

    expect(mockUseInsightView).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "ins-1" }),
      expect.objectContaining({ runtime: { limit: 5 } }),
    );
  });

  it("shows the fallback, and runs nothing, for an undeclared override", () => {
    renderWithOverrides({ sorts: [{ field: "Sales", direction: "desc" }] });

    expect(mockUseInsightView).toHaveBeenLastCalledWith(
      null,
      expect.anything(),
    );
    expect(screen.getByTestId("custom-fallback")).toBeTruthy();
  });
});

describe("VisualizationPreview — render failure", () => {
  function renderThrowingChart(fallback?: React.ReactNode) {
    setDataReady();
    mockResolveEncoding.mockReturnValue({ x: "field_f1" });
    mockUseInsightView.mockReturnValue({
      viewName: "frame-ready",
      isReady: true,
      error: null,
    });
    // Every render throws: React retries a failed render once.
    mockChart.mockImplementation(() => {
      throw new Error("invalid saved encoding");
    });
    // The boundary logs what it catches; keep the test output quiet.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    render(
      <VisualizationPreview
        visualization={visualization}
        fallback={fallback}
      />,
    );
    consoleError.mockRestore();
    mockChart.mockReset();
  }

  it("shows the caller's fallback when the chart throws", () => {
    renderThrowingChart(<span data-testid="custom-fallback">custom</span>);

    expect(screen.getByTestId("custom-fallback")).toBeTruthy();
    expect(screen.queryByText("Can't display this chart")).toBeNull();
  });

  it("shows the broken-chart card when no fallback is given", () => {
    renderThrowingChart();

    expect(screen.getByText("Can't display this chart")).toBeTruthy();
  });
});

describe("VisualizationPreview — chart chrome", () => {
  function renderReady(thumbnail?: boolean) {
    mockChart.mockClear();
    mockUseInsight.mockReturnValue({
      data: {
        ...insight,
        source: { sourceType: "insight", sourceId: "upstream" },
      },
      isLoading: false,
    });
    mockUseDataTables.mockReturnValue({ data: [] });
    mockUseInsightPagination.mockReturnValue({
      resolvedFields: [{ id: "f1", name: "Revenue", tableId: "upstream" }],
    });
    mockResolveEncoding.mockReturnValue({ x: "field_f1" });
    mockUseInsightView.mockReturnValue({
      viewName: "frame-ready",
      isReady: true,
      error: null,
    });
    render(
      <VisualizationPreview
        visualization={visualization}
        {...(thumbnail === undefined ? {} : { thumbnail })}
      />,
    );
  }

  it("draws a card thumbnail without axes by default", () => {
    renderReady();
    expect(screen.getByTestId("chart")).toBeTruthy();
    expect(mockChart).toHaveBeenLastCalledWith(
      expect.objectContaining({ preview: true }),
    );
  });

  it("draws the full chart, axes included, when it is not a thumbnail", () => {
    renderReady(false);
    expect(screen.getByTestId("chart")).toBeTruthy();
    expect(mockChart).toHaveBeenLastCalledWith(
      expect.objectContaining({
        preview: false,
        // Axis titles name the field, not its column alias.
        encoding: expect.objectContaining({ xLabel: "Revenue" }),
      }),
    );
  });

  it("titles repeat-join fields with their instance-aware display names", () => {
    const userNameId = "30000000-0000-4000-8000-000000000001";
    const approverNameId = `${userNameId}_j1`;
    mockChart.mockClear();
    mockResolveEncoding.mockReturnValueOnce({ x: "field_x", color: "field_c" });

    render(
      <VisualizationPreview
        visualization={{
          ...visualization,
          encoding: {
            x: `field:${userNameId}`,
            color: `field:${approverNameId}`,
          },
        }}
        thumbnail={false}
        columnDisplayNames={{
          [fieldIdToColumnAlias(userNameId)]: "User Name (created_by)",
          [fieldIdToColumnAlias(approverNameId)]: "User Name (approved_by)",
        }}
        materialization={{
          insight,
          dataTable,
          dataFrameId: "frame-shared",
          isReady: true,
          error: null,
          resolvedFields: [
            { id: userNameId, name: "User Name", tableId: "users" },
            { id: approverNameId, name: "User Name", tableId: "users" },
          ] as import("@dashframe/types").Field[],
        }}
      />,
    );

    expect(mockChart).toHaveBeenLastCalledWith(
      expect.objectContaining({
        encoding: expect.objectContaining({
          xLabel: "User Name (created_by)",
          colorLabel: "User Name (approved_by)",
        }),
      }),
    );
  });
});
