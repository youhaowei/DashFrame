import {
  nativeMutationMock,
  nativeQueryMock,
} from "@/test/native-query-fixture";
import type { DataTable, Insight, InsightMetric, UUID } from "@dashframe/types";
import { cmd } from "@dashframe/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { commitBatch } = vi.hoisted(() => ({ commitBatch: vi.fn() }));

const tableId = "10000000-0000-4000-8000-000000000002" as UUID;
const revenue: InsightMetric = {
  id: "20000000-0000-4000-8000-000000000001" as UUID,
  name: "Revenue",
  sourceTable: tableId,
  columnName: "amount",
  aggregation: "sum",
};
const orders: InsightMetric = {
  id: "20000000-0000-4000-8000-000000000002" as UUID,
  name: "Orders",
  sourceTable: tableId,
  columnName: "order_id",
  aggregation: "count_distinct",
};
const margin: InsightMetric = {
  id: "20000000-0000-4000-8000-000000000003" as UUID,
  name: "Margin",
  sourceTable: tableId,
  columnName: "margin",
  aggregation: "avg",
};

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock(() => ({ data: [] })),
  useMutation: nativeMutationMock(() => ({ mutateAsync: commitBatch })),
}));
vi.mock("../sections/DataModelSection", () => ({
  DataModelSection: () => null,
}));
vi.mock("./FieldsSection", () => ({ FieldsSection: () => null }));
vi.mock("./FiltersSection", () => ({ FiltersSection: () => null }));
vi.mock("./SortSection", () => ({ SortSection: () => null }));
vi.mock("./MetricsSection", () => ({
  MetricsSection: ({
    onAdd,
    onEdit,
  }: {
    onAdd: (metric: InsightMetric) => Promise<void>;
    onEdit: (metric: InsightMetric) => Promise<void>;
  }) => (
    <>
      <button
        type="button"
        onClick={() => void onEdit({ ...revenue, name: "Net revenue" })}
      >
        Rename revenue
      </button>
      <button
        type="button"
        onClick={() =>
          void onEdit({
            ...orders,
            aggregation: "count",
            columnName: undefined,
          })
        }
      >
        Count all orders
      </button>
      <button type="button" onClick={() => void onAdd(margin)}>
        Add margin
      </button>
    </>
  ),
}));

import { InsightConfigPanel } from "./InsightConfigPanel";

const table = { id: tableId, name: "Orders", fields: [] } as DataTable;
const insight = {
  id: "10000000-0000-4000-8000-000000000001" as UUID,
  name: "Revenue",
  source: { sourceType: "dataTable", sourceId: tableId },
  selectedFields: [],
  metrics: [revenue, orders],
  createdAt: 0,
} satisfies Insight;

function renderPanel() {
  render(
    <InsightConfigPanel
      insight={insight}
      dataTable={table}
      allDataTables={[table]}
    />,
  );
}

describe("InsightConfigPanel metric saves", () => {
  beforeEach(() => {
    commitBatch.mockReset();
    commitBatch
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue({});
  });

  it("keeps a pending metric edit when another metric rebuilds the list", async () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Rename revenue" }));
    fireEvent.click(screen.getByRole("button", { name: "Count all orders" }));

    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));
    expect(commitBatch.mock.calls[1][0].commands).toContainEqual(
      cmd("AddMetric", {
        nodeId: insight.id,
        metric: { ...revenue, name: "Net revenue" },
      }),
    );
  });

  it("does not resend a pending metric add with the next save", async () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Add margin" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename revenue" }));

    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));
    const { id: _id, ...updates } = { ...revenue, name: "Net revenue" };
    expect(commitBatch.mock.calls[1][0].commands).toEqual([
      cmd("UpdateMetric", {
        nodeId: insight.id,
        metricId: revenue.id,
        updates,
      }),
    ]);
  });
});
