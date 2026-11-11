import {
  nativeMutationMock,
  nativeQueryMocks,
} from "@/test/native-query-fixture";
import type {
  DataTable,
  Field,
  Insight,
  UUID,
  Visualization,
} from "@dashframe/types";
import { cmd, fieldEncoding } from "@dashframe/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

const { commitBatch, toastError } = vi.hoisted(() => ({
  commitBatch: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  ...nativeQueryMocks(() => ({ data: [chart] })),
  useMutation: nativeMutationMock(() => ({ mutateAsync: commitBatch })),
}));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));
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

import { InsightConfigPanel } from "./InsightConfigPanel";

const fieldId = "30000000-0000-4000-8000-000000000003" as UUID;
const tableId = "30000000-0000-4000-8000-000000000002" as UUID;
const insightId = "30000000-0000-4000-8000-000000000001" as UUID;
const chartId = "30000000-0000-4000-8000-000000000004" as UUID;
const field: Field = {
  id: fieldId,
  tableId,
  name: "Region",
  columnName: "region",
  type: "string",
};
const table = { id: tableId, name: "Orders", fields: [field] } as DataTable;
const insight = {
  id: insightId,
  name: "Revenue",
  source: { sourceType: "dataTable", sourceId: tableId },
  selectedFields: [fieldId],
  metrics: [],
  createdAt: 0,
} satisfies Insight;
const chart = {
  id: chartId,
  name: "Revenue by region",
  insightId,
  visualizationType: "bar",
  encoding: { x: fieldEncoding(fieldId) },
} as Visualization;

function openDependencyDialog() {
  render(
    <InsightConfigPanel
      insight={insight}
      dataTable={table}
      allDataTables={[table]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove Region" }));
}

describe("InsightConfigPanel chart dependency failures", () => {
  const nativeAlert = vi.fn();

  beforeEach(() => {
    commitBatch.mockReset();
    commitBatch.mockRejectedValue(new Error("write failed"));
    toastError.mockReset();
    nativeAlert.mockReset();
    vi.stubGlobal("alert", nativeAlert);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("raises a toast when removing the field from a chart fails", async () => {
    openDependencyDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Failed to update visualization. Please try again.",
      ),
    );
    expect(commitBatch).toHaveBeenCalledWith({
      commands: [cmd("SetChartEncoding", { id: chartId, encoding: {} })],
    });
    expect(nativeAlert).not.toHaveBeenCalled();
    // The chart is still listed, and its actions are usable again.
    expect(screen.getByText("Revenue by region")).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Remove" }).hasAttribute("disabled"),
      ).toBe(false),
    );
  });

  it("raises a toast when deleting the chart fails", async () => {
    openDependencyDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Failed to delete visualization. Please try again.",
      ),
    );
    expect(commitBatch).toHaveBeenCalledWith({
      commands: [cmd("DeleteNode", { id: chartId })],
    });
    expect(nativeAlert).not.toHaveBeenCalled();
    expect(screen.getByText("Revenue by region")).toBeTruthy();
  });
});
