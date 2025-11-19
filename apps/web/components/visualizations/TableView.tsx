"use client";

import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useState, useMemo, useRef } from "react";
import type { DataFrame } from "@dash-frame/dataframe";

interface TableViewProps {
  dataFrame: DataFrame;
}

export function TableView({ dataFrame }: TableViewProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const tableContainerRef = useRef<HTMLDivElement>(null);

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
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    state: {
      sorting,
      columnFilters,
    },
  });

  const { rows } = table.getRowModel();

  // Virtualization for efficient rendering of large datasets
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 30, // Estimated row height in pixels (compact spacing with smaller font)
    overscan: 10, // Render 10 extra rows above/below viewport for smooth scrolling
  });

  // Calculate grid template columns (equal width for all columns)
  const gridTemplateColumns = `repeat(${dataFrame.columns.length}, minmax(120px, 1fr))`;

  return (
    <div className="flex flex-col h-full">
      {/* Virtualized table with sticky header */}
      <div
        ref={tableContainerRef}
        className="flex-1 min-h-0 overflow-auto rounded-lg border border-border"
      >
        {/* Header - sticky */}
        <div
          className="sticky top-0 z-10 bg-muted border-b border-border"
          style={{
            display: "grid",
            gridTemplateColumns,
            minWidth: "max-content", // Ensure header extends full width of grid
          }}
        >
          {table.getHeaderGroups().map((headerGroup) => (
            <div key={headerGroup.id} className="contents">
              {headerGroup.headers.map((header) => {
                const headerValue = flexRender(
                  header.column.columnDef.header,
                  header.getContext(),
                );
                // Use column ID as tooltip (raw column name)
                const headerString = header.column.id;

                return (
                  <div
                    key={header.id}
                    className="px-2 py-1.5 font-medium text-muted-foreground text-xs overflow-hidden"
                    title={headerString}
                  >
                    {header.isPlaceholder ? null : (
                      <div
                        className={
                          header.column.getCanSort()
                            ? "flex cursor-pointer select-none items-center gap-2 hover:text-foreground"
                            : "flex items-center"
                        }
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <span className="truncate">{headerValue}</span>
                        {{
                          asc: " ↑",
                          desc: " ↓",
                        }[header.column.getIsSorted() as string] ?? null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Body - virtualized */}
        <div
          className="bg-card relative"
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            minWidth: "max-content", // Match header width
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <div
                key={row.id}
                className="absolute border-b border-border group"
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                  display: "grid",
                  gridTemplateColumns,
                  width: "100%",
                  minWidth: "fit-content", // Allow row to extend for content
                }}
              >
                {row.getVisibleCells().map((cell) => {
                  const cellValue = flexRender(
                    cell.column.columnDef.cell,
                    cell.getContext(),
                  );

                  // Get raw value for tooltip (before React rendering)
                  const rawValue = cell.getValue();
                  let tooltipText = "";
                  if (rawValue === null || rawValue === undefined) {
                    tooltipText = "—";
                  } else if (rawValue instanceof Date) {
                    tooltipText = rawValue.toLocaleDateString();
                  } else if (typeof rawValue === "object") {
                    tooltipText = JSON.stringify(rawValue);
                  } else {
                    tooltipText = String(rawValue);
                  }

                  return (
                    <div
                      key={cell.id}
                      className="px-2 py-1.5 text-foreground text-xs group-hover:bg-muted/50"
                      title={tooltipText}
                    >
                      <div className="flex items-center overflow-hidden min-w-0">
                        <span className="truncate">{cellValue}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
