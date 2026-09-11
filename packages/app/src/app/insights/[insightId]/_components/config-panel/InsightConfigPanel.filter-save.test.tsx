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
    onRuntimeChange: (value: { limit: { min: number; max: number } }) => void;
  }) => (
    <button
      type="button"
      onClick={() => onRuntimeChange({ limit: { min: 1, max: 100 } })}
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
  }) => (
    <>
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
  baseTableId: table.id,
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
