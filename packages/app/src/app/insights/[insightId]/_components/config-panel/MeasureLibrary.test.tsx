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

  it("offers no library actions where the source can't hold them", async () => {
    const user = userEvent.setup({ delay: null });
    render(section());

    await user.click(screen.getByRole("button", { name: "Add metric" }));
    expect(
      screen.queryByRole("combobox", { name: "Start from a saved measure" }),
    ).toBeNull();
  });
});
