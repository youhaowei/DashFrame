import {
  nativeMutationMock,
  nativeQueryMock,
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
  useQuery_experimental: nativeQueryMock(() => ({ data: [] })),
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
vi.mock("./FiltersSection", () => ({
  FiltersSection: ({
    onSave,
    onRemove,
    onReorder,
  }: {
    onSave: (
      filter: {
        id: string;
        _id: string;
        field: string;
        operator: "eq";
        value: string;
      },
      control: { filterId: string; key: string; label: string },
    ) => Promise<void>;
    onRemove: (filterId: string) => void;
    onReorder: (
      filters: Array<{
        id: string;
        _id: string;
        field: string;
        operator: "eq";
        value: string;
      }>,
    ) => void;
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
          onReorder([
            {
              id: "period",
              _id: "period",
              field: "period",
              operator: "eq",
              value: "Q1",
            },
            {
              id: "region",
              _id: "region",
              field: "region",
              operator: "eq",
              value: "EMEA",
            },
          ])
        }
      >
        Reorder filters
      </button>
      <button
        type="button"
        onClick={() =>
          void onSave(
            {
              id: "period",
              _id: "period",
              field: "period",
              operator: "eq",
              value: "Q2",
            },
            { filterId: "period", key: "period", label: "Period" },
          )
        }
      >
        Save second viewer filter
      </button>
      <button
        type="button"
        onClick={() =>
          void onSave(
            {
              id: "region",
              _id: "region",
              field: "region",
              operator: "eq",
              value: "APAC",
            },
            { filterId: "region", key: "region", label: "Region" },
          )
        }
      >
        Save unchanged viewer filter
      </button>
      <button
        type="button"
        onClick={() =>
          void onSave(
            {
              id: "region",
              _id: "region",
              field: "region",
              operator: "eq",
              value: "APAC",
            },
            {
              filterId: "region",
              key: "region",
              label: "Sales region",
            },
          )
        }
      >
        Edit first viewer filter
      </button>
    </>
  ),
}));

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

describe("InsightConfigPanel filter saves", () => {
  beforeEach(() => {
    commitBatch.mockReset();
    commitBatch.mockResolvedValue({});
    toastError.mockReset();
  });

  it("preserves the first viewer control when saving a second", async () => {
    render(
      <InsightConfigPanel
        insight={insight}
        dataTable={table}
        allDataTables={[table]}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save second viewer filter" }),
    );
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    expect(commitBatch.mock.calls[0][0].commands).toContainEqual({
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
    let resolveFirst: (() => void) | undefined;
    commitBatch
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue({});
    render(
      <InsightConfigPanel
        insight={insight}
        dataTable={table}
        allDataTables={[table]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save unchanged viewer filter" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save second viewer filter" }),
    );
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    resolveFirst?.();

    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));
    expect(commitBatch.mock.calls[1][0].commands).toContainEqual({
      path: "setInsightFilter",
      args: {
        id: insight.id,
        filters: [
          {
            id: "region",
            field: "region",
            operator: "eq",
            value: "APAC",
          },
          {
            id: "period",
            field: "period",
            operator: "eq",
            value: "Q2",
          },
        ],
      },
    });
  });

  it("keeps a pending filter save when removing another filter before its echo", async () => {
    let resolveFirst: (() => void) | undefined;
    commitBatch
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue({});
    render(
      <InsightConfigPanel
        insight={insight}
        dataTable={table}
        allDataTables={[table]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save unchanged viewer filter" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove second viewer filter" }),
    );
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    resolveFirst?.();

    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));
    expect(commitBatch.mock.calls[1][0].commands).toContainEqual({
      path: "setInsightFilter",
      args: {
        id: insight.id,
        filters: [
          {
            id: "region",
            field: "region",
            operator: "eq",
            value: "APAC",
          },
        ],
      },
    });
  });

  it("keeps a pending filter save when reordering before its echo", async () => {
    let resolveFirst: (() => void) | undefined;
    commitBatch
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue({});
    render(
      <InsightConfigPanel
        insight={insight}
        dataTable={table}
        allDataTables={[table]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save unchanged viewer filter" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reorder filters" }));
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    resolveFirst?.();

    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));
    expect(commitBatch.mock.calls[1][0].commands).toContainEqual({
      path: "setInsightFilter",
      args: {
        id: insight.id,
        filters: [
          { id: "period", field: "period", operator: "eq", value: "Q1" },
          {
            id: "region",
            field: "region",
            operator: "eq",
            value: "APAC",
          },
        ],
      },
    });
  });

  it("removes from the echoed list after an earlier filter save fails", async () => {
    let rejectFirst: ((error: Error) => void) | undefined;
    commitBatch
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValue({});
    render(
      <InsightConfigPanel
        insight={insight}
        dataTable={table}
        allDataTables={[table]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save unchanged viewer filter" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove second viewer filter" }),
    );
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    rejectFirst?.(new Error("write failed"));

    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));
    expect(commitBatch.mock.calls[1][0].commands).toContainEqual({
      path: "setInsightFilter",
      args: {
        id: insight.id,
        filters: [
          {
            id: "region",
            field: "region",
            operator: "eq",
            value: "EMEA",
          },
        ],
      },
    });
  });

  it("does not resurrect a removed filter when a stale reorder follows", async () => {
    let resolveFirst: (() => void) | undefined;
    commitBatch
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue({});
    render(
      <InsightConfigPanel
        insight={insight}
        dataTable={table}
        allDataTables={[table]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Remove second viewer filter" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reorder filters" }));
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    resolveFirst?.();

    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));
    expect(commitBatch.mock.calls[1][0].commands).toContainEqual({
      path: "setInsightFilter",
      args: {
        id: insight.id,
        filters: [
          {
            id: "region",
            field: "region",
            operator: "eq",
            value: "EMEA",
          },
        ],
      },
    });
  });

  it("preserves a viewer-control edit while saving a filter before its echo", async () => {
    let resolveFirst: (() => void) | undefined;
    commitBatch
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({});
    render(
      <InsightConfigPanel
        insight={insight}
        dataTable={table}
        allDataTables={[table]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save viewer controls" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save second viewer filter" }),
    );

    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));
    expect(commitBatch.mock.calls[1][0].commands).toContainEqual({
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
    resolveFirst?.();
  });

  it("preserves a pending limit while removing its filter before the echo", async () => {
    let resolveFirst: (() => void) | undefined;
    commitBatch
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({});
    render(
      <InsightConfigPanel
        insight={insight}
        dataTable={table}
        allDataTables={[table]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save viewer controls" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove first viewer filter" }),
    );

    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));
    expect(commitBatch.mock.calls[1][0].commands).toContainEqual({
      path: "setInsightFilter",
      args: {
        id: insight.id,
        filters: [
          { id: "period", field: "period", operator: "eq", value: "Q1" },
        ],
      },
    });
    expect(commitBatch.mock.calls[1][0].commands).toContainEqual({
      path: "setInsightRuntimeControls",
      args: {
        id: insight.id,
        runtimeControls: {
          limit: { min: 1, max: 100 },
        },
      },
    });
    resolveFirst?.();
  });

  it("rolls a failed viewer-control write back to the latest echoed value", async () => {
    let resolveFirst: (() => void) | undefined;
    let rejectSecond: ((error: Error) => void) | undefined;
    commitBatch
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectSecond = reject;
          }),
      )
      .mockResolvedValue({});
    const { rerender } = render(
      <InsightConfigPanel
        insight={insight}
        dataTable={table}
        allDataTables={[table]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save second viewer filter" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save viewer controls" }),
    );
    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));
    resolveFirst?.();
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
    rejectSecond?.(new Error("write failed"));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Failed to update viewer controls",
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Edit first viewer filter" }),
    );
    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(3));
    expect(commitBatch.mock.calls[2][0].commands).toContainEqual({
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
    render(
      <InsightConfigPanel
        insight={insight}
        dataTable={table}
        allDataTables={[table]}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save unchanged viewer filter" }),
    );
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    expect(commitBatch.mock.calls[0][0].commands).toHaveLength(1);
    expect(commitBatch.mock.calls[0][0].commands[0].path).toBe(
      "setInsightFilter",
    );
  });

  it("replaces an edited viewer control without moving it", async () => {
    const insightWithTwoControls: Insight = {
      ...insight,
      runtimeControls: {
        filters: [
          { filterId: "region", key: "region", label: "Region" },
          { filterId: "period", key: "period", label: "Period" },
        ],
      },
    };
    render(
      <InsightConfigPanel
        insight={insightWithTwoControls}
        dataTable={table}
        allDataTables={[table]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Edit first viewer filter" }),
    );
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    expect(commitBatch.mock.calls[0][0].commands).toContainEqual({
      path: "setInsightRuntimeControls",
      args: {
        id: insight.id,
        runtimeControls: {
          filters: [
            {
              filterId: "region",
              key: "region",
              label: "Sales region",
            },
            { filterId: "period", key: "period", label: "Period" },
          ],
        },
      },
    });
  });

  it("reports a rejected runtime-control write", async () => {
    commitBatch.mockRejectedValueOnce(new Error("write failed"));
    render(
      <InsightConfigPanel
        insight={insight}
        dataTable={table}
        allDataTables={[table]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save viewer controls" }),
    );

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Failed to update viewer controls",
      ),
    );
  });
});
