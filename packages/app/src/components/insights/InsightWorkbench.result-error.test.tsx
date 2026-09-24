import { nativeQueryMock, hostQueryMock } from "@/test/native-query-fixture";
import type { DataTable, Insight, UUID, Visualization } from "@dashframe/types";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { queryDataFrame, client, useQuery, runtime } = vi.hoisted(() => ({
  queryDataFrame: vi.fn(),
  client: { mutate: vi.fn() },
  useQuery: vi.fn(() => ({ data: [] })),
  runtime: { scope: {} as object },
}));

vi.mock("@/lib/data-access/data-frames", () => ({ queryDataFrame }));
vi.mock("@/data/runtime", () => ({
  getConvexClient: () => client,
  getRuntimeConfig: () => runtime.scope,
  useQuery: () => ({ data: [] }),
}));
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock(useQuery),
}));
vi.mock("@/data/host", () => ({
  requestHost: (operation: string, args: unknown) =>
    client.mutate({ _path: operation }, args),
  useHostQuery: hostQueryMock(useQuery),
}));
vi.mock("@dashframe/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@dashframe/ui")>()),
  VirtualTable: () => <div data-testid="result-table" />,
}));
vi.mock("@dashframe/visualization", () => ({
  Chart: () => <div data-testid="saved-chart" />,
}));

import { useInsightPagination } from "@/hooks/useInsightPagination";
import { VisualizationPreview } from "@/components/visualizations/VisualizationPreview";
import {
  InsightResultErrorState,
  InsightResultTable,
  resultErrorCopy,
} from "./InsightWorkbench";

const tableId = "10000000-0000-4000-8000-000000000001" as UUID;
const fieldId = "10000000-0000-4000-8000-000000000002" as UUID;
const insight = {
  id: "10000000-0000-4000-8000-000000000003" as UUID,
  name: "Orders",
  source: { sourceType: "dataTable", sourceId: tableId },
  selectedFields: [fieldId],
  metrics: [],
  createdAt: 0,
} as Insight;
const dataTable = {
  id: tableId,
  name: "Orders",
  fields: [
    {
      id: fieldId,
      tableId,
      name: "Region",
      columnName: "region",
      type: "string",
    },
  ],
} as DataTable;
const visualization = {
  id: "10000000-0000-4000-8000-000000000004" as UUID,
  insightId: insight.id,
  name: "Orders by region",
  visualizationType: "barY",
  encoding: { x: `field:${fieldId}`, y: `metric:count` },
  createdAt: 0,
} as Visualization;

const NO_DATA_MESSAGE =
  "This insight couldn't be compiled. Its source table may not have data yet.";

function ResultTableHarness() {
  const result = useInsightPagination({
    insight,
    showModelPreview: false,
  });
  return <InsightResultTable result={result} />;
}

function WorkbenchHalvesHarness() {
  const result = useInsightPagination({
    insight,
    showModelPreview: false,
  });
  return (
    <>
      <InsightResultTable result={result} />
      <VisualizationPreview
        visualization={visualization}
        fallback={
          result.error ? (
            <InsightResultErrorState error={result.error} className="h-full" />
          ) : undefined
        }
        materialization={{
          insight,
          dataTable,
          dataFrameId: result.dataFrameId,
          isReady: result.isReady,
          error: result.error,
          resolvedFields: result.resolvedFields,
        }}
      />
    </>
  );
}

describe("resultErrorCopy", () => {
  it("keeps the host's copy and replaces runtime output", () => {
    expect(resultErrorCopy(NO_DATA_MESSAGE)).toBe(NO_DATA_MESSAGE);
    for (const raw of [
      'Binder Error: Referenced column "x" not found',
      "RuntimeError: unreachable\n    at wasm-function[42]",
      "TypeError: undefined is not a function (at query (engine.js:12))",
      "TypeError: Cannot read properties of undefined",
      "Error: Node abc not found",
    ]) {
      expect(resultErrorCopy(raw)).toBe(
        "The data for this chart couldn't be read. Try again, or check its data source.",
      );
    }
    // Plain words about an error are copy, not runtime output.
    const human = "Connection error: the host did not answer. Try again.";
    expect(resultErrorCopy(human)).toBe(human);
  });
});

describe("InsightResultTable data states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.scope = {};
  });

  it("shows the fetch error instead of 'Loading data...' when the run fails", async () => {
    client.mutate.mockResolvedValue({
      status: "failed",
      code: "FETCH_COMPILE_FAILED",
      message: NO_DATA_MESSAGE,
      retryable: false,
      diagnosticId: "diag-1",
    });

    render(<ResultTableHarness />);

    await waitFor(() => expect(screen.getByRole("alert")).not.toBeNull());
    expect(screen.getByText(NO_DATA_MESSAGE)).not.toBeNull();
    expect(screen.queryByText("Loading data...")).toBeNull();
    expect(screen.queryByTestId("result-table")).toBeNull();
  });

  it("retries the materialization from the error state's Retry action", async () => {
    const user = userEvent.setup();
    client.mutate.mockResolvedValue({
      status: "failed",
      code: "FETCH_COMPILE_FAILED",
      message: NO_DATA_MESSAGE,
      retryable: false,
      diagnosticId: "diag-1",
    });

    render(<ResultTableHarness />);
    await waitFor(() => expect(screen.getByRole("alert")).not.toBeNull());
    expect(client.mutate).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(client.mutate).toHaveBeenCalledTimes(2));
  });

  it("keeps showing 'Loading data...' while the run is in flight", async () => {
    client.mutate.mockReturnValue(new Promise(() => {}));

    render(<ResultTableHarness />);

    await waitFor(() => expect(client.mutate).toHaveBeenCalledOnce());
    expect(screen.getByText("Loading data...")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByTestId("result-table")).toBeNull();
  });

  it("shows a legitimately empty result as empty, not as an error", async () => {
    client.mutate.mockResolvedValue({
      status: "ready",
      dataFrameId: "frame-empty",
    });
    queryDataFrame.mockResolvedValue({
      status: "ready",
      schema: [
        {
          id: "field_10000000_0000_4000_8000_000000000002",
          name: "Region",
          type: "string",
        },
      ],
      rows: [],
      totalCount: 0,
      page: {},
    });

    render(<ResultTableHarness />);

    await waitFor(() =>
      expect(screen.getByTestId("result-table")).not.toBeNull(),
    );
    expect(screen.getByText("0 rows • 1 fields")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Loading data...")).toBeNull();
  });

  it("shows the error in both halves of the workbench", async () => {
    client.mutate.mockResolvedValue({
      status: "failed",
      code: "FETCH_COMPILE_FAILED",
      message: NO_DATA_MESSAGE,
      retryable: false,
      diagnosticId: "diag-1",
    });

    render(<WorkbenchHalvesHarness />);

    // Both halves render the error primitive with the host's message.
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    expect(screen.getAllByText(NO_DATA_MESSAGE)).toHaveLength(2);
    expect(screen.queryByText("Loading data...")).toBeNull();
  });
});
