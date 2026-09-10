import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { FiltersSection, type FilterWithId } from "./FiltersSection";

const field = {
  id: "field-id",
  name: "Region",
  columnName: "region",
  displayName: "Region",
  type: "text",
  sourceTableId: "table-id",
} as CombinedField;

describe("FiltersSection", () => {
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", MouseEvent);
  });
  it("authors a runtime filter control when viewers can change a filter", async () => {
    const onSave = vi.fn();
    const filter = {
      id: "filter-id",
      _id: "filter-id",
      field: "region",
      operator: "eq",
      value: "US",
    } satisfies FilterWithId;
    render(
      <FiltersSection
        filters={[filter]}
        combinedFields={[field]}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit filter region" }));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Viewers can change" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ id: "filter-id", field: "region" }),
        {
          filterId: "filter-id",
          key: "filter-filter-id",
          label: "region",
          required: undefined,
          allowClear: undefined,
        },
      );
    });
  });
});
