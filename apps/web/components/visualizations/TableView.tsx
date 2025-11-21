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
import type { DataFrame, Field } from "@dashframe/dataframe";

interface TableViewProps {
  dataFrame: DataFrame;
  fields?: Field[]; // Optional: Field definitions for modern fieldIds architecture
}

// Utility to format dates consistently
function formatDate(value: unknown): string | null {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!isNaN(parsed)) {
      const date = new Date(parsed);
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
  }
  return null;
}

export function TableView({ dataFrame, fields }: TableViewProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Build columns from Field definitions (modern) or deprecated columns field (legacy)
  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
    // Modern approach: Use Field definitions if available
    if (fields && fields.length > 0) {
      return fields
        .filter((field) => !field.name.startsWith("_")) // Filter out internal fields
        .map((field) => ({
          // Use field.name as the accessor key (this is what's in the row data)
          accessorKey: field.name,
          header: field.name,
          cell: (info) => {
            const value = info.getValue();
            // Handle different data types
            if (value === null || value === undefined) return "—";

            // Try to format as date
            const dateStr = formatDate(value);
            if (dateStr) return dateStr;

            if (typeof value === "object") return JSON.stringify(value);
            return String(value);
          },
        }));
    }

    // Legacy fallback: Use deprecated columns field for backward compatibility
    return (dataFrame.columns || [])
      .filter((col) => !col.name.startsWith("_"))
      .map((col) => ({
        accessorKey: col.name,
        header: col.name,
        cell: (info) => {
          const value = info.getValue();
          // Handle different data types
          if (value === null || value === undefined) return "—";

          // Try to format as date
          const dateStr = formatDate(value);
          if (dateStr) return dateStr;

          if (typeof value === "object") return JSON.stringify(value);
          return String(value);
        },
      }));
  }, [fields, dataFrame.columns]);

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
  const gridTemplateColumns = `repeat(${columns.length}, minmax(120px, 1fr))`;

  return (
    <div className="flex h-full flex-col">
      {/* Virtualized table with sticky header */}
      <div
        ref={tableContainerRef}
        className="border-border min-h-0 flex-1 overflow-auto rounded-lg border"
      >
        {/* Header - sticky */}
        <div
          className="bg-muted border-border sticky top-0 z-10 border-b"
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
                    className="text-muted-foreground overflow-hidden px-2 py-1.5 text-xs font-medium"
                    title={headerString}
                  >
                    {header.isPlaceholder ? null : (
                      <div
                        className={
                          header.column.getCanSort()
                            ? "hover:text-foreground flex cursor-pointer select-none items-center gap-2"
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
                className="border-border group absolute border-b"
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
                  } else {
                    const dateStr = formatDate(rawValue);
                    if (dateStr) {
                      tooltipText = dateStr;
                    } else if (typeof rawValue === "object") {
                      tooltipText = JSON.stringify(rawValue);
                    } else {
                      tooltipText = String(rawValue);
                    }
                  }

                  return (
                    <div
                      key={cell.id}
                      className="text-foreground group-hover:bg-muted/50 px-2 py-1.5 text-xs"
                      title={tooltipText}
                    >
                      <div className="flex min-w-0 items-center overflow-hidden">
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
