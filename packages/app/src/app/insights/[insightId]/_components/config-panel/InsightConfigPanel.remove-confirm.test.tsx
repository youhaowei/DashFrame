import {
  nativeMutationMock,
  nativeQueryMock,
} from "@/test/native-query-fixture";
import type { DataTable, Field, Insight, UUID } from "@dashframe/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  FieldsSection: ({ onRemove }: { onRemove: (id: string) => void }) => (
    <button type="button" onClick={() => onRemove(fieldId)}>
      Remove Region
    </button>
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
const table = { id: tableId, name: "Orders", fields: [field] } as DataTable;
const insight = {
  id: "20000000-0000-4000-8000-000000000001" as UUID,
  name: "Revenue",
  source: { sourceType: "dataTable", sourceId: tableId },
  selectedFields: [fieldId],
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

  it("confirms before removing a field a saved chart uses", () => {
    queryState.current = { data: [{ id: "chart" }] };
    usedBy.current = [{ id: "chart" }];
    removeRegion();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(commitBatch).not.toHaveBeenCalled();
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
