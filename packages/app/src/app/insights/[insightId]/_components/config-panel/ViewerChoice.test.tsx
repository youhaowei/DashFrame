import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import type { DataTable, InsightMetric } from "@dashframe/types";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { FieldsSection } from "./FieldsSection";
import { MetricsSection } from "./MetricsSection";

const table = {
  id: "table-1",
  name: "Orders",
  fields: [
    { id: "field-1", name: "Amount", columnName: "amount", type: "number" },
  ],
} as DataTable;

const amount = {
  id: "field-1",
  name: "Amount",
  displayName: "Amount",
  columnName: "amount",
  type: "number",
  sourceTableId: "table-1",
} as CombinedField;

const region = {
  id: "field-2",
  name: "Region",
  displayName: "Region",
  columnName: "region",
  type: "string",
  sourceTableId: "table-1",
} as CombinedField;

const metric = {
  id: "metric-1",
  name: "Total amount",
  sourceTable: table.id,
  columnName: "amount",
  aggregation: "sum",
} as InsightMetric;

function fields(props: Partial<Parameters<typeof FieldsSection>[0]> = {}) {
  return (
    <FieldsSection
      selectedFields={[amount]}
      availableFields={[region]}
      tables={[table]}
      baseTableId={table.id}
      onReorder={vi.fn()}
      onRemove={vi.fn()}
      onRename={vi.fn()}
      onAdd={vi.fn()}
      {...props}
    />
  );
}

describe("viewer choices on chips", () => {
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

  it("offers a field to viewers from its editor", async () => {
    const user = userEvent.setup({ delay: null });
    const onViewerChange = vi.fn().mockResolvedValue(undefined);
    const onRename = vi.fn();
    render(fields({ onViewerChange, onRename }));

    await user.click(screen.getByRole("button", { name: "Rename Amount" }));
    await user.click(
      screen.getByRole("checkbox", { name: "Viewers can show or hide" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onViewerChange).toHaveBeenCalledWith("field-1", true),
    );
    expect(onRename).not.toHaveBeenCalled();
  });

  it("marks viewer fields and lists ones the report hides by default", async () => {
    const user = userEvent.setup({ delay: null });
    const onViewerChange = vi.fn().mockResolvedValue(undefined);
    render(fields({ viewerFieldIds: ["field-1", "field-2"], onViewerChange }));

    expect(
      screen.getByRole("img", { name: "Viewers can show or hide Amount" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "Viewers can add Region" }),
    ).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "Stop offering Region to viewers" }),
    );
    expect(onViewerChange).toHaveBeenCalledWith("field-2", false);
  });

  it("adds a field as a viewer option without showing it", async () => {
    const user = userEvent.setup({ delay: null });
    const onViewerChange = vi.fn().mockResolvedValue(undefined);
    const onAdd = vi.fn();
    render(fields({ onViewerChange, onAdd }));

    await user.click(screen.getByRole("button", { name: "Add field" }));
    await user.click(
      screen.getByRole("switch", { name: "Offer to viewers only" }),
    );
    await user.click(screen.getByRole("option", { name: /Region/ }));

    expect(onViewerChange).toHaveBeenCalledWith("field-2", true);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("changes only the viewer choice when the metric itself is unchanged", async () => {
    const user = userEvent.setup({ delay: null });
    const onEdit = vi.fn();
    const onViewerChange = vi.fn().mockResolvedValue(undefined);
    render(
      <MetricsSection
        metrics={[metric]}
        dataTable={table}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
        onEdit={onEdit}
        viewerMetricIds={[metric.id]}
        onViewerChange={onViewerChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit Total amount" }));
    await user.click(
      screen.getByRole("checkbox", { name: "Viewers can show or hide" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onViewerChange).toHaveBeenCalledWith("metric-1", false),
    );
    expect(onEdit).not.toHaveBeenCalled();
  });
});
