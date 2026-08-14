import type { ColumnDef } from "@tanstack/react-table";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { DataGrid } from "./data-grid";

interface TestRow {
  name: string;
}

const columns: ColumnDef<TestRow>[] = [
  {
    accessorKey: "name",
    header: "Name",
  },
];

describe("DataGrid row actions", () => {
  it("opens the action menu and exposes edit and delete actions", async () => {
    const user = userEvent.setup();
    const row = { name: "Sales data" };
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <DataGrid
        data={[row]}
        columns={columns}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open menu" }));

    const editItem = await screen.findByRole("menuitem", { name: "Edit" });
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeDefined();

    await user.click(editItem);
    expect(onEdit).toHaveBeenCalledWith(row);
    expect(onDelete).not.toHaveBeenCalled();
  });
});
