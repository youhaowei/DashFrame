import { useDuckDB } from "@/components/providers/DuckDBProvider";
import {
  getDataFrame,
  type DataFrameEntry,
} from "@/lib/data-access/data-frames";
import { api } from "@/wystack/api";
import type {
  ColumnType,
  DataFrameColumn,
  DataFrameData,
  DataFrameRow,
  UUID,
} from "@dashframe/types";
import { useQuery } from "@wystack/client";
import { DataType } from "apache-arrow";
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

const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function isDateString(value: string): boolean {
  if (!ISO_DATE.test(value) && !ISO_TIMESTAMP_WITH_OFFSET.test(value)) {
    return false;
  }
  if (Number.isNaN(Date.parse(value))) return false;

  const dateParts = DATE_PREFIX.exec(value);
  if (!dateParts) return false;

  const year = Number(dateParts[1]);
  const month = Number(dateParts[2]);
  const day = Number(dateParts[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  return (
    calendarDate.getUTCFullYear() === year &&
    calendarDate.getUTCMonth() === month - 1 &&
    calendarDate.getUTCDate() === day
  );
}

function inferValueType(value: unknown): ColumnType {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return "date";
  if (typeof value === "string" && isDateString(value)) return "date";
  return "string";
}

function widenColumnType(
  current: ColumnType,
  candidate: ColumnType,
): ColumnType {
  if (current === "unknown" || current === candidate) return candidate;
  return "string";
}

/** Infer a column type from every non-null value in the returned data sample. */
function inferColumnType(values: unknown[]): ColumnType {
  let type: ColumnType = "unknown";
  for (const value of values) {
    if (value === null || value === undefined) continue;
    type = widenColumnType(type, inferValueType(value));
    if (type === "string") return type;
  }
  return type;
}

/** Extract declared column types from the Arrow schema, falling back to rows. */
type ArrowField = {
  name: string;
  type: unknown;
};

function columnTypeFromArrow(type: unknown): ColumnType {
  if (DataType.isNull(type)) return "unknown";
  if (DataType.isBool(type)) return "boolean";
  if (
    DataType.isInt(type) ||
    DataType.isFloat(type) ||
    DataType.isDecimal(type)
  ) {
    return "number";
  }
  if (DataType.isDate(type) || DataType.isTimestamp(type)) return "date";
  return "string";
}

function extractColumns(
  rows: DataFrameRow[],
  fields: readonly ArrowField[] = [],
): DataFrameColumn[] {
  if (fields.length > 0) {
    return fields.map((field) => ({
      name: field.name,
      type: columnTypeFromArrow(field.type),
    }));
  }

  if (rows.length === 0) return [];

  const firstRow = rows[0]!;
  const columnNames = Object.keys(firstRow);

  return columnNames.map((name) => ({
    name,
    type: inferColumnType(rows.map((row) => row[name])),
  }));
}

/**
 * Hook to load DataFrame data from the server into DuckDB for querying.
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
  const { connection, isInitialized, isLoading: isDuckDBLoading } = useDuckDB();
  const { data: allDataFrames } = useQuery(api.listDataFrames);

  // Find the entry from the reactive data
  const entry = useMemo(
    () => allDataFrames?.find((df) => df.id === dataFrameId),
    [allDataFrames, dataFrameId],
  );

  const [data, setData] = useState<DataFrameData | null>(null);
  // Start loading if we have a dataFrameId and aren't skipping
  // The actual load will only happen when connection is ready
  const [isLoading, setIsLoading] = useState(
    () => !!dataFrameId && !(options?.skip ?? false),
  );
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
      // Bump the token even on the skip path. If the hook flips to skipped /
      // no-id while a prior load is in flight (e.g. dataFrameId cleared or
      // skip toggled true on a mounted component), incrementing here means the
      // in-flight load's token check (currentLoadCount === loadCountRef.current)
      // now fails, so its resolved-but-stale result is discarded instead of
      // landing over the skipped state.
      ++loadCountRef.current;
      return;
    }

    // Capture the generation token BEFORE the first await so that any
    // in-flight request from a superseded dataFrameId can be discarded.
    const currentLoadCount = ++loadCountRef.current;

    setIsLoading(true);
    setError(null);

    const dataFrame = await getDataFrame(dataFrameId);
    if (!dataFrame) {
      if (currentLoadCount === loadCountRef.current) {
        setError(`DataFrame not found: ${dataFrameId}`);
        setData(null);
        setIsLoading(false);
      }
      return;
    }

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
          const columns = extractColumns(rows, result.schema.fields);
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
  const { data: allDataFrames } = useQuery(api.listDataFrames);

  // Find entry by insightId
  const entry = useMemo(
    () => allDataFrames?.find((df) => df.insightId === insightId),
    [allDataFrames, insightId],
  );

  return useDataFrameData(entry?.id, options);
}
