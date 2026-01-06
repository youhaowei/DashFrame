import { useDuckDB } from "@/components/providers/DuckDBProvider";
import {
  getDataFrame,
  useDataFrames,
  type DataFrameEntry,
} from "@dashframe/core";
import type {
  ColumnType,
  DataFrameColumn,
  DataFrameData,
  DataFrameRow,
  UUID,
} from "@dashframe/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Global mutex to prevent concurrent loads of the same DataFrame
const loadingPromises = new Map<string, Promise<void>>();

/**
 * Return type for useDataFrameData hook
 */
export interface UseDataFrameDataResult {
  /** Loaded row and column data (null while loading or on error) */
  data: DataFrameData | null;
  /** Whether data is currently being loaded */
  isLoading: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** DataFrame entry metadata from store */
  entry: DataFrameEntry | undefined;
  /** Manually trigger a reload */
  reload: () => void;
}

/**
 * Infer column type from values
 */
function inferColumnType(values: unknown[]): ColumnType {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
    if (value instanceof Date) return "date";
    if (typeof value === "string") {
      // Check if it looks like a date
      const date = Date.parse(value);
      if (!Number.isNaN(date) && value.includes("-")) return "date";
    }
    return "string";
  }
  return "unknown";
}

/**
 * Extract columns from DuckDB result rows
 */
function extractColumns(rows: DataFrameRow[]): DataFrameColumn[] {
  if (rows.length === 0) return [];

  const firstRow = rows[0];
  const columnNames = Object.keys(firstRow);

  return columnNames.map((name) => ({
    name,
    type: inferColumnType(rows.map((row) => row[name])),
  }));
}

/**
 * Hook to load DataFrame data from IndexedDB via DuckDB.
 *
 * This hook handles the async loading of data that is stored in IndexedDB
 * and needs to be loaded into DuckDB for querying.
 *
 * Triggers lazy DuckDB initialization on first call and returns loading state
 * while DuckDB initializes.
 *
 * @param dataFrameId - The UUID of the DataFrame to load, or undefined
 * @param options - Optional configuration
 * @returns Object with data, loading state, error, entry metadata, and reload function
 *
 * @example
 * ```tsx
 * const { data, isLoading, error, entry } = useDataFrameData(dataFrameId);
 *
 * if (isLoading) return <Skeleton />;
 * if (error) return <Alert variant="destructive">{error}</Alert>;
 * if (!data) return <EmptyState />;
 *
 * return <VirtualTable rows={data.rows} columns={data.columns} />;
 * ```
 */
export function useDataFrameData(
  dataFrameId: UUID | undefined,
  options?: {
    /** Maximum number of rows to load (default: 1000) */
    limit?: number;
    /** Skip loading even if dataFrameId is provided */
    skip?: boolean;
  },
): UseDataFrameDataResult {
  const { connection, isInitialized, isLoading: isDuckDBLoading } =
    useDuckDB();
  const { data: allDataFrames } = useDataFrames();

  // Find the entry from the reactive data
  const entry = useMemo(
    () => allDataFrames?.find((df) => df.id === dataFrameId),
    [allDataFrames, dataFrameId],
  );

  const [data, setData] = useState<DataFrameData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the last loaded dataFrameId to prevent unnecessary reloads
  const lastLoadedIdRef = useRef<string | null>(null);
  const loadCountRef = useRef(0);

  const limit = options?.limit ?? 1000;
  const skip = options?.skip ?? false;

  const loadData = useCallback(async () => {
    if (
      !dataFrameId ||
      !connection ||
      !isInitialized ||
      isDuckDBLoading ||
      skip
    ) {
      return;
    }

    // Get the DataFrame instance from Dexie (async)
    const dataFrame = await getDataFrame(dataFrameId);
    if (!dataFrame) {
      setError(`DataFrame not found: ${dataFrameId}`);
      setData(null);
      return;
    }

    // Increment load count to track this specific load operation
    const currentLoadCount = ++loadCountRef.current;

    setIsLoading(true);
    setError(null);

    try {
      // Wait for any existing load of this DataFrame to complete (mutex)
      const existingLoad = loadingPromises.get(dataFrameId);
      if (existingLoad) {
        await existingLoad;
      }

      // Create a new promise for this load operation
      let resolveLoad: () => void;
      const loadPromise = new Promise<void>((resolve) => {
        resolveLoad = resolve;
      });
      loadingPromises.set(dataFrameId, loadPromise);

      try {
        // Load data from IndexedDB into DuckDB and query
        const queryBuilder = await dataFrame.load(connection);
        // Skip limit clause when Infinity is passed (load all rows)
        const finalQuery = Number.isFinite(limit)
          ? queryBuilder.limit(limit)
          : queryBuilder;
        const sql = await finalQuery.sql();
        const result = await connection.query(sql);
        const rows = result.toArray() as DataFrameRow[];

        // Only update state if this is still the most recent load
        if (currentLoadCount === loadCountRef.current) {
          const columns = extractColumns(rows);
          setData({ rows, columns });
          lastLoadedIdRef.current = dataFrameId;
        }
      } finally {
        // Release the mutex
        resolveLoad!();
        loadingPromises.delete(dataFrameId);
      }
    } catch (err) {
      // Only update error if this is still the most recent load
      if (currentLoadCount === loadCountRef.current) {
        const message =
          err instanceof Error ? err.message : "Failed to load DataFrame";
        setError(message);
        setData(null);
        console.error("Failed to load DataFrame:", err);
      }
    } finally {
      // Only update loading state if this is still the most recent load
      if (currentLoadCount === loadCountRef.current) {
        setIsLoading(false);
      }
    }
  }, [dataFrameId, connection, isInitialized, isDuckDBLoading, limit, skip]);

  // Load data when dataFrameId changes or connection becomes available
  useEffect(() => {
    // Skip if we've already loaded this dataFrameId
    if (dataFrameId && lastLoadedIdRef.current === dataFrameId && data) {
      return;
    }

    // Clear data when dataFrameId changes
    if (dataFrameId !== lastLoadedIdRef.current) {
      setData(null);
      lastLoadedIdRef.current = null;
    }

    loadData();
  }, [dataFrameId, loadData, data]);

  // Manual reload function
  const reload = useCallback(() => {
    lastLoadedIdRef.current = null;
    loadData();
  }, [loadData]);

  return {
    data,
    isLoading,
    error,
    entry,
    reload,
  };
}

/**
 * Hook to load DataFrame data by insight ID.
 * Useful when you have an insight but not the dataFrameId.
 */
export function useDataFrameDataByInsight(
  insightId: UUID | undefined,
  options?: {
    limit?: number;
    skip?: boolean;
  },
): UseDataFrameDataResult {
  const { data: allDataFrames } = useDataFrames();

  // Find entry by insightId
  const entry = useMemo(
    () => allDataFrames?.find((df) => df.insightId === insightId),
    [allDataFrames, insightId],
  );

  return useDataFrameData(entry?.id, options);
}
