import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { SortSection } from "./SortSection";

const field = {
  id: "field-1",
  name: "Created at",
  columnName: "created_at",
  displayName: "Created at",
  type: "date",
  sourceTableId: "table-1",
} as CombinedField;

describe("SortSection", () => {
  it("adds the first available result field as an ascending sort", () => {
    const onChange = vi.fn();

    render(
      <SortSection
        sorts={[]}
        fields={[field]}
        metrics={[]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(onChange).toHaveBeenCalledWith([
      { field: "created_at", direction: "asc" },
    ]);
  });

  it("does not offer another sort when all available fields are used", () => {
    render(
      <SortSection
        sorts={[{ field: "created_at", direction: "asc" }]}
        fields={[field]}
        metrics={[]}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Add" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});
