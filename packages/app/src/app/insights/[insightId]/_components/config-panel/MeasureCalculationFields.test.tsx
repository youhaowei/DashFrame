import type { DataTable, InsightMetric } from "@dashframe/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MetricsSection } from "./MetricsSection";

function table(type: "number" | "boolean"): DataTable {
  return {
    id: "orders",
    name: "Orders",
    fields: [
      {
        id: "filter-field",
        name: type === "number" ? "Amount" : "Is active",
        columnName: type === "number" ? "amount" : "is_active",
        type,
      },
    ],
  } as DataTable;
}

function renderMetrics(dataTable: DataTable, onAdd = vi.fn()) {
  render(
    <MetricsSection
      metrics={[]}
      dataTable={dataTable}
      onReorder={vi.fn()}
      onRemove={vi.fn()}
      onAdd={onAdd}
      onEdit={vi.fn()}
    />,
  );
  return onAdd;
}

describe("measure filter values", () => {
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

  it("keeps an incomplete numeric draft, blocks save, and emits a finite number", async () => {
    const onAdd = renderMetrics(table("number"));
    fireEvent.click(screen.getByRole("button", { name: "Add metric" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Filter this measure" }),
    );
    const input = screen.getByLabelText("Measure filter 1 value");

    fireEvent.change(input, { target: { value: "-" } });
    expect((input as HTMLInputElement).value).toBe("-");
    await waitFor(() =>
      expect(input.getAttribute("aria-invalid")).toBe("true"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(
      await screen.findByText("Measure filter 1 needs a valid number."),
    ).toBeTruthy();
    expect(onAdd).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "-1.5" } });
    await waitFor(() => expect(input.getAttribute("aria-invalid")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd.mock.calls[0]![0].filters).toEqual([
      { field: "amount", operator: "eq", value: -1.5 },
    ]);
    expect(Number.isNaN(onAdd.mock.calls[0]![0].filters?.[0]?.value)).toBe(
      false,
    );
  });

  it("saves booleans from an explicit true or false choice", async () => {
    const user = userEvent.setup({ delay: null });
    const onAdd = renderMetrics(table("boolean"));
    await user.click(screen.getByRole("button", { name: "Add metric" }));
    await user.click(
      screen.getByRole("button", { name: "Filter this measure" }),
    );
    await user.click(screen.getByLabelText("Measure filter 1 value"));
    await user.click(await screen.findByRole("option", { name: "True" }));
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd.mock.calls[0]![0].filters).toEqual([
      { field: "is_active", operator: "eq", value: true },
    ]);
  });

  it("preserves an invalid surviving draft when another filter is removed", async () => {
    const onEdit = vi.fn();
    const metric = {
      id: "orders-count",
      name: "Orders",
      sourceTable: "orders",
      aggregation: "count",
      filters: [
        { field: "amount", operator: "gte", value: 10 },
        { field: "amount", operator: "lte", value: 20 },
      ],
    } satisfies InsightMetric;
    render(
      <MetricsSection
        metrics={[metric]}
        dataTable={table("number")}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
        onEdit={onEdit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit Orders" }));
    const firstInput = screen.getByLabelText("Measure filter 1 value");
    fireEvent.change(firstInput, { target: { value: "-" } });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Remove measure filter" })[1]!,
    );

    expect((firstInput as HTMLInputElement).value).toBe("-");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Measure filter 1 needs a valid number."),
    ).toBeTruthy();
    expect(onEdit).not.toHaveBeenCalled();
  });
});

it("discards stale filter drafts when calculation mode replaces the filter list", async () => {
  const user = userEvent.setup({ delay: null });
  const onAdd = vi.fn();
  render(
    <MetricsSection
      metrics={[
        {
          id: "count",
          name: "Count",
          sourceTable: "orders",
          aggregation: "count",
        },
      ]}
      dataTable={table("number")}
      onReorder={vi.fn()}
      onRemove={vi.fn()}
      onAdd={onAdd}
      onEdit={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Add metric" }));
  await user.click(screen.getByRole("button", { name: "Filter this measure" }));
  fireEvent.change(screen.getByLabelText("Measure filter 1 value"), {
    target: { value: "10" },
  });
  await user.click(screen.getByRole("combobox", { name: "Calculation" }));
  await user.click(
    await screen.findByRole("option", { name: "Calculate from measures" }),
  );
  await user.click(screen.getByRole("combobox", { name: "Calculation" }));
  await user.click(
    await screen.findByRole("option", { name: "Aggregate a column" }),
  );
  await user.click(screen.getByRole("button", { name: "Filter this measure" }));
  expect(
    (screen.getByLabelText("Measure filter 1 value") as HTMLInputElement).value,
  ).toBe("");
  await user.click(screen.getByRole("button", { name: "Add", exact: true }));
  expect(
    await screen.findByText("Measure filter 1 needs a valid number."),
  ).toBeTruthy();
  expect(onAdd).not.toHaveBeenCalled();
});
