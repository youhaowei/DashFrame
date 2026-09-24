import type { DataTable, InsightMetric } from "@dashframe/types";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MetricsSection } from "./MetricsSection";

const table = {
  id: "table-1",
  name: "Orders",
  fields: [
    { id: "field-1", name: "Amount", columnName: "amount", type: "number" },
  ],
} as DataTable;

const revenue = {
  id: "metric-1",
  name: "Revenue",
  sourceTable: table.id,
  columnName: "amount",
  aggregation: "sum",
} as InsightMetric;

function section(props: Partial<Parameters<typeof MetricsSection>[0]> = {}) {
  return (
    <MetricsSection
      metrics={[revenue]}
      dataTable={table}
      onReorder={vi.fn()}
      onRemove={vi.fn()}
      onAdd={vi.fn()}
      onEdit={vi.fn()}
      {...props}
    />
  );
}

describe("measure library in the metric editor", () => {
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it("adds a metric from a saved measure", async () => {
    const user = userEvent.setup({ delay: null });
    const onReuse = vi.fn().mockResolvedValue(undefined);
    const onAdd = vi.fn();
    render(
      section({
        savedMeasures: [{ id: "saved-orders", name: "Saved orders" }],
        onReuse,
        onAdd,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Add metric" }));
    await user.click(
      screen.getByRole("combobox", { name: "Start from a saved measure" }),
    );
    await user.click(
      await screen.findByRole("option", { name: "Saved orders" }),
    );

    await waitFor(() => expect(onReuse).toHaveBeenCalledWith("saved-orders"));
    expect(onAdd).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.queryByRole("combobox", { name: "Start from a saved measure" }),
      ).toBeNull(),
    );
  });

  it("saves a metric to the source only while its edits are saved", async () => {
    const user = userEvent.setup({ delay: null });
    const onSaveToSource = vi.fn().mockResolvedValue(undefined);
    render(section({ onSaveToSource }));

    await user.click(screen.getByRole("button", { name: "Edit Revenue" }));
    const saveToSource = screen.getByRole("button", { name: "Save to source" });

    // An unsaved rename would not reach the source, so the copy waits for it.
    await user.type(screen.getByLabelText("Name"), " total");
    expect(saveToSource.hasAttribute("disabled")).toBe(true);
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Revenue");

    await user.click(saveToSource);
    await waitFor(() =>
      expect(onSaveToSource).toHaveBeenCalledWith("metric-1"),
    );
  });

  it("shows no saved-measure picker without library actions", async () => {
    const user = userEvent.setup({ delay: null });
    render(section());

    await user.click(screen.getByRole("button", { name: "Add metric" }));
    expect(
      screen.queryByRole("combobox", { name: "Start from a saved measure" }),
    ).toBeNull();
  });

  it("keeps the editor open and explains a failed import", async () => {
    const user = userEvent.setup({ delay: null });
    const onReuse = vi.fn().mockRejectedValue(new Error("write failed"));
    render(
      section({
        savedMeasures: [{ id: "saved-orders", name: "Saved orders" }],
        onReuse,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Add metric" }));
    await user.click(
      screen.getByRole("combobox", { name: "Start from a saved measure" }),
    );
    await user.click(
      await screen.findByRole("option", { name: "Saved orders" }),
    );

    expect(
      await screen.findByText("Failed to add saved measure. Try again."),
    ).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Start from a saved measure" }),
    ).toBeTruthy();
  });

  it("waits for an unsaved viewer choice before saving to the source", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      section({
        onSaveToSource: vi.fn(),
        onViewerChange: vi.fn(),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Edit Revenue" }));
    await user.click(
      screen.getByRole("checkbox", { name: "Viewers can show or hide" }),
    );
    expect(
      screen
        .getByRole("button", { name: "Save to source" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("waits for an invalid draft before saving to the source", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      section({
        metrics: [
          {
            ...revenue,
            filters: [
              { id: "f1", field: "amount", operator: "gte", value: 10 },
            ],
          } as InsightMetric,
        ],
        onSaveToSource: vi.fn(),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Edit Revenue" }));
    await user.clear(screen.getByDisplayValue("10"));
    expect(
      screen
        .getByRole("button", { name: "Save to source" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});
