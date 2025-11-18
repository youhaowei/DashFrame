"use client";

import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import { useState, useMemo } from "react";
import type { DataFrame } from "@dash-frame/dataframe";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TableViewProps {
  dataFrame: DataFrame;
}

export function TableView({ dataFrame }: TableViewProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 10,
  });

  // Build columns from DataFrame schema
  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () =>
      dataFrame.columns.map((col) => ({
        accessorKey: col.name,
        header: col.name,
        cell: (info) => {
          const value = info.getValue();
          // Handle different data types
          if (value === null || value === undefined) return "—";
          if (value instanceof Date) {
            return value.toLocaleDateString();
          }
          if (typeof value === "string" && !isNaN(Date.parse(value))) {
            // Check if it looks like an ISO date string
            const date = new Date(value);
            if (date.toString() !== "Invalid Date") {
              return date.toLocaleDateString();
            }
          }
          if (typeof value === "object") return JSON.stringify(value);
          return String(value);
        },
      })),
    [dataFrame.columns],
  );

  const table = useReactTable({
    data: dataFrame.rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    state: {
      sorting,
      columnFilters,
      pagination,
    },
  });

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Table with sticky header */}
      <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-border">
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-4 py-3 font-medium text-muted-foreground"
                  >
                    {header.isPlaceholder ? null : (
                      <div
                        className={
                          header.column.getCanSort()
                            ? "flex cursor-pointer select-none items-center gap-2 hover:text-foreground"
                            : ""
                        }
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {{
                          asc: " ↑",
                          desc: " ↓",
                        }[header.column.getIsSorted() as string] ?? null}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/50">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3 text-foreground">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      <div className="shrink-0 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing{" "}
          {table.getState().pagination.pageIndex * pagination.pageSize + 1} to{" "}
          {Math.min(
            (table.getState().pagination.pageIndex + 1) * pagination.pageSize,
            dataFrame.rows.length,
          )}{" "}
          of {dataFrame.rows.length} rows
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            First
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            Last
          </Button>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Page size:</span>
          <Select
            value={pagination.pageSize.toString()}
            onValueChange={(value) => {
              setPagination((prev) => ({
                ...prev,
                pageSize: Number(value),
              }));
            }}
          >
            <SelectTrigger className="w-[70px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 20, 50, 100].map((size) => (
                <SelectItem key={size} value={size.toString()}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
