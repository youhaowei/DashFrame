import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

    fireEvent.click(screen.getByRole("button", { name: "Edit filter Region" }));
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
          label: "Region",
          required: undefined,
          allowClear: undefined,
        },
      );
    });
  });

  it("shows the operator label and field display name", () => {
    render(
      <FiltersSection
        filters={[
          {
            id: "filter-id",
            _id: "filter-id",
            field: "region",
            operator: "ne",
            value: "US",
          },
        ]}
        combinedFields={[field]}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText("is not")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit filter Region" }));
    expect(screen.getByLabelText("Operator").textContent).toContain("is not");
  });

  it("follows the selected field label until the viewer label is edited", async () => {
    const user = userEvent.setup({ delay: null });
    const city = {
      ...field,
      id: "city-id",
      name: "City",
      columnName: "city",
      displayName: "Customer city",
    } as CombinedField;
    render(
      <FiltersSection
        filters={[]}
        combinedFields={[field, city]}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add filter" }));
    await user.click(screen.getByLabelText("Field"));
    await user.click(
      await screen.findByRole("option", { name: "Customer city" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Viewers can change" }),
    );
    expect(
      (screen.getByLabelText("Shown to viewers as") as HTMLInputElement).value,
    ).toBe("Customer city");
    fireEvent.change(screen.getByLabelText("Shown to viewers as"), {
      target: { value: "Market" },
    });
    await user.click(screen.getByLabelText("Field"));
    await user.click(await screen.findByRole("option", { name: "Region" }));
    expect(
      (screen.getByLabelText("Shown to viewers as") as HTMLInputElement).value,
    ).toBe("Market");
  }, 10_000);

  it("leaves a new viewer-control key empty until save", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
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
      target: { value: "US" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Viewers can change" }),
    );
    expect(
      (screen.getByLabelText("Control key") as HTMLInputElement).value,
    ).toBe("");
    expect(screen.getByPlaceholderText("Generated on save")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0];
    expect(onSave.mock.calls[0][1]).toMatchObject({
      filterId: saved.id,
      key: `filter-${saved.id}`,
    });
  });

  it("refreshes a filter editor from saved props when reopened", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const filter = {
      id: "filter-id",
      _id: "filter-id",
      field: "region",
      operator: "eq",
      value: "US",
    } satisfies FilterWithId;
    const view = render(
      <FiltersSection
        filters={[filter]}
        combinedFields={[field]}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit filter Region" }));
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "EU" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    view.rerender(
      <FiltersSection
        filters={[{ ...filter, value: "EU" }]}
        combinedFields={[field]}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit filter Region" }));
    expect((screen.getByLabelText("Value") as HTMLInputElement).value).toBe(
      "EU",
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][0]).toMatchObject({ value: "EU" });
  });

  it("keeps a missing current field available and marks its chip invalid", () => {
    render(
      <FiltersSection
        filters={[
          {
            id: "filter-id",
            _id: "filter-id",
            field: "deleted_field",
            operator: "eq",
            value: "US",
          },
        ]}
        combinedFields={[field]}
        displayFields={[field]}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", {
      name: "Edit filter deleted_field",
    });
    expect(trigger.querySelector(".line-through")).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.getByLabelText("Field").textContent).toContain(
      "deleted_field",
    );
  });
});
