import {
  nativeMutationMock,
  nativeQueryMocks,
} from "@/test/native-query-fixture";
import type {
  DataTable,
  Field,
  Insight,
  InsightMetric,
  UUID,
} from "@dashframe/types";
import { buildInsightUpdateCommands, cmd } from "@dashframe/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { commitBatch } = vi.hoisted(() => ({ commitBatch: vi.fn() }));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  ...nativeQueryMocks(() => ({ data: [] })),
  useMutation: nativeMutationMock(() => ({ mutateAsync: commitBatch })),
}));
vi.mock("../sections/DataModelSection", () => ({
  DataModelSection: () => null,
}));
vi.mock("./SortSection", () => ({ SortSection: () => null }));
vi.mock("./FiltersSection", () => ({ FiltersSection: () => null }));

import { InsightConfigPanel } from "./InsightConfigPanel";

const insightId = "40000000-0000-4000-8000-000000000001" as UUID;
const tableId = "40000000-0000-4000-8000-000000000002" as UUID;
const regionId = "40000000-0000-4000-8000-000000000003" as UUID;
const amountId = "40000000-0000-4000-8000-000000000004" as UUID;
const revenueId = "40000000-0000-4000-8000-000000000005" as UUID;
const region: Field = {
  id: regionId,
  tableId,
  name: "Region",
  columnName: "region",
  type: "string",
};
const amount: Field = {
  id: amountId,
  tableId,
  name: "Amount",
  columnName: "amount",
  type: "number",
};
const table = {
  id: tableId,
  name: "Orders",
  fields: [region, amount],
} as DataTable;
const revenue: InsightMetric = {
  id: revenueId,
  name: "Revenue",
  sourceTable: tableId,
  columnName: "amount",
  aggregation: "sum",
};
const insight = {
  id: insightId,
  name: "Sales",
  source: { sourceType: "dataTable", sourceId: tableId },
  selectedFields: [regionId],
  metrics: [revenue],
  createdAt: 0,
} satisfies Insight;

const offered = (kind: "dimensions" | "measures", id: UUID) =>
  cmd("SetInsightRuntimeControls", {
    id: insightId,
    runtimeControls: { [kind]: { allowedIds: [id], maxSelected: 1 } },
  });
const renameAndOfferField = {
  commands: [
    cmd("UpdateField", {
      nodeId: tableId,
      fieldId: regionId,
      updates: { name: "Area" },
    }),
    offered("dimensions", regionId),
  ],
};
const renameAndOfferMetric = {
  commands: [
    ...buildInsightUpdateCommands(insightId, insight, {
      metrics: [{ ...revenue, name: "Net revenue" }],
    }),
    offered("measures", revenueId),
  ],
};

function renderPanel() {
  render(
    <InsightConfigPanel
      insight={insight}
      dataTable={table}
      allDataTables={[table]}
    />,
  );
}

function editAndOffer(item: string, nameLabel: string, name: string) {
  fireEvent.click(screen.getByRole("button", { name: `Edit ${item}` }));
  fireEvent.change(screen.getByLabelText(nameLabel), {
    target: { value: name },
  });
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Viewers can show or hide" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
}

describe("saving a definition together with its viewer choice", () => {
  beforeEach(() => {
    commitBatch.mockReset();
    commitBatch.mockResolvedValue({});
    vi.stubGlobal("PointerEvent", MouseEvent);
  });

  it("writes a field's name and viewer choice in one batch", async () => {
    renderPanel();
    editAndOffer("Region", "Display name", "Area");

    await waitFor(() =>
      expect(screen.queryByLabelText("Display name")).toBeNull(),
    );
    expect(commitBatch).toHaveBeenCalledOnce();
    expect(commitBatch).toHaveBeenCalledWith(renameAndOfferField);
    expect(
      screen.getByRole("img", { name: "Viewers can show or hide Region" }),
    ).toBeTruthy();
  });

  it("saves nothing of a field when the write is rejected", async () => {
    commitBatch.mockRejectedValueOnce(new Error("write failed"));
    renderPanel();
    editAndOffer("Region", "Display name", "Area");

    expect(
      await screen.findByText("Failed to save field: write failed"),
    ).toBeTruthy();
    // One request carried both changes, so none of it was committed.
    expect(commitBatch).toHaveBeenCalledOnce();
    expect(commitBatch).toHaveBeenCalledWith(renameAndOfferField);
    // The chip shows the saved state: the old name, not offered to viewers.
    expect(screen.getByRole("button", { name: "Edit Region" })).toBeTruthy();
    expect(
      screen.queryByRole("img", { name: "Viewers can show or hide Region" }),
    ).toBeNull();
    // The editor keeps the unsaved draft, and a retry sends all of it again.
    expect(
      (screen.getByLabelText("Display name") as HTMLInputElement).value,
    ).toBe("Area");
    expect(
      screen
        .getByRole("checkbox", { name: "Viewers can show or hide" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.queryByLabelText("Display name")).toBeNull(),
    );
    expect(commitBatch).toHaveBeenCalledTimes(2);
    expect(commitBatch).toHaveBeenLastCalledWith(renameAndOfferField);
  });

  it("writes a field's grouping and viewer choice in one batch", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Edit Region" }));
    fireEvent.click(screen.getByRole("tab", { name: "Columns" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Viewers can show or hide" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(commitBatch).toHaveBeenCalledOnce());
    expect(commitBatch).toHaveBeenCalledWith({
      commands: [
        cmd("SetInsightReporting", {
          id: insightId,
          reporting: { dateGrains: {}, pivotFields: [regionId] },
        }),
        offered("dimensions", regionId),
      ],
    });
  });

  it("writes a metric's definition and viewer choice in one batch", async () => {
    renderPanel();
    editAndOffer("Revenue", "Name", "Net revenue");

    await waitFor(() => expect(screen.queryByLabelText("Name")).toBeNull());
    expect(commitBatch).toHaveBeenCalledOnce();
    expect(commitBatch).toHaveBeenCalledWith(renameAndOfferMetric);
    expect(
      screen.getByRole("img", { name: "Viewers can show or hide Revenue" }),
    ).toBeTruthy();
  });

  it("saves nothing of a metric when the write is rejected", async () => {
    commitBatch.mockRejectedValueOnce(new Error("write failed"));
    renderPanel();
    editAndOffer("Revenue", "Name", "Net revenue");

    expect(
      await screen.findByText("Failed to save metric: write failed"),
    ).toBeTruthy();
    expect(commitBatch).toHaveBeenCalledOnce();
    expect(commitBatch).toHaveBeenCalledWith(renameAndOfferMetric);
    expect(screen.getByRole("button", { name: "Edit Revenue" })).toBeTruthy();
    expect(
      screen.queryByRole("img", { name: "Viewers can show or hide Revenue" }),
    ).toBeNull();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Net revenue",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByLabelText("Name")).toBeNull());
    expect(commitBatch).toHaveBeenCalledTimes(2);
    expect(commitBatch).toHaveBeenLastCalledWith(renameAndOfferMetric);
  });
});
