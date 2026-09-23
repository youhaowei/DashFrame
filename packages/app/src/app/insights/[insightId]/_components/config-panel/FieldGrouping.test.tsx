import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import type { DataTable } from "@dashframe/types";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { FieldsSection, withFieldGrouping } from "./FieldsSection";

const table = {
  id: "table-1",
  name: "Orders",
  fields: [],
} as unknown as DataTable;
const field = (id: string, name: string, type: string) =>
  ({
    id,
    name,
    displayName: name,
    columnName: name.toLowerCase(),
    type,
    sourceTableId: table.id,
  }) as CombinedField;
const date = field("date", "Date", "date");
const channel = field("channel", "Channel", "string");
const measures = [
  { id: "orders", name: "Orders" },
  { id: "revenue", name: "Revenue" },
];

function renderFields(props: Partial<Parameters<typeof FieldsSection>[0]>) {
  return render(
    <FieldsSection
      selectedFields={[date, channel]}
      availableFields={[]}
      tables={[table]}
      baseTableId={table.id}
      measures={measures}
      onReorder={vi.fn()}
      onRemove={vi.fn()}
      onRename={vi.fn()}
      onAdd={vi.fn()}
      {...props}
    />,
  );
}

describe("field grouping", () => {
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

  it("summarises grouping on the chip", () => {
    renderFields({
      reporting: {
        dateGrains: { date: "month" },
        pivotFields: ["channel"],
        topN: {
          fieldId: "channel",
          measureId: "revenue",
          count: 5,
          direction: "desc",
        },
      },
    });
    expect(screen.getByText("by month")).toBeTruthy();
    expect(screen.getByText("columns · top 5")).toBeTruthy();
  });

  it("saves columns and a Top N from the field editor", async () => {
    const user = userEvent.setup({ delay: null });
    const onConfigure = vi.fn().mockResolvedValue(undefined);
    renderFields({
      onConfigure,
      reporting: {
        topN: {
          fieldId: "date",
          measureId: "orders",
          count: 3,
          direction: "asc",
        },
      },
    });

    await user.click(screen.getByRole("button", { name: "Edit Channel" }));
    await user.click(screen.getByRole("tab", { name: "Columns" }));
    await user.click(screen.getByRole("combobox", { name: "Keep" }));
    await user.click(await screen.findByRole("option", { name: "Top" }));
    expect(screen.getByText("Replaces the ranking on Date.")).toBeTruthy();
    await user.click(screen.getByRole("combobox", { name: "Ranked by" }));
    await user.click(await screen.findByRole("option", { name: "Revenue" }));
    await user.clear(
      screen.getByRole("spinbutton", { name: "Number of values" }),
    );
    expect(
      screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    ).toBe(true);
    await user.type(
      screen.getByRole("spinbutton", { name: "Number of values" }),
      "20",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onConfigure).toHaveBeenCalledWith("channel", {
        grain: undefined,
        pivot: true,
        rank: { direction: "desc", count: 20, measureId: "revenue" },
      }),
    );
  });

  it("shows the date grain label rather than its stored value", async () => {
    const user = userEvent.setup({ delay: null });
    renderFields({
      onConfigure: vi.fn(),
      reporting: { dateGrains: { date: "quarter" } },
    });
    await user.click(screen.getByRole("button", { name: "Edit Date" }));
    expect(
      screen.getByRole("combobox", { name: "Group date by" }).textContent,
    ).toContain("Quarter");
  });
});

describe("withFieldGrouping", () => {
  it("moves the report's one Top N to the edited field", () => {
    expect(
      withFieldGrouping(
        {
          pivotFields: ["date"],
          topN: {
            fieldId: "date",
            measureId: "orders",
            count: 3,
            direction: "asc",
          },
        },
        "channel",
        {
          pivot: true,
          rank: { direction: "desc", count: 5, measureId: "revenue" },
        },
      ),
    ).toEqual({
      dateGrains: {},
      pivotFields: ["date", "channel"],
      topN: {
        fieldId: "channel",
        measureId: "revenue",
        count: 5,
        direction: "desc",
      },
    });
  });

  it("clears only this field's grain, pivot and ranking", () => {
    expect(
      withFieldGrouping(
        {
          dateGrains: { date: "month", other: "year" },
          pivotFields: ["date"],
          topN: {
            fieldId: "date",
            measureId: "orders",
            count: 3,
            direction: "asc",
          },
        },
        "date",
        { pivot: false },
      ),
    ).toEqual({ dateGrains: { other: "year" }, pivotFields: [] });
  });
});
