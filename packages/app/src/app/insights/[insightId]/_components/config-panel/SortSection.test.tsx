import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { SortSection } from "./SortSection";

const field = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Created at",
  columnName: "created_at",
  displayName: "Created at",
  type: "date",
  sourceTableId: "table-1",
} as CombinedField;

describe("SortSection", () => {
  it("flips an ascending sort to descending from its direction button", () => {
    const onChange = vi.fn();
    render(
      <SortSection
        sorts={[{ field: "created_at", direction: "asc" }]}
        fields={[field]}
        metrics={[]}
        onChange={onChange}
        onRuntimeChange={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Ascending; switch to descending",
      }),
    );
    expect(onChange).toHaveBeenCalledWith([
      { field: "created_at", direction: "desc" },
    ]);
  });

  it("does not offer another sort when all result columns are used", () => {
    render(
      <SortSection
        sorts={[{ field: "created_at", direction: "asc" }]}
        fields={[field]}
        metrics={[]}
        onChange={vi.fn()}
        onRuntimeChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Add sort" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});
