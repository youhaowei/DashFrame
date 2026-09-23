import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { VirtualTable } from "./VirtualTable";

const columns = [{ name: "id" }, { name: "region" }];
const rows = [
  { id: 1, region: "North" },
  { id: 2, region: "South" },
];

describe("VirtualTable headers", () => {
  it("offers to sort by a column when the host does not handle header clicks", () => {
    render(<VirtualTable rows={rows} columns={columns} height={200} />);

    screen.getByRole("button", { name: "Sort by region" });
  });

  it("names only the column, and reports the click, when the host handles header clicks", () => {
    const onHeaderClick = vi.fn();
    render(
      <VirtualTable
        rows={rows}
        columns={columns}
        columnConfigs={[
          { id: "region", label: "Region", highlight: "selected" },
        ]}
        height={200}
        onHeaderClick={onHeaderClick}
      />,
    );

    expect(screen.queryByRole("button", { name: /^Sort by/ })).toBeNull();
    const region = screen.getByRole("button", { name: "Region" });
    expect(region.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.getByRole("button", { name: "id" }).getAttribute("aria-pressed"),
    ).toBe("false");

    fireEvent.click(region);
    expect(onHeaderClick).toHaveBeenCalledWith("region");
  });

  it("pins the first visible column's header when asked to", () => {
    render(
      <VirtualTable
        rows={rows}
        columns={columns}
        columnConfigs={[{ id: "id", hidden: true }]}
        height={200}
        stickyFirstColumn
      />,
    );

    // With "id" hidden, "region" is the first visible column.
    expect(
      screen.getByRole("button", { name: "Sort by region" }).className,
    ).toContain("sticky");
  });
});
