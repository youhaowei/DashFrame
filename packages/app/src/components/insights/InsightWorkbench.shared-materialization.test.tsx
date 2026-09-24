import { nativeQueryMock, hostQueryMock } from "@/test/native-query-fixture";
import type { DataTable, Insight, UUID, Visualization } from "@dashframe/types";
import { render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";

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
import { InsightResultTable } from "./InsightWorkbench";

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

function SharedResultHarness() {
  const result = useInsightPagination({
    insight,
    showModelPreview: false,
  });
  return (
    <>
      <InsightResultTable result={result} />
      <VisualizationPreview
        visualization={visualization}
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

it("materializes once for the saved chart and attached result table", async () => {
  client.mutate.mockResolvedValue({
    status: "ready",
    dataFrameId: "shared-frame",
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
    rows: [{ Region: "APAC" }],
    totalCount: 1,
    page: {},
  });

  render(<SharedResultHarness />);

  await waitFor(() => expect(client.mutate).toHaveBeenCalledOnce());
  await waitFor(() => expect(queryDataFrame).toHaveBeenCalledOnce());
  expect(client.mutate).toHaveBeenCalledWith(
    expect.objectContaining({ _path: "runInsight" }),
    { insightId: insight.id },
  );
});
