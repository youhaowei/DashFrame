/**
 * How a report tile draws its disclosed runtime controls.
 *
 * Named contracts:
 * - The control line carries pinned filters only; with none pinned it is absent.
 * - Everything else exposed sits behind one button, grouped filter, sort, rows.
 * - A filter knob emits its own predicate by id.
 * - Emptying a knob widens the chart only when the Insight allows clearing.
 */

import type { ExposedItemControl } from "@/lib/dashboards/item-controls";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { TileControlLine, TileControlsDoor } from "./DashboardItemControls";

const region: ExposedItemControl = {
  key: "region",
  kind: "filter",
  label: "Region",
  valueText: "EMEA",
  pinned: true,
  changeable: false,
  filter: { id: "f-region", field: "region", operator: "eq", value: "EMEA" },
};
const minQuantity: ExposedItemControl = {
  key: "min",
  kind: "filter",
  label: "Min quantity",
  valueText: "2",
  pinned: false,
  changeable: true,
  allowClear: true,
  filter: { id: "f-min", field: "quantity", operator: "gte", value: 2 },
};
const sort: ExposedItemControl = {
  key: "sort",
  kind: "sort",
  label: "",
  valueText: "Revenue, high to low",
  pinned: false,
  changeable: false,
};
const limit: ExposedItemControl = {
  key: "limit",
  kind: "limit",
  label: "",
  valueText: "Top 10",
  pinned: false,
  changeable: false,
};

const context = {
  inputTypeFor: () => "number" as const,
  sortOptions: [],
};

afterEach(cleanup);

describe("TileControlLine", () => {
  it("draws pinned filters and nothing else", () => {
    render(
      <TileControlLine
        {...context}
        controls={[region, minQuantity, sort, limit]}
      />,
    );
    const line = screen.getByLabelText("Chart filters");
    expect(within(line).getByText("EMEA")).toBeTruthy();
    expect(within(line).queryByText("Min quantity")).toBeNull();
    expect(within(line).queryByText("Top 10")).toBeNull();
  });

  it("is absent when nothing is pinned", () => {
    const { container } = render(
      <TileControlLine {...context} controls={[minQuantity, sort]} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("TileControlsDoor", () => {
  it("is absent when everything exposed is pinned", () => {
    const { container } = render(
      <TileControlsDoor {...context} controls={[region]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("opens the unpinned controls grouped as filter, sort, then rows", () => {
    render(
      <TileControlsDoor
        {...context}
        controls={[region, minQuantity, sort, limit]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Chart controls" }));

    const popover = screen.getByRole("dialog");
    const text = popover.textContent ?? "";
    expect(text.indexOf("Filter")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Filter")).toBeLessThan(text.indexOf("Sort"));
    expect(text.indexOf("Sort")).toBeLessThan(text.indexOf("Rows"));
    expect(within(popover).getByText("Min quantity")).toBeTruthy();
    expect(within(popover).queryByText("EMEA")).toBeNull();
  });

  it("emits a filter change for its own predicate, and a clear only when allowed", () => {
    const onChange = vi.fn();
    const fixedFloor = { ...minQuantity, key: "floor", allowClear: false };
    const { rerender } = render(
      <TileControlsDoor
        {...context}
        controls={[minQuantity]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Chart controls" }));
    const knob = () => screen.getByLabelText("Min quantity");

    fireEvent.change(knob(), { target: { value: "5" } });
    expect(onChange).toHaveBeenLastCalledWith({
      filters: [{ id: "f-min", field: "quantity", operator: "gte", value: 5 }],
    });

    fireEvent.change(knob(), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({
      filters: [expect.objectContaining({ id: "f-min", cleared: true })],
    });

    onChange.mockClear();
    rerender(
      <TileControlsDoor
        {...context}
        controls={[fixedFloor]}
        onChange={onChange}
      />,
    );
    fireEvent.change(knob(), { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
  });
});
