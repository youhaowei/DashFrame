import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import type { DataTable, InsightMetric } from "@dashframe/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FieldRenameDialog } from "./FieldRenameDialog";
import { FilterEditDialog } from "./FilterEditDialog";
import {
  InsightMetricEditorModal,
  metricColumnNameForSave,
  metricFormulaPreview,
} from "./InsightMetricEditorModal";
import { MetricEditDialog } from "./MetricEditDialog";

const table = {
  id: "table-1",
  name: "Orders",
  fields: [
    {
      id: "field-1",
      name: "Amount",
      columnName: "amount",
      type: "number",
    },
  ],
} as DataTable;

const field = {
  id: "field-1",
  name: "Amount",
  displayName: "Amount",
  columnName: "amount",
  type: "number",
  sourceTableId: "table-1",
} as CombinedField;

const metric = {
  id: "metric-1",
  name: "Total amount",
  sourceTable: table.id,
  columnName: "amount",
  aggregation: "sum",
} as InsightMetric;

const rejectedSave = () => Promise.reject(new Error("write failed"));

describe("insight config dialog saves", () => {
  it("keeps the add-metric dialog open and reports a rejected save", async () => {
    const onOpenChange = vi.fn();

    render(
      <InsightMetricEditorModal
        isOpen
        onOpenChange={onOpenChange}
        dataTable={table}
        onSave={rejectedSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add metric" }));

    expect(
      await screen.findByText("Failed to save metric: write failed"),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Add metric" })).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("keeps the edit-metric dialog open and reports a rejected save", async () => {
    const onOpenChange = vi.fn();

    render(
      <MetricEditDialog
        metric={metric}
        dataTable={table}
        onOpenChange={onOpenChange}
        onSave={rejectedSave}
      />,
    );

    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Revenue" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Failed to save metric: write failed"),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Edit metric" })).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("keeps the filter dialog open and reports a rejected save", async () => {
    const onOpenChange = vi.fn();

    render(
      <FilterEditDialog
        filter="new"
        combinedFields={[field]}
        onOpenChange={onOpenChange}
        onSave={rejectedSave}
      />,
    );

    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(
      await screen.findByText("Failed to save filter: write failed"),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Add filter" })).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("keeps the field-rename dialog open and reports a rejected save", async () => {
    const onOpenChange = vi.fn();

    render(
      <FieldRenameDialog
        field={field}
        onOpenChange={onOpenChange}
        onSave={rejectedSave}
      />,
    );

    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Revenue" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Failed to rename field: write failed"),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Rename field" })).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("keeps a count metric's saved payload equal to its preview", () => {
    expect(metricFormulaPreview("count", "amount")).toBe("count(amount)");
    expect(metricColumnNameForSave("count", "amount")).toBe("amount");
  });
});
