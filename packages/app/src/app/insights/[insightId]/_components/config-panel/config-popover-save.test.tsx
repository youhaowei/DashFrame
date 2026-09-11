import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import type { DataTable, InsightMetric } from "@dashframe/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { FieldsSection } from "./FieldsSection";
import { FiltersSection } from "./FiltersSection";
import { metricColumnNameForSave } from "./metric-formula";
import { MetricsSection } from "./MetricsSection";

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

function metrics(
  onAdd = vi.fn(),
  onEdit = vi.fn(),
  values: InsightMetric[] = [],
) {
  return (
    <MetricsSection
      metrics={values}
      dataTable={table}
      onReorder={vi.fn()}
      onRemove={vi.fn()}
      onAdd={onAdd}
      onEdit={onEdit}
    />
  );
}

describe("insight config popover saves", () => {
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

  it("keeps the add-metric popover open and reports a rejected save", async () => {
    render(metrics(rejectedSave));
    fireEvent.click(screen.getByRole("button", { name: "Add metric" }));
    const submit = screen
      .getAllByRole("button", { name: "Add metric" })
      .at(-1)!;
    fireEvent.click(submit);
    expect(
      await screen.findByText("Failed to save metric: write failed"),
    ).toBeTruthy();
    expect(screen.getByLabelText("Aggregation")).toBeTruthy();
  });

  it("keeps the edit-metric popover open and reports a rejected save", async () => {
    render(metrics(vi.fn(), rejectedSave, [metric]));
    fireEvent.click(screen.getByRole("button", { name: "Edit Total amount" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Revenue" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Failed to save metric: write failed"),
    ).toBeTruthy();
    expect(screen.getByLabelText("Name")).toBeTruthy();
  });

  it("keeps the filter popover open and reports a rejected save", async () => {
    render(
      <FiltersSection
        filters={[]}
        combinedFields={[field]}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onSave={rejectedSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(
      await screen.findByText("Failed to save filter: write failed"),
    ).toBeTruthy();
    expect(screen.getByLabelText("Value")).toBeTruthy();
  });

  it("reports a live filter draft and clears it when dismissed", async () => {
    const onDraftChange = vi.fn();
    render(
      <FiltersSection
        filters={[]}
        combinedFields={[field]}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onSave={vi.fn()}
        onDraftChange={onDraftChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "100" },
    });
    await waitFor(() =>
      expect(onDraftChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          field: "amount",
          operator: "eq",
          value: 100,
        }),
      ),
    );
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
      code: "Escape",
    });
    await waitFor(() => expect(onDraftChange).toHaveBeenLastCalledWith(null));
  });

  it("keeps the field-rename popover open and reports a rejected save", async () => {
    render(
      <FieldsSection
        selectedFields={[field]}
        availableFields={[]}
        tables={[table]}
        baseTableId={table.id}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onRename={rejectedSave}
        onAdd={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Rename Amount" }));
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Revenue" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Failed to rename field: write failed"),
    ).toBeTruthy();
    expect(screen.getByLabelText("Display name")).toBeTruthy();
  });

  it("renames from the stored field name instead of its disambiguated label", () => {
    render(
      <FieldsSection
        selectedFields={[{ ...field, displayName: "Orders · Amount" }]}
        availableFields={[]}
        tables={[table]}
        baseTableId={table.id}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onRename={vi.fn()}
        onAdd={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Rename Orders · Amount" }),
    );
    expect(
      (screen.getByLabelText("Display name") as HTMLInputElement).value,
    ).toBe("Amount");
    expect(
      screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("selects an add-field command grouped under the authoring table", async () => {
    const user = userEvent.setup({ delay: null });
    const onAdd = vi.fn();
    render(
      <FieldsSection
        selectedFields={[]}
        availableFields={[field]}
        tables={[table]}
        baseTableId={table.id}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onRename={vi.fn()}
        onAdd={onAdd}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add field" }));
    expect(await screen.findByText("Orders")).toBeTruthy();
    await user.click(screen.getByRole("option", { name: /Amount/ }));
    expect(onAdd).toHaveBeenCalledWith(field.id);
  });

  it("shows base fields from an insight authoring source", async () => {
    const user = userEvent.setup({ delay: null });
    const onAdd = vi.fn();
    const upstreamInsightTable = {
      ...table,
      id: "upstream-insight",
      name: "Regional revenue",
    } as DataTable;
    const upstreamField = {
      ...field,
      sourceTableId: upstreamInsightTable.id,
    } as CombinedField;
    render(
      <FieldsSection
        selectedFields={[]}
        availableFields={[upstreamField]}
        tables={[upstreamInsightTable]}
        baseTableId={upstreamInsightTable.id}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onRename={vi.fn()}
        onAdd={onAdd}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add field" }));
    expect(await screen.findByText("Regional revenue")).toBeTruthy();
    await user.click(screen.getByRole("option", { name: /Amount/ }));
    expect(onAdd).toHaveBeenCalledWith(upstreamField.id);
  });

  it("shows option labels in filter and metric select triggers", async () => {
    const user = userEvent.setup({ delay: null });
    const view = render(
      <FiltersSection
        filters={[
          {
            id: "amount-filter",
            _id: "amount-filter",
            field: "amount",
            operator: "eq",
            value: 100,
          },
        ]}
        combinedFields={[field]}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Edit filter Amount" }),
    );
    expect(screen.getByLabelText("Field").textContent).toContain("Amount");
    view.unmount();

    render(
      <MetricsSection
        metrics={[
          {
            ...metric,
            name: "Unique amount",
            aggregation: "count_distinct",
          },
        ]}
        dataTable={table}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Edit Unique amount" }),
    );
    expect(screen.getByLabelText("Aggregation").textContent).toContain(
      "Count distinct",
    );
    expect(screen.getByLabelText("Column").textContent).toContain("Amount");
  });

  it("ignores Escape while an add-metric save is in flight", async () => {
    let release = () => undefined;
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(metrics(onSave));
    fireEvent.click(screen.getByRole("button", { name: "Add metric" }));
    fireEvent.click(
      screen.getAllByRole("button", { name: "Add metric" }).at(-1)!,
    );
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
      code: "Escape",
    });
    expect(screen.getByLabelText("Aggregation")).toBeTruthy();
    release();
    await waitFor(() =>
      expect(screen.queryByLabelText("Aggregation")).toBeNull(),
    );
  });

  it("ignores Escape while an edit-metric save is in flight", async () => {
    let release = () => undefined;
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(metrics(vi.fn(), onSave, [metric]));
    fireEvent.click(screen.getByRole("button", { name: "Edit Total amount" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Revenue" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
      code: "Escape",
    });
    expect(screen.getByDisplayValue("Revenue")).toBeTruthy();
    release();
    await waitFor(() => expect(screen.queryByLabelText("Name")).toBeNull());
  });

  it("ignores Escape while a filter save is in flight", async () => {
    let release = () => undefined;
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(
      <FiltersSection
        filters={[]}
        combinedFields={[field]}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
      code: "Escape",
    });
    expect(screen.getByDisplayValue("100")).toBeTruthy();
    release();
    await waitFor(() => expect(screen.queryByLabelText("Value")).toBeNull());
  });

  it("ignores Escape while a field rename is in flight", async () => {
    let release = () => undefined;
    const onRename = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(
      <FieldsSection
        selectedFields={[field]}
        availableFields={[]}
        tables={[table]}
        baseTableId={table.id}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onRename={onRename}
        onAdd={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Rename Amount" }));
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Revenue" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onRename).toHaveBeenCalled());
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
      code: "Escape",
    });
    expect(screen.getByDisplayValue("Revenue")).toBeTruthy();
    release();
    await waitFor(() =>
      expect(screen.queryByLabelText("Display name")).toBeNull(),
    );
  });

  it("leaves the column empty after switching from Count back to Sum", async () => {
    const user = userEvent.setup({ delay: null });
    render(metrics());
    await user.click(screen.getByRole("button", { name: "Add metric" }));
    await user.click(screen.getByLabelText("Aggregation"));
    await user.click(await screen.findByRole("option", { name: "Sum" }));
    await user.click(screen.getByLabelText("Column"));
    await user.click(await screen.findByRole("option", { name: "Amount" }));
    await user.click(screen.getByLabelText("Aggregation"));
    await user.click(await screen.findByRole("option", { name: "Count" }));
    await user.click(screen.getByLabelText("Aggregation"));
    await user.click(await screen.findByRole("option", { name: "Sum" }));
    expect(screen.getByLabelText("Column").textContent).toContain("Column");
  }, 10_000);

  it("repairs a stored count metric that still carries a column", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const stored = {
      ...metric,
      id: "metric-2",
      name: "Orders",
      aggregation: "count",
    } as InsightMetric;
    render(metrics(vi.fn(), onSave, [stored]));
    fireEvent.click(screen.getByRole("button", { name: "Edit Orders" }));
    expect(screen.getByLabelText("Column").hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      aggregation: "count",
      columnName: undefined,
    });
  });

  it("keeps an existing metric name when its formula changes", async () => {
    const user = userEvent.setup({ delay: null });
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(metrics(vi.fn(), onSave, [metric]));
    await user.click(screen.getByRole("button", { name: "Edit Total amount" }));
    await user.click(screen.getByLabelText("Aggregation"));
    await user.click(await screen.findByRole("option", { name: "Average" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Total amount",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      name: "Total amount",
      aggregation: "avg",
    });
  }, 10_000);

  it("refreshes an existing metric editor from saved props when reopened", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const view = render(metrics(vi.fn(), onSave, [metric]));
    fireEvent.click(screen.getByRole("button", { name: "Edit Total amount" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Revenue" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    view.rerender(metrics(vi.fn(), onSave, [{ ...metric, name: "Revenue" }]));
    fireEvent.click(screen.getByRole("button", { name: "Edit Revenue" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Revenue",
    );
    expect(
      screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("omits a count metric's stale saved column", () => {
    expect(metricColumnNameForSave("count", "amount")).toBeUndefined();
  });
});
