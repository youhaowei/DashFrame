import { useCallback, useState, useEffect, useRef } from "react";
import { useDuckDB } from "@/components/providers/DuckDBProvider";
import { getDataFrame, getDataTable } from "@dashframe/core";
import { ensureTableLoaded } from "@dashframe/engine-browser";
import { buildInsightSQL } from "@dashframe/engine";
import type { FetchDataParams, FetchDataResult } from "@dashframe/ui";
import type { Insight, DataTable, UUID } from "@dashframe/types";

/**
 * Options for useInsightPagination hook.
 */
export interface UseInsightPaginationOptions {
  /** The insight configuration - contains joins, filters, metrics, selectedFields */
  insight: Insight;
  /**
   * Show the data model preview (full joined data without transformations).
   * - false (default): Apply full insight query (aggregations, filters, sorts)
   * - true: Show all rows from joined tables, ignore aggregations/filters
   */
  showModelPreview?: boolean;
}

/**
 * Hook for paginated Insight queries via DuckDB.
 *
 * Supports two modes:
 * 1. Model preview (showModelPreview=true): Shows all rows from base + joined tables without aggregations/filters
 * 2. Insight query (showModelPreview=false): Applies full insight configuration (GROUP BY, metrics, filters, sorts)
 *
 * The hook fetches required tables internally using getDataTable() from core.
 *
 * @example
 * ```tsx
 * const { fetchData, totalCount, fieldCount, isReady } = useInsightPagination({
 *   insight,
 *   showModelPreview: true // Show full joined data
 * });
 *
 * return isReady ? (
 *   <VirtualTable onFetchData={fetchData} />
 * ) : (
 *   <LoadingSpinner />
 * );
 * ```
 */
export function useInsightPagination({
  insight,
  showModelPreview = false,
}: UseInsightPaginationOptions) {
  const { connection, isInitialized } = useDuckDB();

  // State
  const [totalCount, setTotalCount] = useState<number>(0);
  const [columns, setColumns] = useState<{ name: string; type?: string }[]>([]);
  const [fieldCount, setFieldCount] = useState<number>(0);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cache resolved tables to avoid re-fetching
  const resolvedTablesRef = useRef<{
    baseTable: DataTable | null;
    joinedTables: Map<UUID, DataTable>;
  }>({ baseTable: null, joinedTables: new Map() });

  // Resolve tables: fetch base table and joined tables from core
  const resolveTables = useCallback(async (): Promise<{
    baseTable: DataTable | null;
    joinedTables: Map<UUID, DataTable>;
  }> => {
    // Fetch base table
    const baseTable = await getDataTable(insight.baseTableId);
    if (!baseTable) {
      return { baseTable: null, joinedTables: new Map() };
    }

    // Fetch joined tables
    const joinedTables = new Map<UUID, DataTable>();
    for (const join of insight.joins ?? []) {
      const joinTable = await getDataTable(join.rightTableId);
      if (joinTable) {
        joinedTables.set(join.rightTableId, joinTable);
      }
    }

    // Cache for later use
    resolvedTablesRef.current = { baseTable, joinedTables };

    return { baseTable, joinedTables };
  }, [insight.baseTableId, insight.joins]);

  // Load DataFrames into DuckDB
  const loadDataFrames = useCallback(
    async (baseTable: DataTable, joinedTables: Map<UUID, DataTable>) => {
      if (!connection) return false;

      // Load base DataFrame
      if (!baseTable.dataFrameId) return false;

      const baseDataFrame = await getDataFrame(baseTable.dataFrameId);
      if (!baseDataFrame) {
        setError(`Base DataFrame not found: ${baseTable.dataFrameId}`);
        return false;
      }
      await ensureTableLoaded(baseDataFrame, connection);

      // Load joined DataFrames
      for (const [, joinTable] of joinedTables) {
        if (!joinTable.dataFrameId) continue;

        const joinDataFrame = await getDataFrame(joinTable.dataFrameId);
        if (joinDataFrame) {
          await ensureTableLoaded(joinDataFrame, connection);
        }
      }

      return true;
    },
    [connection],
  );

  // Initialize: resolve tables, load DataFrames, get count
  useEffect(() => {
    if (!connection || !isInitialized) {
      requestAnimationFrame(() => setIsReady(false));
      return;
    }

    const init = async () => {
      try {
        // Resolve tables
        const { baseTable, joinedTables } = await resolveTables();
        if (!baseTable) {
          setError("Base table not found");
          setIsReady(false);
          return;
        }

        // Load DataFrames into DuckDB
        const loaded = await loadDataFrames(baseTable, joinedTables);
        if (!loaded) {
          setIsReady(false);
          return;
        }

        // Build SQL for count query
        const mode = showModelPreview ? "model" : "query";
        const countSQL = buildInsightSQL(baseTable, joinedTables, insight, {
          mode,
        });

        if (!countSQL) {
          setError("Failed to build SQL query");
          setIsReady(false);
          return;
        }

        // Execute count query
        const countQuery = `SELECT COUNT(*) as count FROM (${countSQL})`;
        const countResult = await connection.query(countQuery);
        const count = Number(countResult.toArray()[0]?.count ?? 0);
        setTotalCount(count);

        // Get column info from preview query
        const previewSQL = buildInsightSQL(baseTable, joinedTables, insight, {
          mode,
          limit: 1,
        });

        if (previewSQL) {
          const previewResult = await connection.query(previewSQL);
          const rows = previewResult.toArray() as Record<string, unknown>[];

          if (rows.length > 0) {
            const cols = Object.keys(rows[0])
              .filter((key) => !key.startsWith("_"))
              .map((name) => ({ name }));
            requestAnimationFrame(() => {
              setColumns(cols);
              setFieldCount(cols.length);
            });
          }
        }

        requestAnimationFrame(() => {
          setIsReady(true);
          setError(null);
        });
      } catch (err) {
        console.error("Failed to initialize insight pagination:", err);
        requestAnimationFrame(() => {
          setError(err instanceof Error ? err.message : "Failed to initialize");
          setIsReady(false);
        });
      }
    };

    init();
  }, [
    connection,
    isInitialized,
    insight,
    showModelPreview,
    resolveTables,
    loadDataFrames,
  ]);

  // Fetch callback for VirtualTable
  const fetchData = useCallback(
    async (params: FetchDataParams): Promise<FetchDataResult> => {
      if (!connection || !isInitialized) {
        return { rows: [], totalCount: 0 };
      }

      try {
        // Use cached tables or re-resolve
        let { baseTable, joinedTables } = resolvedTablesRef.current;
        if (!baseTable) {
          const resolved = await resolveTables();
          baseTable = resolved.baseTable;
          joinedTables = resolved.joinedTables;
        }

        if (!baseTable) {
          return { rows: [], totalCount: 0 };
        }

        // Ensure DataFrames are loaded (idempotent)
        await loadDataFrames(baseTable, joinedTables);

        // Build SQL with pagination
        const mode = showModelPreview ? "model" : "query";
        const sql = buildInsightSQL(baseTable, joinedTables, insight, {
          mode,
          limit: params.limit,
          offset: params.offset,
          sortColumn: params.sortColumn,
          sortDirection: params.sortDirection,
        });

        if (!sql) {
          console.warn("[fetchData] Failed to build SQL");
          return { rows: [], totalCount: 0 };
        }

        const result = await connection.query(sql);
        const rows = result.toArray() as Record<string, unknown>[];
        return { rows, totalCount };
      } catch (err) {
        console.error("Failed to fetch insight data:", err);
        return { rows: [], totalCount: 0 };
      }
    },
    [
      connection,
      isInitialized,
      insight,
      showModelPreview,
      resolveTables,
      loadDataFrames,
      totalCount,
    ],
  );

  return {
    fetchData,
    totalCount,
    columns,
    fieldCount,
    isReady,
    error,
  };
}
