import {
  nativeMutationMock,
  nativeQueryMocks,
} from "@/test/native-query-fixture";
import type { DataTable, Insight, UUID } from "@dashframe/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { commitBatch, toastError } = vi.hoisted(() => ({
  commitBatch: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  ...nativeQueryMocks(() => ({ data: [] })),
  useMutation: nativeMutationMock(() => ({ mutateAsync: commitBatch })),
}));
vi.mock("../sections/DataModelSection", () => ({
  DataModelSection: () => null,
}));
vi.mock("./FieldsSection", () => ({
  FieldsSection: () => null,
}));
vi.mock("./MetricsSection", () => ({
  MetricsSection: () => null,
}));
vi.mock("./SortSection", () => ({
  SortSection: ({
    onRuntimeChange,
  }: {
    onRuntimeChange: (value: {
      filters: Array<{ filterId: string; key: string; label: string }>;
      limit: { min: number; max: number };
    }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onRuntimeChange({
          filters: [{ filterId: "region", key: "region", label: "Region" }],
          limit: { min: 1, max: 100 },
        })
      }
    >
      Save viewer controls
    </button>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("./DeleteConfirmDialog", () => ({
  DeleteConfirmDialog: () => null,
  findVisualizationsUsingField: () => [],
  findVisualizationsUsingMetric: () => [],
  removeFromEncoding: (encoding: unknown) => encoding,
}));
vi.mock("./FiltersSection", () => {
  type MockFilter = {
    id: string;
    _id: string;
    field: string;
    operator: "eq";
    value: string;
  };
  const filter = (id: string, value: string): MockFilter => ({
    id,
    _id: id,
    field: id,
    operator: "eq",
    value,
  });
  return {
    FiltersSection: ({
      onSave,
      onRemove,
      onReorder,
    }: {
      onSave: (
        filter: MockFilter,
        control: { filterId: string; key: string; label: string },
      ) => Promise<void>;
      onRemove: (filterId: string) => void;
      onReorder: (filters: MockFilter[]) => void;
    }) => (
      <>
        <button type="button" onClick={() => onRemove("region")}>
          Remove first viewer filter
        </button>
        <button type="button" onClick={() => onRemove("period")}>
          Remove second viewer filter
        </button>
        <button
          type="button"
          onClick={() =>
            onReorder([filter("period", "Q1"), filter("region", "EMEA")])
          }
        >
          Reorder filters
        </button>
        <button
          type="button"
          onClick={() =>
            void onSave(filter("period", "Q2"), {
              filterId: "period",
              key: "period",
              label: "Period",
            })
          }
        >
          Save second viewer filter
        </button>
        <button
          type="button"
          onClick={() =>
            void onSave(filter("region", "APAC"), {
              filterId: "region",
              key: "region",
              label: "Region",
            })
          }
        >
          Save unchanged viewer filter
        </button>
        <button
          type="button"
          onClick={() =>
            void onSave(filter("region", "APAC"), {
              filterId: "region",
              key: "region",
              label: "Sales region",
            })
          }
        >
          Edit first viewer filter
        </button>
      </>
    ),
  };
});

import { InsightConfigPanel } from "./InsightConfigPanel";

const table = {
  id: "10000000-0000-4000-8000-000000000002" as UUID,
  name: "Orders",
  fields: [],
} as DataTable;
const insight = {
  id: "10000000-0000-4000-8000-000000000001" as UUID,
  name: "Revenue",
  source: { sourceType: "dataTable", sourceId: table.id },
  selectedFields: [],
  metrics: [],
  filters: [
    { id: "region", field: "region", operator: "eq", value: "EMEA" },
    { id: "period", field: "period", operator: "eq", value: "Q1" },
  ],
  runtimeControls: {
    filters: [{ filterId: "region", key: "region", label: "Region" }],
  },
  createdAt: 0,
} satisfies Insight;

function renderPanel(panelInsight: Insight = insight) {
  return render(
    <InsightConfigPanel
      insight={panelInsight}
      dataTable={table}
      allDataTables={[table]}
    />,
  );
}

function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

/** Holds the next commit open until the test settles it. */
function holdNextCommit() {
  const commit: {
    resolve?: () => void;
    reject?: (error: Error) => void;
  } = {};
  commitBatch.mockImplementationOnce(
    () =>
      new Promise<void>((resolve, reject) => {
        commit.resolve = resolve;
        commit.reject = reject;
      }),
  );
  return commit;
}

function commandsOfCall(index: number) {
  return commitBatch.mock.calls[index][0].commands;
}

describe("InsightConfigPanel filter saves", () => {
  beforeEach(() => {
    commitBatch.mockReset();
    commitBatch.mockResolvedValue({});
    toastError.mockReset();
  });

  it("preserves the first viewer control when saving a second", async () => {
    renderPanel();
    click("Save second viewer filter");
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    expect(commandsOfCall(0)).toContainEqual({
      path: "setInsightRuntimeControls",
      args: {
        id: insight.id,
        runtimeControls: {
          filters: [
            { filterId: "region", key: "region", label: "Region" },
            { filterId: "period", key: "period", label: "Period" },
          ],
        },
      },
    });
  });

  it("keeps the first rapid filter save when the second starts before its echo", async () => {
    const first = holdNextCommit();
    renderPanel();

    click("Save unchanged viewer filter");
    click("Save second viewer filter");
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    first.resolve?.();

    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));
    expect(commandsOfCall(1)).toContainEqual({
      path: "setInsightFilter",
      args: {
        id: insight.id,
        filters: [
          { id: "region", field: "region", operator: "eq", value: "APAC" },
          { id: "period", field: "period", operator: "eq", value: "Q2" },
        ],
      },
    });
  });

  it("keeps a pending filter save when removing another filter before its echo", async () => {
    const first = holdNextCommit();
    renderPanel();

    click("Save unchanged viewer filter");
    click("Remove second viewer filter");
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    first.resolve?.();

    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));
    expect(commandsOfCall(1)).toContainEqual({
      path: "setInsightFilter",
      args: {
        id: insight.id,
        filters: [
          { id: "region", field: "region", operator: "eq", value: "APAC" },
        ],
      },
    });
  });

  it("keeps a pending filter save when reordering before its echo", async () => {
    const first = holdNextCommit();
    renderPanel();

    click("Save unchanged viewer filter");
    click("Reorder filters");
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    first.resolve?.();

    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));
    expect(commandsOfCall(1)).toContainEqual({
      path: "setInsightFilter",
      args: {
        id: insight.id,
        filters: [
          { id: "period", field: "period", operator: "eq", value: "Q1" },
          { id: "region", field: "region", operator: "eq", value: "APAC" },
        ],
      },
    });
  });

  it("removes from the echoed list after an earlier filter save fails", async () => {
    const first = holdNextCommit();
    renderPanel();

    click("Save unchanged viewer filter");
    click("Remove second viewer filter");
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    first.reject?.(new Error("write failed"));

    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));
    expect(commandsOfCall(1)).toContainEqual({
      path: "setInsightFilter",
      args: {
        id: insight.id,
        filters: [
          { id: "region", field: "region", operator: "eq", value: "EMEA" },
        ],
      },
    });
  });

  it("does not resurrect a removed filter when a stale reorder follows", async () => {
    const first = holdNextCommit();
    renderPanel();

    click("Remove second viewer filter");
    click("Reorder filters");
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    first.resolve?.();

    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));
    expect(commandsOfCall(1)).toContainEqual({
      path: "setInsightFilter",
      args: {
        id: insight.id,
        filters: [
          { id: "region", field: "region", operator: "eq", value: "EMEA" },
        ],
      },
    });
  });

  it("preserves a viewer-control edit while saving a filter before its echo", async () => {
    const first = holdNextCommit();
    renderPanel();

    click("Save viewer controls");
    click("Save second viewer filter");

    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));
    expect(commandsOfCall(1)).toContainEqual({
      path: "setInsightRuntimeControls",
      args: {
        id: insight.id,
        runtimeControls: {
          filters: [
            { filterId: "region", key: "region", label: "Region" },
            { filterId: "period", key: "period", label: "Period" },
          ],
          limit: { min: 1, max: 100 },
        },
      },
    });
    first.resolve?.();
  });

  it("preserves a pending limit while removing its filter before the echo", async () => {
    const first = holdNextCommit();
    renderPanel();

    click("Save viewer controls");
    click("Remove first viewer filter");

    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));
    expect(commandsOfCall(1)).toContainEqual({
      path: "setInsightFilter",
      args: {
        id: insight.id,
        filters: [
          { id: "period", field: "period", operator: "eq", value: "Q1" },
        ],
      },
    });
    expect(commandsOfCall(1)).toContainEqual({
      path: "setInsightRuntimeControls",
      args: {
        id: insight.id,
        runtimeControls: {
          limit: { min: 1, max: 100 },
        },
      },
    });
    first.resolve?.();
  });

  it("rolls a failed viewer-control write back to the latest echoed value", async () => {
    const first = holdNextCommit();
    const second = holdNextCommit();
    const { rerender } = renderPanel();

    click("Save second viewer filter");
    click("Save viewer controls");
    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));
    first.resolve?.();
    rerender(
      <InsightConfigPanel
        insight={{
          ...insight,
          filters: [
            { id: "region", field: "region", operator: "eq", value: "EMEA" },
            { id: "period", field: "period", operator: "eq", value: "Q2" },
          ],
          runtimeControls: {
            filters: [
              { filterId: "region", key: "region", label: "Region" },
              { filterId: "period", key: "period", label: "Period" },
            ],
          },
        }}
        dataTable={table}
        allDataTables={[table]}
      />,
    );
    second.reject?.(new Error("write failed"));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Failed to update viewer controls",
      ),
    );

    click("Edit first viewer filter");
    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(3));
    expect(commandsOfCall(2)).toContainEqual({
      path: "setInsightRuntimeControls",
      args: {
        id: insight.id,
        runtimeControls: {
          filters: [
            { filterId: "region", key: "region", label: "Sales region" },
            { filterId: "period", key: "period", label: "Period" },
          ],
        },
      },
    });
  });

  it("does not write runtime controls when their declaration is unchanged", async () => {
    renderPanel();
    click("Save unchanged viewer filter");
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    expect(commandsOfCall(0)).toHaveLength(1);
    expect(commandsOfCall(0)[0].path).toBe("setInsightFilter");
  });

  it("replaces an edited viewer control without moving it", async () => {
    renderPanel({
      ...insight,
      runtimeControls: {
        filters: [
          { filterId: "region", key: "region", label: "Region" },
          { filterId: "period", key: "period", label: "Period" },
        ],
      },
    });

    click("Edit first viewer filter");
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    expect(commandsOfCall(0)).toContainEqual({
      path: "setInsightRuntimeControls",
      args: {
        id: insight.id,
        runtimeControls: {
          filters: [
            { filterId: "region", key: "region", label: "Sales region" },
            { filterId: "period", key: "period", label: "Period" },
          ],
        },
      },
    });
  });
});
