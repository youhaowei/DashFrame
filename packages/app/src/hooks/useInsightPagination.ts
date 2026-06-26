import { useDuckDB } from "@/components/providers/DuckDBProvider";
import { getDataFrame, getDataTable } from "@dashframe/core";
import type { EffectiveParams } from "@dashframe/engine";
import {
  buildInsightAvailableFields,
  buildInsightSQL,
  extractColumnAliasComponents,
  fieldIdToColumnAlias,
  metricIdToColumnAlias,
} from "@dashframe/engine";
import { ensureTableLoaded } from "@dashframe/engine-browser";
import type {
  ColumnType,
  DataTable,
  Field,
  Insight,
  UUID,
} from "@dashframe/types";
import type { FetchDataParams, FetchDataResult } from "@dashframe/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ── Module-level pure helpers ─────────────────────────────────────────────────

/**
 * Build a map of `"${rightTableId}:${instanceIndex}" → leftKey` by walking
 * insight.joins with the same counter logic as buildInsightAvailableFields.
 * Used by buildRepeatJoinDisplayNames to recover which join leftKey produced
 * each field alias, without needing to re-derive from the field alone.
 */
function buildJoinKeyByInstance(
  joins: NonNullable<Insight["joins"]>,
): Map<string, string> {
  const result = new Map<string, string>();
  const instanceCount = new Map<string, number>();
  for (const join of joins) {
    const idx = instanceCount.get(join.rightTableId) ?? 0;
    result.set(`${join.rightTableId}:${idx}`, join.leftKey);
    instanceCount.set(join.rightTableId, idx + 1);
  }
  return result;
}

/**
 * Build a display-name record for the given resolved fields, disambiguating
 * repeat-join collisions by appending the join's leftKey in parentheses.
 *
 * When the same right-table is joined twice (e.g. orders→users on `created_by`
 * AND `approved_by`), both instances produce fields with the same `field.name`
 * (e.g. "User Name").  This function detects collisions and produces distinct
 * labels for BOTH: "User Name (created_by)" and "User Name (approved_by)".
 * Fields not involved in a collision keep their bare `field.name`.
 *
 * `field.name` is NOT mutated — it remains the canonical human name.
 */
function buildRepeatJoinDisplayNames(
  resolvedFields: Field[],
  joinKeyByInstance: Map<string, string>,
): Record<string, string> {
  // First pass: find which base UUIDs have ≥2 instances (any _j1+ sibling).
  const baseUuidsWithRepeat = new Set<string>();
  for (const field of resolvedFields) {
    const components = extractColumnAliasComponents(
      fieldIdToColumnAlias(field.id),
    );
    if (components && components.instanceIndex > 0) {
      baseUuidsWithRepeat.add(components.uuid);
    }
  }

  // Second pass: build display names, applying disambiguation for collisions.
  const displayNames: Record<string, string> = {};
  for (const field of resolvedFields) {
    const alias = fieldIdToColumnAlias(field.id);
    const components = extractColumnAliasComponents(alias);
    if (components && baseUuidsWithRepeat.has(components.uuid)) {
      const leftKey = joinKeyByInstance.get(
        `${field.tableId}:${components.instanceIndex}`,
      );
      displayNames[alias] = leftKey ? `${field.name} (${leftKey})` : field.name;
    } else {
      displayNames[alias] = field.name;
    }
  }
  return displayNames;
}

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
  /**
   * Pre-resolved effective params from `resolveEffectiveParams` (cell overrides
   * coalesced with insight defaults).  When supplied, these filters/sorts/limit
   * are used INSTEAD of `insight.filters/sorts` — the insight is not mutated.
   *
   * Absent → the standard insight query behaviour (no change).
   */
  effectiveParams?: EffectiveParams;
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
  effectiveParams,
}: UseInsightPaginationOptions) {
  const { connection, isInitialized, isLoading: isDuckDBLoading } = useDuckDB();

  // State
  const [totalCount, setTotalCount] = useState<number>(0);
  const [columns, setColumns] = useState<{ name: string; type?: string }[]>([]);
  const [fieldCount, setFieldCount] = useState<number>(0);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvedFields, setResolvedFields] = useState<Field[]>([]);

  // Generation counter: incremented on every init effect run so stale async
  // completions from a superseded insight config never overwrite current state.
  const genRef = useRef(0);

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

    // NOTE: the cache write (resolvedTablesRef.current = ...) is intentionally
    // NOT done here. Writing the cache inside resolveTables() — before any
    // generation check — would allow a stale init for insight A to overwrite
    // the cache after insight B's init has already populated it, corrupting
    // subsequent fetchData calls with A's table references.
    // The caller (init) writes the cache after its generation check passes.

    // Collect fields visible in the SQL result set.
    //
    // `buildInsightAvailableFields` mirrors `buildJoinedSQL`'s field accumulation
    // exactly — it drops right join-keys and returns synthetic Field objects with
    // instance-suffixed IDs (field.id = `<uuid>_j{n}`) for repeat-joins (two
    // joins to the same rightTableId).  Because `columnDisplayNames` and
    // `columnTypeMap` are keyed on `fieldIdToColumnAlias(field.id)`, they will
    // map `field_<uuid>_j{n}` → the right display name / type — matching the
    // actual SQL column aliases DuckDB produces from the join builder.
    //
    // Deriving this list independently (e.g. via computeCombinedFields + manual
    // key-drop) risks a desync: if the builder skips a join instance (missing
    // keys), the counter stays at n while an independent re-derive would advance
    // to n+1, putting the hook's map one alias ahead of what DuckDB emitted.
    // Single-sourcing through `buildInsightAvailableFields` eliminates that gap.
    //
    // `buildInsightAvailableFields` accepts `Pick<Insight, "joins">`, so we extract
    // `joins` and pass a minimal object. This also keeps `insight.joins` in the dep
    // array below without introducing the full mutable `insight` reference.
    const joins = insight.joins;
    const allFields: Field[] =
      buildInsightAvailableFields(baseTable, joinedTables, { joins }) ??
      (baseTable.fields ?? []).filter((f) => !f.name.startsWith("_"));

    return { baseTable, joinedTables, allFields };
  }, [insight.baseTableId, insight.joins]);

  // Build mapping from UUID column aliases to display names.
  // This allows VirtualTable to show human-readable column headers.
  //
  // For repeat-join insights (same rightTableId joined twice), both join
  // instances produce fields with identical `field.name` values.
  // buildRepeatJoinDisplayNames detects these collisions and appends the
  // join's leftKey so pickers and headers show e.g. "User Name (created_by)"
  // vs "User Name (approved_by)".  field.name is NOT mutated.
  const columnDisplayNames = useMemo(() => {
    const joinKeyByInstance = insight.joins?.length
      ? buildJoinKeyByInstance(insight.joins)
      : new Map<string, string>();

    const displayNames = buildRepeatJoinDisplayNames(
      resolvedFields,
      joinKeyByInstance,
    );

    // Map metric IDs to display names
    for (const metric of insight.metrics ?? []) {
      const alias = metricIdToColumnAlias(metric.id);
      displayNames[alias] = metric.name;
    }

    return displayNames;
  }, [resolvedFields, insight.metrics, insight.joins]);

  // Build mapping from UUID column aliases to ColumnType.
  // Metrics are always numeric (aggregations); fields carry their declared type.
  // Consumers use this to drive type-aware cell formatting (e.g. epoch → date).
  const columnTypeMap = useMemo((): Record<string, ColumnType> => {
    const typeMap: Record<string, ColumnType> = {};

    for (const field of resolvedFields) {
      const alias = fieldIdToColumnAlias(field.id);
      typeMap[alias] = field.type;
    }

    // Metrics are aggregations — always numeric
    for (const metric of insight.metrics ?? []) {
      const alias = metricIdToColumnAlias(metric.id);
      typeMap[alias] = "number";
    }

    return typeMap;
  }, [resolvedFields, insight.metrics]);

  // Load DataFrames into DuckDB (parallel loading for performance)
  const loadDataFrames = useCallback(
    async (baseTable: DataTable, joinedTables: Map<UUID, DataTable>) => {
      if (!connection || isDuckDBLoading) return false;

      // Load base DataFrame
      if (!baseTable.dataFrameId) return false;

      const baseDataFrame = await getDataFrame(baseTable.dataFrameId);
      if (!baseDataFrame) {
        // Do not call setError here — loadDataFrames has no access to the
        // caller's generation token. The caller (init) checks the token after
        // awaiting this function and emits the error there.
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
    // Skip initialization if hook is disabled (lazy loading optimization).
    // Bump the token on this path too: if `enabled` flips false while a prior
    // init is in flight (e.g. the insight clears on a mounted VisualizationDisplay),
    // incrementing here invalidates that in-flight init's gen check so its stale
    // result is discarded instead of landing over the now-disabled state.
    if (!enabled) {
      ++genRef.current;
      return;
    }

    if (!connection || !isInitialized || isDuckDBLoading) {
      // Same rationale for the not-ready path: bump so an in-flight init from a
      // moment when DuckDB WAS ready cannot land after it goes unavailable.
      ++genRef.current;
      requestAnimationFrame(() => setIsReady(false));
      return;
    }

    // Capture token before the first await — any earlier in-flight init that
    // resolves after this point will see a stale token and discard its results.
    const gen = ++genRef.current;

    // eslint-disable-next-line sonarjs/cognitive-complexity -- defensive stale-state guards (gen checks) after every await legitimately raise complexity; extracting further would obscure the guard pattern
    const init = async () => {
      try {
        // Resolve tables
        const { baseTable, joinedTables, allFields } = await resolveTables();
        if (gen !== genRef.current) return; // superseded
        if (!baseTable) {
          setError("Base table not found");
          setIsReady(false);
          return;
        }

        // Write the table cache AFTER the gen check so a stale init for insight A
        // cannot overwrite the cache that a faster init for insight B already set.
        resolvedTablesRef.current = { baseTable, joinedTables };

        // Store resolved fields for display name mapping
        setResolvedFields(allFields);

        // Load DataFrames into DuckDB.
        // Error messages from failed loads are emitted HERE (after the gen check)
        // rather than inside loadDataFrames, which has no access to the gen token.
        const loaded = await loadDataFrames(baseTable, joinedTables);
        if (gen !== genRef.current) return; // superseded
        if (!loaded) {
          setError(`Failed to load DataFrames for table: ${baseTable.id}`);
          setIsReady(false);
          return;
        }

        // Build SQL for count query.
        // When effective params are supplied (per-cell overrides), inject them
        // so the count reflects the overridden filters/limit.
        const mode = showModelPreview ? "model" : "query";
        const overrideOptions =
          !showModelPreview && effectiveParams
            ? {
                effectiveFilters: effectiveParams.filters,
                effectiveSorts: effectiveParams.sorts,
                effectiveLimit: effectiveParams.limit,
              }
            : {};
        const countSQL = buildInsightSQL(baseTable, joinedTables, insight, {
          mode,
          ...overrideOptions,
        });

        if (!countSQL) {
          setError("Failed to build SQL query");
          setIsReady(false);
          return;
        }

        // Execute count query
        const countQuery = `SELECT COUNT(*) as count FROM (${countSQL})`;
        const countResult = await connection.query(countQuery);
        if (gen !== genRef.current) return; // superseded
        const count = Number(countResult.toArray()[0]?.count ?? 0);
        setTotalCount(count);

        // Get column info from preview query
        const previewSQL = buildInsightSQL(baseTable, joinedTables, insight, {
          mode,
          limit: 1,
          ...overrideOptions,
        });

        if (previewSQL) {
          const previewResult = await connection.query(previewSQL);
          if (gen !== genRef.current) return; // superseded
          const rows = previewResult.toArray() as Record<string, unknown>[];

          const cols =
            rows.length > 0
              ? Object.keys(rows[0]!)
                  .filter((key) => !key.startsWith("_"))
                  .map((name) => ({ name }))
              : [];
          requestAnimationFrame(() => {
            if (gen !== genRef.current) return; // superseded inside rAF
            setColumns(cols);
            setFieldCount(cols.length);
          });
        }

        requestAnimationFrame(() => {
          if (gen !== genRef.current) return; // superseded inside rAF
          setIsReady(true);
          setError(null);
        });
      } catch (err) {
        console.error("Failed to initialize insight pagination:", err);
        if (gen !== genRef.current) return; // superseded
        requestAnimationFrame(() => {
          if (gen !== genRef.current) return; // superseded inside rAF
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
    effectiveParams,
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

        // Build SQL with pagination.
        // Inject effective params (per-cell overrides) when available.
        // effectiveLimit caps the total result set — it is NOT the page fetch
        // size.  We clamp the page fetch to the remaining rows after offset so
        // VirtualTable never reads past the cell limit, while still fetching one
        // page at a time (no memory blowup from fetching all rows at once).
        const mode = showModelPreview ? "model" : "query";
        const cellLimit =
          !showModelPreview && effectiveParams?.limit !== undefined
            ? effectiveParams.limit
            : undefined;
        const pageLimit =
          cellLimit !== undefined
            ? Math.min(
                params.limit,
                Math.max(0, cellLimit - (params.offset ?? 0)),
              )
            : params.limit;
        const overrideOpts =
          !showModelPreview && effectiveParams
            ? {
                effectiveFilters: effectiveParams.filters,
                effectiveSorts: effectiveParams.sorts,
                // Do NOT forward effectiveLimit here — pagination limit is
                // already clamped to the cell limit via pageLimit above.
                // Forwarding it would replace the page size with the cell cap.
              }
            : {};
        const sql = buildInsightSQL(baseTable, joinedTables, insight, {
          mode,
          limit: pageLimit,
          offset: params.offset,
          sortColumn: params.sortColumn,
          sortDirection: params.sortDirection,
          ...overrideOpts,
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
      effectiveParams,
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
    /**
     * Mapping from UUID column aliases to ColumnType.
     * Use this to drive type-aware cell formatting (e.g. epoch millis → date).
     *
     * Keys: `field_<uuid>` or `metric_<uuid>`
     * Values: "string" | "number" | "boolean" | "date" | "unknown"
     */
    columnTypeMap,
    /**
     * Instance-qualified Field list produced by buildInsightAvailableFields.
     * For repeat-joins (same rightTableId twice), fields from the Nth instance
     * carry synthetic IDs with `_j{N}` suffix (e.g. `<uuid>_j1`).
     * Use this as `availableFields` in pickers that must expose both instances
     * as distinct selectable options.
     */
    resolvedFields,
  };
}
