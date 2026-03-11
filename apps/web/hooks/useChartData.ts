import { useDuckDB } from "@/components/providers/DuckDBProvider";
import { useEffect, useMemo, useRef, useState } from "react";

interface ChartDataState {
  data: Record<string, unknown>[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * Fetches all rows from a DuckDB table/view as plain objects.
 *
 * Used by Chart-wrapping components to convert a DuckDB table reference
 * into an inline data array for the Vega-Lite renderer.
 *
 * The view is assumed to already exist (created by useInsightView or similar).
 */
export function useChartData(tableName: string | undefined) {
  const { connection } = useDuckDB();
  const [state, setState] = useState<ChartDataState>({
    data: [],
    isLoading: false,
    error: null,
  });
  const queryIdRef = useRef(0);

  // Determine if we can fetch
  const canFetch = !!connection && !!tableName;

  useEffect(() => {
    if (!canFetch) return;

    const queryId = ++queryIdRef.current;

    // Use microtask to avoid synchronous setState in effect body
    queueMicrotask(() => {
      if (queryId !== queryIdRef.current) return;
      setState({ data: [], isLoading: true, error: null });
    });

    (async () => {
      try {
        // LIMIT 10000: Keeps browser memory bounded for inline Vega-Lite rendering.
        // For aggregate chart types (bar, line), Vega-Lite does client-side aggregation
        // on this subset. For full accuracy on large datasets, push GROUP BY into
        // the DuckDB view definition (Phase 4 improvement).
        const result = await connection!.query(
          `SELECT * FROM "${tableName}" LIMIT 10000`,
        );
        if (queryId !== queryIdRef.current) return;

        const rows: Record<string, unknown>[] = [];
        const schema = result.schema;

        for (let i = 0; i < result.numRows; i++) {
          const row: Record<string, unknown> = {};
          for (const field of schema.fields) {
            const col = result.getChild(field.name);
            row[field.name] = col?.get(i);
          }
          rows.push(row);
        }

        setState({ data: rows, isLoading: false, error: null });
      } catch (err) {
        if (queryId !== queryIdRef.current) return;
        setState({
          data: [],
          isLoading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    })();
  }, [canFetch, connection, tableName]);

  // When inputs are missing, return empty state without triggering effect setState
  return useMemo(
    () =>
      canFetch
        ? state
        : {
            data: [] as Record<string, unknown>[],
            isLoading: false,
            error: null,
          },
    [canFetch, state],
  );
}
