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
import { useState, useMemo, useRef, useCallback } from "react";
import type { DataFrame, Field } from "@dashframe/dataframe";
import { cn } from "../lib/utils";

/**
 * Per-column configuration for customizing individual columns
 */
export interface ColumnConfig {
  /** Column name/id to configure */
  id: string;
  /** Custom header label (default: column name) */
  label?: string;
  /** Custom cell formatter function */
  format?: (value: unknown) => string;
  /** Visual highlight (adds background color) */
  highlight?: boolean;
  /** Hide this column */
  hidden?: boolean;
  /** Custom width (default: minmax(120px, 1fr)) */
  width?: number | string;
  /** Text alignment */
  align?: "left" | "center" | "right";
}

export interface DataFrameTableProps {
  /** The DataFrame to display */
  dataFrame: DataFrame;
  /** Optional Field definitions for column metadata */
  fields?: Field[];
  /** Optional per-column configuration overrides */
  columns?: ColumnConfig[];
  /** Constrain container height (default: flex-1 fills available space) */
  maxHeight?: number | string;
  /** Smaller padding/font for dense views */
  compact?: boolean;
  /** Additional className for the container */
  className?: string;

  // Event handlers
  /** Called when a cell is clicked */
  onCellClick?: (columnName: string, value: unknown, rowIndex: number) => void;
  /** Called when a column header is clicked (for selection UI) */
  onHeaderClick?: (columnName: string) => void;
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

// Default cell formatter
function defaultFormatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const dateStr = formatDate(value);
  if (dateStr) return dateStr;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * DataFrameTable - A virtualized table component for displaying DataFrames
 *
 * Features:
 * - Virtualized rendering for large datasets
 * - Sortable columns with visual indicators
 * - Per-column configuration (format, highlight, hide, width, align)
 * - Click handlers for cells and headers
 * - Compact mode for dense views
 *
 * @example
 * ```tsx
 * // Basic usage
 * <DataFrameTable dataFrame={df} fields={fields} />
 *
 * // With column customization
 * <DataFrameTable
 *   dataFrame={df}
 *   fields={fields}
 *   columns={[
 *     { id: "user_id", highlight: true },
 *     { id: "created_at", format: (v) => formatDate(v) },
 *   ]}
 *   onHeaderClick={(col) => setSelectedColumn(col)}
 * />
 * ```
 */
export function DataFrameTable({
  dataFrame,
  fields,
  columns: columnConfigs,
  maxHeight,
  compact = false,
  className,
  onCellClick,
  onHeaderClick,
}: DataFrameTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Build a map of column configs for quick lookup
  const configMap = useMemo(() => {
    const map = new Map<string, ColumnConfig>();
    columnConfigs?.forEach((config) => map.set(config.id, config));
    return map;
  }, [columnConfigs]);

  // Get formatter for a column
  const getFormatter = useCallback(
    (columnName: string) => {
      const config = configMap.get(columnName);
      return config?.format || defaultFormatValue;
    },
    [configMap]
  );

  // Build columns from Field definitions (modern) or deprecated columns field (legacy)
  const tableColumns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
    let columnDefs: { name: string; type?: string }[] = [];

    // Modern approach: Use Field definitions if available
    if (fields && fields.length > 0) {
      columnDefs = fields
        .filter((field) => !field.name.startsWith("_"))
        .map((field) => ({ name: field.name, type: field.type }));
    } else {
      // Legacy fallback: Use deprecated columns field
      columnDefs = (dataFrame.columns || [])
        .filter((col) => !col.name.startsWith("_"))
        .map((col) => ({ name: col.name, type: col.type }));
    }

    // Apply column configs (hidden, etc.)
    return columnDefs
      .filter((col) => {
        const config = configMap.get(col.name);
        return !config?.hidden;
      })
      .map((col) => {
        const config = configMap.get(col.name);
        const formatter = config?.format || defaultFormatValue;

        return {
          accessorKey: col.name,
          header: config?.label || col.name,
          cell: (info) => formatter(info.getValue()),
          meta: {
            align: config?.align || "left",
            highlight: config?.highlight || false,
            width: config?.width,
          },
        };
      });
  }, [fields, dataFrame.columns, configMap]);

  const table = useReactTable({
    data: dataFrame.rows,
    columns: tableColumns,
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
    estimateSize: () => (compact ? 26 : 30),
    overscan: 10,
  });

  // Calculate grid template columns
  const gridTemplateColumns = useMemo(() => {
    return tableColumns
      .map((col) => {
        const meta = col.meta as { width?: number | string } | undefined;
        if (meta?.width) {
          return typeof meta.width === "number" ? `${meta.width}px` : meta.width;
        }
        return "minmax(120px, 1fr)";
      })
      .join(" ");
  }, [tableColumns]);

  // Cell/header padding based on compact mode
  const cellPadding = compact ? "px-2 py-1" : "px-2 py-1.5";
  const fontSize = compact ? "text-[11px]" : "text-xs";

  return (
    <div
      className={cn("flex flex-col", className)}
      style={{ height: maxHeight, maxHeight }}
    >
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
            minWidth: "max-content",
          }}
        >
          {table.getHeaderGroups().map((headerGroup) => (
            <div key={headerGroup.id} className="contents">
              {headerGroup.headers.map((header) => {
                const meta = header.column.columnDef.meta as
                  | { align?: string; highlight?: boolean }
                  | undefined;
                const isHighlighted = meta?.highlight || false;
                const headerValue = flexRender(
                  header.column.columnDef.header,
                  header.getContext()
                );
                const headerString = header.column.id;
                const isClickable = !!onHeaderClick;

                return (
                  <div
                    key={header.id}
                    className={cn(
                      "text-muted-foreground overflow-hidden font-medium",
                      cellPadding,
                      fontSize,
                      isHighlighted && "bg-primary/10 text-primary",
                      isClickable && "cursor-pointer hover:bg-muted/80"
                    )}
                    title={headerString}
                    onClick={
                      isClickable
                        ? () => onHeaderClick(header.column.id)
                        : undefined
                    }
                  >
                    {header.isPlaceholder ? null : (
                      <div
                        className={cn(
                          "flex items-center",
                          header.column.getCanSort() &&
                            "hover:text-foreground cursor-pointer select-none gap-2"
                        )}
                        onClick={
                          !isClickable
                            ? header.column.getToggleSortingHandler()
                            : undefined
                        }
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
            minWidth: "max-content",
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
                  minWidth: "fit-content",
                }}
              >
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta as
                    | { align?: string; highlight?: boolean }
                    | undefined;
                  const isHighlighted = meta?.highlight || false;
                  const align = meta?.align || "left";

                  const cellValue = flexRender(
                    cell.column.columnDef.cell,
                    cell.getContext()
                  );

                  // Get raw value for tooltip
                  const rawValue = cell.getValue();
                  const tooltipText = defaultFormatValue(rawValue);

                  const isClickable = !!onCellClick;

                  return (
                    <div
                      key={cell.id}
                      className={cn(
                        "text-foreground group-hover:bg-muted/50",
                        cellPadding,
                        fontSize,
                        isHighlighted && "bg-primary/5",
                        isClickable && "cursor-pointer",
                        align === "right" && "text-right",
                        align === "center" && "text-center"
                      )}
                      title={tooltipText}
                      onClick={
                        isClickable
                          ? () =>
                              onCellClick(
                                cell.column.id,
                                rawValue,
                                virtualRow.index
                              )
                          : undefined
                      }
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
