import {
  nativeMutationMock,
  nativeQueryMock,
} from "@/test/native-query-fixture";
import type {
  DataTable,
  Insight,
  InsightMetric,
  InsightRuntimeDeclaration,
  UUID,
} from "@dashframe/types";
import { cmd } from "@dashframe/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

const { commitBatch, metricEditError } = vi.hoisted(() => ({
  commitBatch: vi.fn(),
  metricEditError: vi.fn(),
}));

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
vi.mock("./SortSection", () => ({
  SortSection: ({
    onRuntimeChange,
  }: {
    onRuntimeChange: (value: InsightRuntimeDeclaration) => Promise<boolean>;
  }) => (
    <button
      type="button"
      onClick={() =>
        void onRuntimeChange({
          sort: { allowedFieldIds: [margin.id, revenue.id], maxKeys: 1 },
          limit: { min: 1, max: 50 },
        })
      }
    >
      Save viewer limit
    </button>
  ),
}));
vi.mock("./MetricsSection", () => ({
  MetricsSection: ({
    onAdd,
    onEdit,
    onRemove,
  }: {
    onAdd: (metric: InsightMetric) => Promise<void>;
    onEdit: (metric: InsightMetric) => Promise<void>;
    onRemove: (metricId: string) => void;
  }) => (
    <>
      <button type="button" onClick={() => onRemove(margin.id)}>
        Remove margin
      </button>
      <button
        type="button"
        onClick={() =>
          onEdit({ ...margin, name: "Gross margin" }).catch(metricEditError)
        }
      >
        Rename margin
      </button>
      <button
        type="button"
        onClick={() =>
          onEdit({ ...revenue, name: "Net revenue" }).catch(() => {})
        }
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

const savedMetric = {
  id: "saved-orders",
  name: "Saved orders",
  tableId,
  aggregation: "count" as const,
  format: { style: "number" as const, decimals: 0 },
};
const table = {
  id: tableId,
  name: "Orders",
  fields: [],
  metrics: [savedMetric],
} as DataTable;
const insight = {
  id: "10000000-0000-4000-8000-000000000001" as UUID,
  name: "Revenue",
  source: { sourceType: "dataTable", sourceId: tableId },
  selectedFields: [],
  metrics: [revenue, orders],
  createdAt: 0,
} satisfies Insight;

function renderPanel(value: Insight = insight) {
  render(
    <InsightConfigPanel
      insight={value}
      dataTable={table}
      allDataTables={[table]}
    />,
  );
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("InsightConfigPanel metric saves", () => {
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    commitBatch.mockReset();
    metricEditError.mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("imports a library measure and updates an explicit output selection atomically", async () => {
    commitBatch.mockResolvedValue({});
    renderPanel({
      ...insight,
      reporting: { measureIds: [revenue.id], totals: true },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reuse measure · 0" }));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Saved orders" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply", exact: true }));
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    const commands = commitBatch.mock.calls[0][0].commands;
    expect(commands).toHaveLength(2);
    const imported = commands[0].args.metric;
    expect(imported).toMatchObject({
      name: savedMetric.name,
      sourceTable: tableId,
      format: savedMetric.format,
    });
    expect(imported.id).not.toBe(savedMetric.id);
    expect(commands[1]).toEqual(
      cmd("SetInsightReporting", {
        id: insight.id,
        reporting: { measureIds: [revenue.id, imported.id], totals: true },
      }),
    );
  });

  it("saves a reusable source definition without mutating the report", async () => {
    commitBatch.mockResolvedValue({});
    renderPanel();
    fireEvent.click(
      screen.getByRole("button", { name: "Save measure to source · 0" }),
    );
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Revenue", exact: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply", exact: true }));
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    const commands = commitBatch.mock.calls[0][0].commands;
    expect(commands).toHaveLength(1);
    expect(commands[0].args).toMatchObject({
      nodeId: tableId,
      metric: {
        name: "Revenue",
        tableId,
        columnName: "amount",
        aggregation: "sum",
      },
    });
    expect(commands[0].args.metric.id).not.toBe(revenue.id);
    expect(commands[0].args.metric.sourceTable).toBeUndefined();
  });

  it("keeps an earlier metric edit when another metric rebuilds the list", async () => {
    const first = deferred();
    commitBatch
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({});
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Rename revenue" }));
    fireEvent.click(screen.getByRole("button", { name: "Count all orders" }));
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    first.resolve();

    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));
    expect(commitBatch.mock.calls[1][0].commands).toContainEqual(
      cmd("AddMetric", {
        nodeId: insight.id,
        metric: { ...revenue, name: "Net revenue" },
      }),
    );
  });

  it("does not resend an earlier metric add with the next save", async () => {
    commitBatch.mockResolvedValue({});
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

  it("resends a failed metric edit when it is retried", async () => {
    const first = deferred();
    commitBatch
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({});
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Rename revenue" }));
    fireEvent.click(screen.getByRole("button", { name: "Add margin" }));
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    first.reject(new Error("write failed"));
    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));
    expect(commitBatch.mock.calls[1][0].commands).toEqual([
      cmd("AddMetric", { nodeId: insight.id, metric: margin }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Rename revenue" }));
    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(3));
    const { id: _id, ...updates } = { ...revenue, name: "Net revenue" };
    expect(commitBatch.mock.calls[2][0].commands).toEqual([
      cmd("UpdateMetric", {
        nodeId: insight.id,
        metricId: revenue.id,
        updates,
      }),
    ]);
  });

  it("queues a metric removal behind pending metric saves", async () => {
    const first = deferred();
    commitBatch
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({});
    renderPanel({ ...insight, metrics: [revenue, orders, margin] });

    fireEvent.click(screen.getByRole("button", { name: "Rename revenue" }));
    fireEvent.click(screen.getByRole("button", { name: "Count all orders" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove margin" }));
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    first.resolve();

    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(3));
    expect(commitBatch.mock.calls[1][0].commands).toContainEqual(
      cmd("AddMetric", { nodeId: insight.id, metric: margin }),
    );
    expect(commitBatch.mock.calls[2][0].commands).toEqual([
      cmd("RemoveMetric", { nodeId: insight.id, metricId: margin.id }),
    ]);
  });

  it("prunes viewer controls from a queued removal when it runs", async () => {
    const first = deferred();
    commitBatch
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({});
    renderPanel({
      ...insight,
      metrics: [revenue, orders, margin],
      runtimeControls: {
        sort: { allowedFieldIds: [margin.id, revenue.id], maxKeys: 1 },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Rename revenue" }));
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Remove margin" }));
    fireEvent.click(screen.getByRole("button", { name: "Save viewer limit" }));
    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));
    expect(commitBatch.mock.calls[1][0].commands[0].path).toBe(
      "setInsightRuntimeControls",
    );
    first.resolve();

    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(3));
    expect(commitBatch.mock.calls[2][0].commands).toEqual([
      cmd("RemoveMetric", { nodeId: insight.id, metricId: margin.id }),
      cmd("SetInsightRuntimeControls", {
        id: insight.id,
        runtimeControls: {
          sort: { allowedFieldIds: [revenue.id], maxKeys: 1 },
          limit: { min: 1, max: 50 },
        },
      }),
    ]);
  });

  it("retains a failed metric removal and emits a real removal when retried", async () => {
    const first = deferred();
    commitBatch
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({});
    renderPanel({ ...insight, metrics: [revenue, orders, margin] });

    fireEvent.click(screen.getByRole("button", { name: "Remove margin" }));
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    first.reject(new Error("write failed"));
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

    fireEvent.click(screen.getByRole("button", { name: "Remove margin" }));
    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(3));
    expect(commitBatch.mock.calls[2][0].commands).toEqual([
      cmd("RemoveMetric", { nodeId: insight.id, metricId: margin.id }),
    ]);
  });

  it("rejects an edit queued after the metric was removed", async () => {
    const removal = deferred();
    commitBatch.mockImplementationOnce(() => removal.promise);
    renderPanel({ ...insight, metrics: [revenue, orders, margin] });

    fireEvent.click(screen.getByRole("button", { name: "Remove margin" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename margin" }));
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    removal.resolve();

    await waitFor(() => expect(metricEditError).toHaveBeenCalledOnce());
    expect(metricEditError).toHaveBeenCalledWith(
      new Error("Metric no longer exists"),
    );
    expect(commitBatch).toHaveBeenCalledOnce();
  });
});
