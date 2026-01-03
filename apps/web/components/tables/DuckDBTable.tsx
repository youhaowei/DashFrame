"use client";

import { useCallback, useState, useEffect } from "react";
import {
  VirtualTable,
  type VirtualTableColumnConfig,
  type VirtualTableColumn,
  type FetchDataParams,
  type FetchDataResult,
} from "@dashframe/ui";
import { useDuckDB } from "../providers/DuckDBProvider";

// ============================================================================
// Types
// ============================================================================

export interface DuckDBTableProps {
  /** DuckDB table name to query */
  tableName: string;
  /** Optional column subset to select (defaults to *) */
  selectColumns?: string[];
  /** Column definitions (if known ahead of time) */
  columns?: VirtualTableColumn[];
  /** Per-column configuration overrides */
  columnConfigs?: VirtualTableColumnConfig[];
  /** Container height (default: 400px) */
  height?: number | string;
  /** Number of rows to fetch per page (default: 100) */
  pageSize?: number;
  /** Smaller padding/font for dense views */
  compact?: boolean;
  /** Additional className for the container */
  className?: string;
  /** Called when a cell is clicked */
  onCellClick?: (columnName: string, value: unknown, rowIndex: number) => void;
  /** Called when a column header is clicked */
  onHeaderClick?: (columnName: string) => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * DuckDBTable - A thin wrapper around VirtualTable for DuckDB queries
 *
 * This component:
 * 1. Uses the DuckDB connection from context
 * 2. Implements the onFetchData callback with SQL queries
 * 3. Delegates all rendering to VirtualTable
 *
 * @example
 * ```tsx
 * // Display all data from a table
 * <DuckDBTable tableName="users" height={500} />
 *
 * // With column selection
 * <DuckDBTable
 *   tableName="orders"
 *   selectColumns={["id", "customer", "total"]}
 *   compact
 * />
 * ```
 */
export function DuckDBTable({
  tableName,
  selectColumns,
  columns,
  columnConfigs,
  height = 400,
  pageSize = 100,
  compact = false,
  className,
  onCellClick,
  onHeaderClick,
}: DuckDBTableProps) {
  const { connection, isInitialized, error: dbError } = useDuckDB();
  const [inferredColumns, setInferredColumns] = useState<VirtualTableColumn[]>(
    [],
  );

  // Infer columns from table schema if not provided
  useEffect(() => {
    if (!isInitialized || !connection || columns) return;

    (async () => {
      try {
        const result = await connection.query(`DESCRIBE ${tableName}`);
        const rows = result.toArray();
        const cols: VirtualTableColumn[] = rows.map(
          (row: Record<string, unknown>) => ({
            name: String(row.column_name ?? row.Field ?? row.name),
            type: String(row.column_type ?? row.Type ?? row.type ?? "unknown"),
          }),
        );
        setInferredColumns(cols);
      } catch (err) {
        console.error("Failed to infer columns for table:", tableName, err);
      }
    })();
  }, [isInitialized, connection, tableName, columns]);

  // Build the fetch callback
  const handleFetchData = useCallback(
    async (params: FetchDataParams): Promise<FetchDataResult> => {
      if (!connection) {
        return { rows: [], totalCount: 0 };
      }

      const { offset, limit, sortColumn, sortDirection } = params;

      // Build column selection
      const cols = selectColumns?.length ? selectColumns.join(", ") : "*";

      // Build ORDER BY clause
      const orderBy = sortColumn
        ? `ORDER BY ${sortColumn} ${(sortDirection ?? "asc").toUpperCase()}`
        : "";

      // Execute data query
      const dataQuery = `SELECT ${cols} FROM ${tableName} ${orderBy} LIMIT ${limit} OFFSET ${offset}`;
      const dataResult = await connection.query(dataQuery);
      const rows = dataResult.toArray() as Record<string, unknown>[];

      // Execute count query
      const countQuery = `SELECT COUNT(*) as count FROM ${tableName}`;
      const countResult = await connection.query(countQuery);
      const countRow = countResult.toArray()[0] as { count: bigint | number };
      const totalCount = Number(countRow.count);

      return { rows, totalCount };
    },
    [connection, tableName, selectColumns],
  );

  // Handle loading and error states
  if (dbError) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
        <p className="text-sm text-destructive">
          DuckDB Error: {dbError.message}
        </p>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="flex h-32 items-center justify-center">
        <span className="text-sm text-muted-foreground">
          Initializing DuckDB...
        </span>
      </div>
    );
  }

  return (
    <VirtualTable
      columns={columns ?? inferredColumns}
      columnConfigs={columnConfigs}
      onFetchData={handleFetchData}
      height={height}
      pageSize={pageSize}
      compact={compact}
      className={className}
      onCellClick={onCellClick}
      onHeaderClick={onHeaderClick}
    />
  );
}
