import { useDuckDB } from "@/components/providers/DuckDBProvider";
import { getDataFrame, useDataFrames } from "@dashframe/core";
import type { UUID } from "@dashframe/types";
import type { FetchDataParams, FetchDataResult } from "@dashframe/ui";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Hook for paginated DataFrame queries via DuckDB
 *
 * Provides a `fetchData` callback compatible with VirtualTable's async mode.
 * Uses DuckDB LIMIT/OFFSET for efficient server-side pagination.
 *
 * Triggers lazy DuckDB initialization on first call and reflects loading state
 * via the `isReady` flag while DuckDB initializes.
 *
 * @example
 * ```tsx
 * const { fetchData, totalCount, columns, isReady } = useDataFramePagination(dataFrameId);
 *
 * return isReady ? (
 *   <VirtualTable onFetchData={fetchData} />
 * ) : (
 *   <LoadingSpinner />
 * );
 * ```
 */
export function useDataFramePagination(dataFrameId: UUID | undefined) {
  const { connection, isInitialized, isLoading: isDuckDBLoading } = useDuckDB();
  const { data: allDataFrames } = useDataFrames();

  // Find the entry from reactive Dexie data (replaces Zustand subscription)
  const entry = useMemo(
    () => allDataFrames?.find((df) => df.id === dataFrameId),
    [allDataFrames, dataFrameId],
  );

  const [totalCount, setTotalCount] = useState<number>(0);
  const [columns, setColumns] = useState<{ name: string; type?: string }[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch total count and column info on mount
  useEffect(() => {
    if (!dataFrameId || !connection || !isInitialized || isDuckDBLoading) {
      requestAnimationFrame(() => setIsReady(false));
      return;
    }

    const init = async () => {
      try {
        // Get DataFrame from Dexie (async)
        const dataFrame = await getDataFrame(dataFrameId);
        if (!dataFrame) {
          setError(`DataFrame not found: ${dataFrameId}`);
          setIsReady(false);
          return;
        }

        // Load table into DuckDB and get count
        const queryBuilder = await dataFrame.load(connection);

        // Get total count
        const countSql = `SELECT COUNT(*) as count FROM (${await queryBuilder.sql()})`;
        const countResult = await connection.query(countSql);
        const count = Number(countResult.toArray()[0]?.count ?? 0);
        setTotalCount(count);

        // Get column info from first row
        const previewSql = await queryBuilder.limit(1).sql();
        const previewResult = await connection.query(previewSql);
        const rows = previewResult.toArray() as Record<string, unknown>[];

        if (rows.length > 0) {
          const cols = Object.keys(rows[0])
            .filter((key) => !key.startsWith("_"))
            .map((name) => ({ name }));
          requestAnimationFrame(() => setColumns(cols));
        }

        requestAnimationFrame(() => {
          setIsReady(true);
          setError(null);
        });
      } catch (err) {
        console.error("Failed to initialize DataFrame pagination:", err);
        requestAnimationFrame(() => {
          setError(err instanceof Error ? err.message : "Failed to initialize");
          setIsReady(false);
        });
      }
    };

    init();
  }, [dataFrameId, connection, isInitialized, isDuckDBLoading, entry]);

  // Fetch callback for VirtualTable
  const fetchData = useCallback(
    async (params: FetchDataParams): Promise<FetchDataResult> => {
      if (!dataFrameId || !connection || !isInitialized || isDuckDBLoading) {
        return { rows: [], totalCount: 0 };
      }

      // Get DataFrame from Dexie (async)
      const dataFrame = await getDataFrame(dataFrameId);
      if (!dataFrame) {
        return { rows: [], totalCount: 0 };
      }

      try {
        let queryBuilder = await dataFrame.load(connection);

        // Apply sorting if specified
        if (params.sortColumn && params.sortDirection) {
          queryBuilder = queryBuilder.sort([
            { columnName: params.sortColumn, direction: params.sortDirection },
          ]);
        }

        // Apply pagination
        queryBuilder = queryBuilder.limit(params.limit).offset(params.offset);

        const sql = await queryBuilder.sql();
        const result = await connection.query(sql);
        const rows = result.toArray() as Record<string, unknown>[];

        return { rows, totalCount };
      } catch (err) {
        console.error("Failed to fetch DataFrame page:", err);
        return { rows: [], totalCount: 0 };
      }
    },
    [dataFrameId, connection, isInitialized, isDuckDBLoading, totalCount],
  );

  return {
    fetchData,
    totalCount,
    columns,
    isReady,
    error,
  };
}
