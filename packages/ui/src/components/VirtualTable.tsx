"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { cn } from "../lib/utils";

// ============================================================================
// Types
// ============================================================================

/** Highlight variant for columns */
type HighlightVariant = "primary" | "base" | "join" | "both";

/**
 * Per-column configuration for customizing individual columns
 */
export interface VirtualTableColumnConfig {
  /** Column name/id to configure */
  id: string;
  /** Custom header label (default: column name) */
  label?: string;
  /** Custom cell formatter function */
  format?: (value: unknown) => string;
  /** Visual highlight - true for primary color, or specify variant */
  highlight?: boolean | HighlightVariant;
  /** Hide this column */
  hidden?: boolean;
  /** Custom width (default: minmax(120px, 1fr)) */
  width?: number | string;
  /** Text alignment */
  align?: "left" | "center" | "right";
}

/** Column definition passed to VirtualTable */
export interface VirtualTableColumn {
  name: string;
  type?: string;
}

/** Parameters for async data fetching */
export interface FetchDataParams {
  offset: number;
  limit: number;
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
}

/** Result from async data fetching */
export interface FetchDataResult {
  rows: Record<string, unknown>[];
  totalCount: number;
}

export interface VirtualTableProps {
  // === Mode 1: Static data (for previews, small datasets) ===
  /** Static row data to display */
  rows?: Record<string, unknown>[];
  /** Column definitions for static data */
  columns?: VirtualTableColumn[];

  // === Mode 2: Async data fetching (for large datasets) ===
  /** Callback to fetch data with pagination and sorting */
  onFetchData?: (params: FetchDataParams) => Promise<FetchDataResult>;

  // === Column configuration (both modes) ===
  /** Per-column configuration overrides */
  columnConfigs?: VirtualTableColumnConfig[];

  // === UI options ===
  /** Container height (default: 400px) */
  height?: number | string;
  /** Number of rows to fetch per page (default: 100) */
  pageSize?: number;
  /** Smaller padding/font for dense views */
  compact?: boolean;
  /** Additional className for the container */
  className?: string;

  // === Event handlers ===
  /** Called when a cell is clicked */
  onCellClick?: (columnName: string, value: unknown, rowIndex: number) => void;
  /** Called when a column header is clicked */
  onHeaderClick?: (columnName: string) => void;
}

// ============================================================================
// Utilities
// ============================================================================

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

function defaultFormatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const dateStr = formatDate(value);
  if (dateStr) return dateStr;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// ============================================================================
// Component
// ============================================================================

/**
 * VirtualTable - A virtualized table component with dual-mode support
 *
 * Supports two modes:
 * 1. **Static mode**: Pass `rows` + `columns` directly (client-side sorting)
 * 2. **Async mode**: Pass `onFetchData` callback (server-side pagination)
 *
 * Features:
 * - Virtualized rendering for large datasets (500k+ rows)
 * - Sortable columns with visual indicators
 * - Per-column configuration (format, highlight, hide, width, align)
 * - Sliding window memory management for async mode
 * - Debounced fetching to handle scrollbar dragging
 *
 * @example
 * ```tsx
 * // Static mode - for small datasets
 * <VirtualTable
 *   rows={previewData}
 *   columns={[{ name: "id" }, { name: "name" }]}
 * />
 *
 * // Async mode - for DuckDB queries
 * <VirtualTable
 *   onFetchData={async ({ offset, limit }) => {
 *     const result = await queryDuckDB(offset, limit);
 *     return { rows: result.rows, totalCount: result.count };
 *   }}
 * />
 * ```
 */
export function VirtualTable({
  rows: staticRows,
  columns: staticColumns,
  onFetchData,
  columnConfigs,
  height = 400,
  pageSize = 100,
  compact = false,
  className,
  onCellClick,
  onHeaderClick,
}: VirtualTableProps) {
  // Sorting state
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  // Async mode state
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [inferredColumns, setInferredColumns] = useState<VirtualTableColumn[]>(
    [],
  );
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Track loaded page ranges for infinite scroll
  const loadedPagesRef = useRef<Set<number>>(new Set());
  const isFetchingRef = useRef(false);
  const fetchQueueRef = useRef<number[]>([]);

  // Sliding window: max pages to keep in memory (~1000 rows with pageSize=100)
  const MAX_CACHED_PAGES = 10;
  const centerPageRef = useRef<number>(0);

  // Determine mode
  const isAsyncMode = !!onFetchData;

  // Build column config map for quick lookup
  const configMap = useMemo(() => {
    const map = new Map<string, VirtualTableColumnConfig>();
    columnConfigs?.forEach((config) => map.set(config.id, config));
    return map;
  }, [columnConfigs]);

  // Compute effective columns
  const effectiveColumns = useMemo(() => {
    if (isAsyncMode) {
      return inferredColumns;
    }
    if (staticColumns?.length) {
      return staticColumns;
    }
    // Infer from first row
    if (staticRows?.length) {
      return Object.keys(staticRows[0])
        .filter((key) => !key.startsWith("_"))
        .map((name) => ({ name }));
    }
    return [];
  }, [isAsyncMode, inferredColumns, staticColumns, staticRows]);

  // Filter out hidden columns
  const visibleColumns = useMemo(() => {
    return effectiveColumns
      .filter((col) => !col.name.startsWith("_"))
      .filter((col) => !configMap.get(col.name)?.hidden);
  }, [effectiveColumns, configMap]);

  // Sort static rows client-side
  const sortedStaticRows = useMemo(() => {
    if (isAsyncMode || !staticRows) return staticRows ?? [];
    if (!sortColumn) return staticRows;

    return [...staticRows].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];

      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      const comparison = aVal < bVal ? -1 : 1;
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [isAsyncMode, staticRows, sortColumn, sortDirection]);

  // Evict pages outside the sliding window
  const evictDistantPages = useCallback(
    (currentCenter: number) => {
      const halfWindow = Math.floor(MAX_CACHED_PAGES / 2);
      const windowStart = Math.max(0, currentCenter - halfWindow);
      const windowEnd = currentCenter + halfWindow;

      const pagesToEvict: number[] = [];
      loadedPagesRef.current.forEach((page) => {
        if (page < windowStart || page > windowEnd) {
          pagesToEvict.push(page);
        }
      });

      if (pagesToEvict.length === 0) return;

      pagesToEvict.forEach((page) => loadedPagesRef.current.delete(page));

      setData((prev) => {
        const newData = [...prev];
        for (const page of pagesToEvict) {
          const startIdx = page * pageSize;
          const endIdx = Math.min(startIdx + pageSize, newData.length);
          for (let i = startIdx; i < endIdx; i++) {
            newData[i] = {} as Record<string, unknown>;
          }
        }
        return newData;
      });
    },
    [pageSize, MAX_CACHED_PAGES],
  );

  // Process fetch queue
  const processQueue = useCallback(async () => {
    if (
      isFetchingRef.current ||
      fetchQueueRef.current.length === 0 ||
      !onFetchData
    )
      return;

    const pageIndex = fetchQueueRef.current.shift()!;

    if (loadedPagesRef.current.has(pageIndex)) {
      setTimeout(processQueue, 0);
      return;
    }

    isFetchingRef.current = true;
    const isInitialLoad = loadedPagesRef.current.size === 0;
    if (isInitialLoad) setIsLoading(true);

    try {
      const offset = pageIndex * pageSize;
      const result = await onFetchData({
        offset,
        limit: pageSize,
        sortColumn: sortColumn ?? undefined,
        sortDirection: sortColumn ? sortDirection : undefined,
      });

      setTotalCount(result.totalCount);

      if (result.rows.length > 0 && inferredColumns.length === 0) {
        const cols = Object.keys(result.rows[0])
          .filter((key) => !key.startsWith("_"))
          .map((name) => ({ name }));
        setInferredColumns(cols);
      }

      setData((prev) => {
        const newData = [...prev];
        while (newData.length < offset + result.rows.length) {
          newData.push({} as Record<string, unknown>);
        }
        for (let i = 0; i < result.rows.length; i++) {
          newData[offset + i] = result.rows[i];
        }
        return newData;
      });

      loadedPagesRef.current.add(pageIndex);

      if (loadedPagesRef.current.size > MAX_CACHED_PAGES) {
        evictDistantPages(centerPageRef.current);
      }
    } catch (error) {
      console.error("VirtualTable fetch error:", error);
    } finally {
      if (isInitialLoad) setIsLoading(false);
      isFetchingRef.current = false;
      setTimeout(processQueue, 10);
    }
  }, [
    onFetchData,
    pageSize,
    inferredColumns.length,
    evictDistantPages,
    MAX_CACHED_PAGES,
    sortColumn,
    sortDirection,
  ]);

  // Queue a page for fetching
  const queuePage = useCallback(
    (pageIndex: number) => {
      if (loadedPagesRef.current.has(pageIndex)) return;
      if (fetchQueueRef.current.includes(pageIndex)) return;
      fetchQueueRef.current.push(pageIndex);
      processQueue();
    },
    [processQueue],
  );

  // Fetch with reset (for initial load or sort change)
  const fetchWithReset = useCallback(
    async (newSortColumn?: string, newSortDirection?: "asc" | "desc") => {
      if (!onFetchData) return;

      fetchQueueRef.current = [];
      loadedPagesRef.current.clear();
      isFetchingRef.current = true;
      setIsLoading(true);

      try {
        const result = await onFetchData({
          offset: 0,
          limit: pageSize,
          sortColumn: newSortColumn,
          sortDirection: newSortColumn ? newSortDirection : undefined,
        });

        setTotalCount(result.totalCount);

        if (result.rows.length > 0 && inferredColumns.length === 0) {
          const cols = Object.keys(result.rows[0])
            .filter((key) => !key.startsWith("_"))
            .map((name) => ({ name }));
          setInferredColumns(cols);
        }

        setData(result.rows);
        loadedPagesRef.current.add(0);
      } catch (error) {
        console.error("VirtualTable fetch error:", error);
      } finally {
        setIsLoading(false);
        isFetchingRef.current = false;
      }
    },
    [onFetchData, pageSize, inferredColumns.length],
  );

  // Reset state when onFetchData changes (e.g., switching data sources)
  const onFetchDataRef = useRef(onFetchData);
  useEffect(() => {
    if (onFetchDataRef.current !== onFetchData) {
      // Data source changed - reset all state
      setInferredColumns([]);
      setData([]);
      setTotalCount(0);
      loadedPagesRef.current.clear();
      fetchQueueRef.current = [];
      onFetchDataRef.current = onFetchData;
    }
  }, [onFetchData]);

  // Initial fetch for async mode
  useEffect(() => {
    if (isAsyncMode) {
      fetchWithReset();
    }
  }, [isAsyncMode, fetchWithReset]);

  // Handle column header click for sorting
  const handleSort = useCallback(
    (columnName: string) => {
      if (onHeaderClick) {
        onHeaderClick(columnName);
        return;
      }

      const newDirection =
        sortColumn === columnName && sortDirection === "asc" ? "desc" : "asc";
      setSortColumn(columnName);
      setSortDirection(newDirection);

      if (isAsyncMode) {
        fetchWithReset(columnName, newDirection);
      }
    },
    [sortColumn, sortDirection, isAsyncMode, fetchWithReset, onHeaderClick],
  );

  // Row count for virtualization
  const virtualRowCount = isAsyncMode ? totalCount : sortedStaticRows.length;

  // Virtualization
  const rowVirtualizer = useVirtualizer({
    count: virtualRowCount,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => (compact ? 26 : 30),
    overscan: 10,
  });

  // Debounce timer for scroll-based fetching
  const scrollDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch pages as user scrolls
  useEffect(() => {
    if (!isAsyncMode || totalCount === 0) return;

    const virtualItems = rowVirtualizer.getVirtualItems();
    if (virtualItems.length === 0) return;

    const firstVisibleIndex = virtualItems[0].index;
    const lastVisibleIndex = virtualItems[virtualItems.length - 1].index;

    const firstPage = Math.floor(firstVisibleIndex / pageSize);
    const lastPage = Math.floor(lastVisibleIndex / pageSize);
    const centerPage = Math.floor((firstPage + lastPage) / 2);

    centerPageRef.current = centerPage;

    if (scrollDebounceRef.current) {
      clearTimeout(scrollDebounceRef.current);
    }

    scrollDebounceRef.current = setTimeout(() => {
      const pagesToQueue: number[] = [];
      for (let page = firstPage; page <= lastPage; page++) {
        if (page * pageSize < totalCount) {
          pagesToQueue.push(page);
        }
      }
      if (firstPage > 0 && (firstPage - 1) * pageSize < totalCount) {
        pagesToQueue.push(firstPage - 1);
      }
      if ((lastPage + 1) * pageSize < totalCount) {
        pagesToQueue.push(lastPage + 1);
      }

      pagesToQueue.sort(
        (a, b) => Math.abs(a - centerPage) - Math.abs(b - centerPage),
      );
      fetchQueueRef.current = [];

      for (const page of pagesToQueue) {
        queuePage(page);
      }
    }, 150);

    return () => {
      if (scrollDebounceRef.current) {
        clearTimeout(scrollDebounceRef.current);
      }
    };
  }, [
    rowVirtualizer.getVirtualItems(),
    isAsyncMode,
    totalCount,
    pageSize,
    queuePage,
  ]);

  // Grid template columns
  const gridTemplateColumns = useMemo(() => {
    return visibleColumns
      .map((col) => {
        const config = configMap.get(col.name);
        if (config?.width) {
          return typeof config.width === "number"
            ? `${config.width}px`
            : config.width;
        }
        return "minmax(120px, 1fr)";
      })
      .join(" ");
  }, [visibleColumns, configMap]);

  // Styles
  const cellPadding = compact ? "px-2 py-1" : "px-2 py-1.5";
  const fontSize = compact ? "text-[11px]" : "text-xs";

  const highlightHeaderStyles = {
    primary: "bg-primary text-primary-foreground font-semibold",
    base: "bg-blue-600 text-white font-semibold",
    join: "bg-emerald-600 text-white font-semibold",
    both: "bg-amber-500 text-white font-semibold",
  };

  const highlightCellStyles = {
    primary: "bg-primary/15",
    base: "bg-blue-500/10",
    join: "bg-emerald-500/10",
    both: "bg-amber-500/10",
  };

  // Get row data by index
  const getRowData = (index: number): Record<string, unknown> | null => {
    if (isAsyncMode) {
      const row = data[index];
      return row && Object.keys(row).length > 0 ? row : null;
    }
    return sortedStaticRows[index] ?? null;
  };

  return (
    <div
      className={cn("relative flex flex-col", className)}
      style={{ height, maxHeight: height }}
    >
      {/* Loading indicator */}
      {isLoading && (
        <div className="bg-muted/50 pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg">
          <div className="bg-background/80 text-muted-foreground rounded-md px-3 py-1.5 text-sm shadow-sm">
            Loading...
          </div>
        </div>
      )}

      {/* Table container */}
      <div
        ref={tableContainerRef}
        className="border-border relative min-h-0 flex-1 overflow-auto rounded-lg border"
      >
        {/* Header */}
        <div
          className="bg-muted border-border sticky top-0 z-10 border-b"
          style={{
            display: "grid",
            gridTemplateColumns,
            minWidth: "max-content",
          }}
        >
          {visibleColumns.map((col) => {
            const config = configMap.get(col.name);
            const highlight = config?.highlight;
            const isHighlighted = !!highlight;
            const highlightVariant =
              typeof highlight === "string" ? highlight : "primary";
            const isSorted = sortColumn === col.name;

            return (
              <div
                key={col.name}
                className={cn(
                  "text-muted-foreground cursor-pointer select-none overflow-hidden font-medium",
                  cellPadding,
                  fontSize,
                  isHighlighted && highlightHeaderStyles[highlightVariant],
                  !isHighlighted && "hover:bg-muted/80",
                )}
                title={col.name}
                onClick={() => handleSort(col.name)}
              >
                <div className="flex items-center gap-1">
                  <span className="truncate">{config?.label || col.name}</span>
                  {isSorted && (
                    <span className="text-[10px]">
                      {sortDirection === "asc" ? "↑" : "↓"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div
          className="bg-card relative"
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            minWidth: "max-content",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const rowData = getRowData(virtualRow.index);

            // Placeholder for unloaded rows
            if (!rowData) {
              return (
                <div
                  key={virtualRow.index}
                  className="border-border absolute border-b"
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                    display: "grid",
                    gridTemplateColumns,
                    width: "100%",
                    minWidth: "fit-content",
                  }}
                >
                  {visibleColumns.map((col) => (
                    <div
                      key={col.name}
                      className={cn(
                        "text-muted-foreground/50",
                        cellPadding,
                        fontSize,
                      )}
                    >
                      <div className="bg-muted/50 h-3 w-16 animate-pulse rounded" />
                    </div>
                  ))}
                </div>
              );
            }

            // Render row
            return (
              <div
                key={virtualRow.index}
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
                {visibleColumns.map((col) => {
                  const config = configMap.get(col.name);
                  const highlight = config?.highlight;
                  const isHighlighted = !!highlight;
                  const highlightVariant =
                    typeof highlight === "string" ? highlight : "primary";
                  const align = config?.align || "left";

                  const rawValue = rowData[col.name];
                  const formatter = config?.format || defaultFormatValue;
                  const cellValue = formatter(rawValue);
                  const isClickable = !!onCellClick;

                  return (
                    <div
                      key={col.name}
                      className={cn(
                        "text-foreground group-hover:bg-muted/50",
                        cellPadding,
                        fontSize,
                        isHighlighted && highlightCellStyles[highlightVariant],
                        isClickable && "cursor-pointer",
                        align === "right" && "text-right",
                        align === "center" && "text-center",
                      )}
                      title={cellValue}
                      onClick={
                        isClickable
                          ? () =>
                              onCellClick(col.name, rawValue, virtualRow.index)
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

        {/* Empty state */}
        {virtualRowCount === 0 && !isLoading && (
          <div className="flex h-32 items-center justify-center">
            <span className="text-muted-foreground text-sm">
              No data available
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
