import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import type { DataTable, InsightMetric } from "@dashframe/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  // Disabling Cancel is not enough: Escape and an outside click reach the
  // dialog shell's `onOpenChange` directly. Dismissing a pending save lets a
  // second editor open, and the first promise's `onClose` then closes *that*
  // one, discarding the edit.
  it.each([
    [
      "add-metric",
      (onOpenChange: () => void, onSave: () => Promise<void>) => (
        <InsightMetricEditorModal
          isOpen
          onOpenChange={onOpenChange}
          dataTable={table}
          onSave={onSave}
        />
      ),
      "Add metric",
      () => undefined,
    ],
    [
      "filter",
      (onOpenChange: () => void, onSave: () => Promise<void>) => (
        <FilterEditDialog
          filter="new"
          combinedFields={[field]}
          onOpenChange={onOpenChange}
          onSave={onSave}
        />
      ),
      "Add",
      () =>
        fireEvent.change(screen.getByLabelText("Value"), {
          target: { value: "100" },
        }),
    ],
    [
      "edit-metric",
      (onOpenChange: () => void, onSave: () => Promise<void>) => (
        <MetricEditDialog
          metric={metric}
          dataTable={table}
          onOpenChange={onOpenChange}
          onSave={onSave}
        />
      ),
      "Save",
      () =>
        fireEvent.change(screen.getByLabelText("Display name"), {
          target: { value: "Revenue" },
        }),
    ],
    [
      "field-rename",
      (onOpenChange: () => void, onSave: () => Promise<void>) => (
        <FieldRenameDialog
          field={field}
          onOpenChange={onOpenChange}
          onSave={onSave}
        />
      ),
      "Save",
      () =>
        fireEvent.change(screen.getByLabelText("Display name"), {
          target: { value: "Revenue" },
        }),
    ],
  ])(
    "ignores an Escape dismissal while the %s save is in flight",
    async (_name, renderDialog, submitLabel, prime) => {
      const onOpenChange = vi.fn();
      let release: () => void = () => undefined;
      const onSave = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );

      render(renderDialog(onOpenChange, onSave));

      prime();
      fireEvent.click(screen.getByRole("button", { name: submitLabel }));
      await waitFor(() => expect(onSave).toHaveBeenCalled());

      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: "Escape",
        code: "Escape",
      });
      expect(onOpenChange).not.toHaveBeenCalledWith(false);

      // Once the save settles the dialog closes normally.
      release();
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    },
  );

  // The column picker is hidden for "Count (rows)", so a column chosen under a
  // previous aggregation would be invisible state — and saving it emits
  // `count(column)`, which skips null rows and reports a smaller number than
  // the label promises. Driven through the rendered dialog rather than the
  // helpers, because the defect is the transition the user performs.
  it("drops a previously chosen column when switching back to Count (rows)", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <InsightMetricEditorModal
        isOpen
        onOpenChange={vi.fn()}
        dataTable={table}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByLabelText("Aggregation type"));
    await user.click(await screen.findByRole("option", { name: "Sum" }));

    await user.click(screen.getByLabelText("Field"));
    await user.click(
      await screen.findByRole("option", { name: "Amount (number)" }),
    );
    expect(screen.getByText("sum(amount)")).toBeTruthy();

    await user.click(screen.getByLabelText("Aggregation type"));
    await user.click(
      await screen.findByRole("option", { name: "Count (rows)" }),
    );

    expect(screen.getByText("count(*)")).toBeTruthy();

    // Switching away again must not resurrect the column: the picker comes
    // back empty, so the user re-chooses rather than inheriting hidden state.
    await user.click(screen.getByLabelText("Aggregation type"));
    await user.click(await screen.findByRole("option", { name: "Sum" }));
    expect(screen.getByText("Select a field")).toBeTruthy();
    expect(screen.getByText("sum(?)")).toBeTruthy();

    await user.click(screen.getByLabelText("Aggregation type"));
    await user.click(
      await screen.findByRole("option", { name: "Count (rows)" }),
    );

    await user.click(screen.getByRole("button", { name: "Add metric" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      aggregation: "count",
      columnName: undefined,
    });
  });

  // Defence in depth for the same defect: even if a caller reaches the helper
  // with a stale column, `count` is `count(*)` unconditionally, and the saved
  // payload matches the preview the user was shown.
  it("keeps a count metric's saved payload equal to its preview", () => {
    expect(metricFormulaPreview("count", "amount")).toBe("count(*)");
    expect(metricColumnNameForSave("count", "amount")).toBeUndefined();
  });
});
