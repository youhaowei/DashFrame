import { useDuckDB } from "@/components/providers/DuckDBProvider";
import { getDataFrame, getDataTable } from "@dashframe/core";
import {
  buildInsightSQL,
  fieldIdToColumnAlias,
  metricIdToColumnAlias,
} from "@dashframe/engine";
import { ensureTableLoaded } from "@dashframe/engine-browser";
import type { DataTable, Field, Insight, UUID } from "@dashframe/types";
import type { FetchDataParams, FetchDataResult } from "@dashframe/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  /**
   * Enable/disable the hook execution.
   * When false, the hook returns immediately without loading data.
   * Useful for lazy initialization - only load data when needed.
   * @default true
   */
  enabled?: boolean;
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
 * Triggers lazy DuckDB initialization on first call and handles the loading state
 * while DuckDB initializes.
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
  enabled = true,
}: UseInsightPaginationOptions) {
  const { connection, isInitialized, isLoading: isDuckDBLoading } = useDuckDB();

  // State
  const [totalCount, setTotalCount] = useState<number>(0);
  const [columns, setColumns] = useState<{ name: string; type?: string }[]>([]);
  const [fieldCount, setFieldCount] = useState<number>(0);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvedFields, setResolvedFields] = useState<Field[]>([]);

  // Cache resolved tables to avoid re-fetching
  const resolvedTablesRef = useRef<{
    baseTable: DataTable | null;
    joinedTables: Map<UUID, DataTable>;
  }>({ baseTable: null, joinedTables: new Map() });

  // Resolve tables: fetch base table and joined tables from core (parallel)
  const resolveTables = useCallback(async (): Promise<{
    baseTable: DataTable | null;
    joinedTables: Map<UUID, DataTable>;
    allFields: Field[];
  }> => {
    // Fetch base table and all joined tables in parallel
    const [baseTable, ...joinTableResults] = await Promise.all([
      getDataTable(insight.baseTableId),
      ...(insight.joins ?? []).map((join) => getDataTable(join.rightTableId)),
    ]);

    if (!baseTable) {
      return { baseTable: null, joinedTables: new Map(), allFields: [] };
    }

    // Build joined tables map from parallel results
    const joinedTables = new Map<UUID, DataTable>();
    (insight.joins ?? []).forEach((join, index) => {
      const joinTable = joinTableResults[index];
      if (joinTable) {
        joinedTables.set(join.rightTableId, joinTable);
      }
    });

    // Cache for later use
    resolvedTablesRef.current = { baseTable, joinedTables };

    // Collect all fields from base + joined tables
    const allFields: Field[] = [
      ...(baseTable.fields ?? []).filter((f) => !f.name.startsWith("_")),
    ];
    for (const joinTable of joinedTables.values()) {
      allFields.push(
        ...(joinTable.fields ?? []).filter((f) => !f.name.startsWith("_")),
      );
    }

    return { baseTable, joinedTables, allFields };
  }, [insight.baseTableId, insight.joins]);

  // Build mapping from UUID column aliases to display names
  // This allows VirtualTable to show human-readable column headers
  const columnDisplayNames = useMemo(() => {
    const displayNames: Record<string, string> = {};

    // Map field IDs to display names
    for (const field of resolvedFields) {
      const alias = fieldIdToColumnAlias(field.id);
      displayNames[alias] = field.name;
    }

    // Map metric IDs to display names
    for (const metric of insight.metrics ?? []) {
      const alias = metricIdToColumnAlias(metric.id);
      displayNames[alias] = metric.name;
    }

    return displayNames;
  }, [resolvedFields, insight.metrics]);

  // Load DataFrames into DuckDB (parallel loading for performance)
  const loadDataFrames = useCallback(
    async (baseTable: DataTable, joinedTables: Map<UUID, DataTable>) => {
      if (!connection || isDuckDBLoading) return false;

      // Load base DataFrame
      if (!baseTable.dataFrameId) return false;

      const baseDataFrame = await getDataFrame(baseTable.dataFrameId);
      if (!baseDataFrame) {
        setError(`Base DataFrame not found: ${baseTable.dataFrameId}`);
        return false;
      }

      // Collect all DataFrames to load
      const dataFramesToLoad = [baseDataFrame];

      // Get all joined DataFrames in parallel
      const joinLoadResults = await Promise.all(
        Array.from(joinedTables.values())
          .filter((t) => t.dataFrameId)
          .map((joinTable) => getDataFrame(joinTable.dataFrameId!)),
      );

      // Add successfully resolved join DataFrames
      joinLoadResults.forEach((df) => {
        if (df) dataFramesToLoad.push(df);
      });

      // Load ALL DataFrames into DuckDB in parallel
      await Promise.all(
        dataFramesToLoad.map((df) => ensureTableLoaded(df, connection)),
      );

      return true;
    },
    [connection, isDuckDBLoading],
  );

  // Initialize: resolve tables, load DataFrames, get count
  useEffect(() => {
    // Skip initialization if hook is disabled (lazy loading optimization)
    if (!enabled) {
      return;
    }

    if (!connection || !isInitialized || isDuckDBLoading) {
      requestAnimationFrame(() => setIsReady(false));
      return;
    }

    const init = async () => {
      try {
        // Resolve tables
        const { baseTable, joinedTables, allFields } = await resolveTables();
        if (!baseTable) {
          setError("Base table not found");
          setIsReady(false);
          return;
        }

        // Store resolved fields for display name mapping
        setResolvedFields(allFields);

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
    isDuckDBLoading,
    insight,
    showModelPreview,
    enabled,
    resolveTables,
    loadDataFrames,
  ]);

  // Fetch callback for VirtualTable
  const fetchData = useCallback(
    async (params: FetchDataParams): Promise<FetchDataResult> => {
      if (!connection || !isInitialized || isDuckDBLoading) {
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
      isDuckDBLoading,
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
    /**
     * Mapping from UUID column aliases to human-readable display names.
     * Use this to show friendly column headers in VirtualTable.
     *
     * Keys: `field_<uuid>` or `metric_<uuid>`
     * Values: Human-readable field/metric names
     */
    columnDisplayNames,
  };
}
