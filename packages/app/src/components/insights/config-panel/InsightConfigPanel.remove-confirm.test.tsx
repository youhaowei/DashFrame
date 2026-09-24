import {
  nativeMutationMock,
  nativeQueryMock,
} from "@/test/native-query-fixture";
import type { DataTable, Field, Insight, UUID } from "@dashframe/types";
import { cmd } from "@dashframe/types";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { commitBatch, queryState, usedBy } = vi.hoisted(() => ({
  commitBatch: vi.fn(),
  queryState: {
    current: { data: [] } as {
      data?: unknown[];
      isLoading?: boolean;
      isError?: boolean;
    },
  },
  usedBy: { current: [] as unknown[] },
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock(() => queryState.current),
  useMutation: nativeMutationMock(() => ({ mutateAsync: commitBatch })),
}));
vi.mock("../sections/DataModelSection", () => ({
  DataModelSection: () => null,
}));
vi.mock("./MetricsSection", () => ({ MetricsSection: () => null }));
vi.mock("./SortSection", () => ({ SortSection: () => null }));
vi.mock("./FiltersSection", () => ({ FiltersSection: () => null }));
vi.mock("./FieldsSection", () => ({
  FieldsSection: ({
    selectedFields,
    onReorder,
    onRemove,
  }: {
    selectedFields: Array<{ id: string; displayName: string }>;
    onReorder: (ids: string[]) => void;
    onRemove: (id: string) => void;
  }) => (
    <>
      {selectedFields.map((field) => (
        <button key={field.id} type="button" onClick={() => onRemove(field.id)}>
          Remove {field.displayName}
        </button>
      ))}
      <button
        type="button"
        onClick={() =>
          onReorder(selectedFields.map((field) => field.id).toReversed())
        }
      >
        Reverse fields
      </button>
    </>
  ),
}));
vi.mock("./DeleteConfirmDialog", () => ({
  DeleteConfirmDialog: ({
    isOpen,
    usageStatus,
  }: {
    isOpen: boolean;
    usageStatus: string;
  }) => (isOpen ? <div role="dialog" data-usage-status={usageStatus} /> : null),
  findVisualizationsUsingField: () => usedBy.current,
  findVisualizationsUsingMetric: () => usedBy.current,
  removeFromEncoding: (encoding: unknown) => encoding,
}));

import { InsightConfigPanel } from "./InsightConfigPanel";

const fieldId = "20000000-0000-4000-8000-000000000003" as UUID;
const tableId = "20000000-0000-4000-8000-000000000002" as UUID;
const field: Field = {
  id: fieldId,
  tableId,
  name: "Region",
  columnName: "region",
  type: "string",
};
const channelId = "20000000-0000-4000-8000-000000000004" as UUID;
const channel: Field = {
  id: channelId,
  tableId,
  name: "Channel",
  columnName: "channel",
  type: "string",
};
const marketId = "20000000-0000-4000-8000-000000000005" as UUID;
const market: Field = {
  id: marketId,
  tableId,
  name: "Market",
  columnName: "market",
  type: "string",
};
const table = {
  id: tableId,
  name: "Orders",
  fields: [field, channel, market],
} as DataTable;
const insight = {
  id: "20000000-0000-4000-8000-000000000001" as UUID,
  name: "Revenue",
  source: { sourceType: "dataTable", sourceId: tableId },
  selectedFields: [fieldId, channelId, marketId],
  metrics: [],
  createdAt: 0,
} satisfies Insight;

function removeRegion() {
  render(
    <InsightConfigPanel
      insight={insight}
      dataTable={table}
      allDataTables={[table]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove Region" }));
}

describe("InsightConfigPanel field removal", () => {
  beforeEach(() => {
    commitBatch.mockReset();
    commitBatch.mockResolvedValue({});
    queryState.current = { data: [] };
    usedBy.current = [];
  });

  it("removes a field no saved chart uses without confirming", async () => {
    removeRegion();
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("serializes two removals against the last successful selected-field list", async () => {
    let resolveFirst: (() => void) | undefined;
    commitBatch
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    render(
      <InsightConfigPanel
        insight={insight}
        dataTable={table}
        allDataTables={[table]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove Region" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Channel" }));
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    resolveFirst?.();
    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));

    expect(commitBatch).toHaveBeenNthCalledWith(1, {
      commands: [
        cmd("SelectFields", {
          id: insight.id,
          fieldIds: [channelId, marketId],
        }),
      ],
    });
    expect(commitBatch).toHaveBeenNthCalledWith(2, {
      commands: [cmd("SelectFields", { id: insight.id, fieldIds: [marketId] })],
    });
  });

  it("does not resurrect a removed field when a stale reorder is queued", async () => {
    let resolveFirst: (() => void) | undefined;
    commitBatch
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    render(
      <InsightConfigPanel
        insight={insight}
        dataTable={table}
        allDataTables={[table]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove Region" }));
    fireEvent.click(screen.getByRole("button", { name: "Reverse fields" }));
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    resolveFirst?.();
    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));

    expect(commitBatch).toHaveBeenNthCalledWith(2, {
      commands: [
        cmd("SelectFields", {
          id: insight.id,
          fieldIds: [marketId, channelId],
        }),
      ],
    });
  });

  it("rebuilds a queued removal from server fields after an earlier failure", async () => {
    commitBatch
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValue(undefined);
    render(
      <InsightConfigPanel
        insight={insight}
        dataTable={table}
        allDataTables={[table]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove Region" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Channel" }));
    await waitFor(() => expect(commitBatch).toHaveBeenCalledTimes(2));

    expect(commitBatch).toHaveBeenNthCalledWith(2, {
      commands: [
        cmd("SelectFields", {
          id: insight.id,
          fieldIds: [fieldId, marketId],
        }),
      ],
    });
  });

  it("confirms before removing a field a saved chart uses", () => {
    queryState.current = { data: [{ id: "chart" }] };
    usedBy.current = [{ id: "chart" }];
    removeRegion();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(commitBatch).not.toHaveBeenCalled();
  });

  it("blocks removal while a saved-chart encoding write is pending", () => {
    render(
      <InsightConfigPanel
        insight={insight}
        dataTable={table}
        allDataTables={[table]}
        getVisualizationWriteStatus={() => ({ pending: true, generation: 1 })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove Region" }));

    expect(commitBatch).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("rechecks saved-chart writes before a queued removal executes", async () => {
    let resolveFirst: (() => void) | undefined;
    let writeStatus = { pending: false, generation: 0 };
    const getVisualizationWriteStatus = () => writeStatus;
    commitBatch.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    render(
      <InsightConfigPanel
        insight={insight}
        dataTable={table}
        allDataTables={[table]}
        getVisualizationWriteStatus={getVisualizationWriteStatus}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove Region" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Channel" }));
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    writeStatus = { pending: true, generation: 1 };
    await act(async () => {
      resolveFirst?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(commitBatch).toHaveBeenCalledOnce();
  });

  it("rejects a queued removal when a chart write starts and settles first", async () => {
    let resolveFirst: (() => void) | undefined;
    let writeStatus = { pending: false, generation: 0 };
    commitBatch.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    render(
      <InsightConfigPanel
        insight={insight}
        dataTable={table}
        allDataTables={[table]}
        getVisualizationWriteStatus={() => writeStatus}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove Region" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Channel" }));
    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    writeStatus = { pending: true, generation: 1 };
    writeStatus = { pending: false, generation: 1 };
    await act(async () => {
      resolveFirst?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(commitBatch).toHaveBeenCalledOnce();
  });

  it("confirms while the saved charts are still loading", () => {
    queryState.current = { isLoading: true };
    removeRegion();
    expect(screen.getByRole("dialog").dataset.usageStatus).toBe("loading");
    expect(commitBatch).not.toHaveBeenCalled();
  });

  it("confirms when the saved charts failed to load", () => {
    queryState.current = { isError: true };
    removeRegion();
    expect(screen.getByRole("dialog").dataset.usageStatus).toBe("error");
    expect(commitBatch).not.toHaveBeenCalled();
  });
});
