import { queryDataFrame } from "@/lib/data-access/data-frames";
import { buildInsightColumnDisplayNames } from "@/lib/insight-column-display-names";
import { api } from "@/wystack/api";
import { getWyStackClient } from "@/wystack/client";
import {
  buildInsightAvailableFields,
  extractColumnAliasComponents,
} from "@dashframe/engine";
import type {
  ColumnType,
  DataTable,
  Field,
  Insight,
  InsightFetchDefinition,
  InsightRuntimeInput,
  UUID,
} from "@dashframe/types";
import type {
  FetchDataParams,
  FetchDataResult,
  VirtualTableColumn,
} from "@dashframe/ui";
import { useQuery } from "@wystack/client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const MAX_PAGE_SIZE = 500;
const SUGGESTION_SAMPLE_SIZE = 100;
const EMPTY_DATA_TABLES: readonly DataTable[] = [];
const EMPTY_INSIGHTS: readonly Insight[] = [];
const MAX_COMPOSITION_DEPTH = 16;

type ComposedInsight = Insight & {
  source?: { sourceType: "dataTable" | "insight"; sourceId: UUID };
};

export interface UseInsightPaginationOptions {
  insight: Insight;
  /** Unsaved previews are materialized ephemerally; saved insights use runInsight. */
  showModelPreview?: boolean;
  enabled?: boolean;
  runtime?: InsightRuntimeInput;
}

function toFetchDefinition(insight: Insight): InsightFetchDefinition {
  return {
    baseTableId: insight.baseTableId,
    selectedFields: insight.selectedFields,
    metrics: insight.metrics,
    filters: insight.filters,
    sorts: insight.sorts,
    joins: insight.joins,
  };
}

/**
 * Track only source-frame generations. Insight result publication does not
 * touch these DataTables, so this invalidates mounted consumers without
 * rematerializing in response to their own result pointer update.
 */
export function buildInsightSourceRevision(
  insight: Insight,
  dataTables: readonly DataTable[],
  insights: readonly Insight[] = EMPTY_INSIGHTS,
): string {
  const tableById = new Map(dataTables.map((table) => [table.id, table]));
  const insightById = new Map(
    insights
      .filter(
        (candidate) =>
          Array.isArray(candidate.selectedFields) &&
          Array.isArray(candidate.metrics),
      )
      .map((candidate) => [candidate.id, candidate as ComposedInsight]),
  );
  const parts: string[] = [];

  const visitTable = (tableId: UUID) => {
    const table = tableById.get(tableId);
    parts.push(
      table
        ? `table:${table.id}:${table.dataFrameId ?? ""}:${table.lastFetchedAt ?? ""}`
        : `missing-table:${tableId}`,
    );
  };
  const visitInsight = (
    candidate: ComposedInsight,
    ancestry: readonly UUID[],
  ) => {
    if (ancestry.includes(candidate.id)) {
      parts.push(`cycle:${candidate.id}`);
      return;
    }
    if (ancestry.length >= MAX_COMPOSITION_DEPTH) {
      parts.push(`depth:${candidate.id}`);
      return;
    }
    parts.push(
      `insight:${candidate.id}:${JSON.stringify(toFetchDefinition(candidate))}`,
    );
    const source = candidate.source;
    const upstream = insightById.get(source?.sourceId ?? candidate.baseTableId);
    if (source?.sourceType === "insight" || upstream) {
      if (upstream) visitInsight(upstream, [...ancestry, candidate.id]);
      else
        parts.push(
          `missing-insight:${source?.sourceId ?? candidate.baseTableId}`,
        );
    } else visitTable(candidate.baseTableId);
    for (const join of candidate.joins ?? []) visitTable(join.rightTableId);
  };

  const root = insight as ComposedInsight;
  const upstream = insightById.get(root.source?.sourceId ?? root.baseTableId);
  if (root.source?.sourceType === "insight" || upstream) {
    if (upstream) visitInsight(upstream, [root.id]);
    else
      parts.push(
        `missing-insight:${root.source?.sourceId ?? root.baseTableId}`,
      );
  } else visitTable(root.baseTableId);
  for (const join of root.joins ?? []) visitTable(join.rightTableId);
  return parts.join("|");
}

type ResultSchemaColumn = Readonly<{
  id: UUID;
  name: string;
  type: string;
}>;

/** Reconnect server result aliases to model fields and repeat-join labels. */
export function resolveInsightResultFields(
  schema: readonly ResultSchemaColumn[],
  insight: Insight,
  dataTables: readonly DataTable[],
): { fields: Field[]; displayNames: Record<string, string> } {
  const baseTable = dataTables.find(
    (table) => table.id === insight.baseTableId,
  );
  const joinedTables = new Map<UUID, DataTable>();
  for (const join of insight.joins ?? []) {
    const table = dataTables.find(
      (candidate) => candidate.id === join.rightTableId,
    );
    if (table) joinedTables.set(table.id, table);
  }
  const availableFields = baseTable
    ? (buildInsightAvailableFields(baseTable, joinedTables, insight) ?? [])
    : [];
  const availableById = new Map(
    availableFields.map((field) => [field.id, field]),
  );
  const parsedColumns = schema.map((column) => ({
    column,
    parsed: column.id.startsWith("field_")
      ? extractColumnAliasComponents(column.id)
      : null,
  }));
  const fields: Field[] = [];
  for (const { column, parsed } of parsedColumns) {
    if (!parsed) continue;
    const fieldId = `${parsed.uuid}${
      parsed.instanceIndex > 0 ? `_j${parsed.instanceIndex}` : ""
    }` as UUID;
    const modelField = availableById.get(fieldId);
    const field: Field = {
      ...(modelField ?? {
        id: fieldId,
        tableId: insight.baseTableId,
        name: column.name,
      }),
      columnName: column.id,
      type: column.type as ColumnType,
    };
    fields.push(field);
  }
  const displayNames = {
    ...Object.fromEntries(schema.map((column) => [column.id, column.name])),
    ...buildInsightColumnDisplayNames(
      insight,
      fields,
      baseTable ? { baseTable, joinedTables } : undefined,
    ),
  };
  return { fields, displayNames };
}

/**
 * Materialize an Insight on the server, then page its immutable DataFrame handle.
 * Browser DuckDB is deliberately not part of this path.
 */
export function useInsightPagination({
  insight,
  showModelPreview = false,
  enabled = true,
  runtime,
}: UseInsightPaginationOptions) {
  const dataTablesQuery = useQuery(api.listDataTables, { args: {} });
  const dataTables = dataTablesQuery.data ?? EMPTY_DATA_TABLES;
  const insightsQuery = useQuery(api.listInsights, { args: {} });
  const insights = insightsQuery.data ?? EMPTY_INSIGHTS;
  const sourcesReady =
    dataTablesQuery.isLoading !== true && insightsQuery.isLoading !== true;
  const [totalCount, setTotalCount] = useState(0);
  const [columns, setColumns] = useState<VirtualTableColumn[]>([]);
  const [fieldCount, setFieldCount] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataFrameId, setDataFrameId] = useState<UUID | null>(null);
  const [schema, setSchema] = useState<
    readonly { id: UUID; name: string; type: string }[]
  >([]);
  const [sampleRows, setSampleRows] = useState<Record<string, unknown>[]>([]);
  const [isStale, setIsStale] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [staleReason, setStaleReason] = useState<string | null>(null);
  const generation = useRef(0);
  const activeDataFrameId = useRef<UUID | null>(dataFrameId);
  useLayoutEffect(() => {
    activeDataFrameId.current = dataFrameId;
  }, [dataFrameId]);

  const runtimeKey = JSON.stringify(runtime ?? null);
  const insightKey = JSON.stringify(toFetchDefinition(insight));
  const sourceRevision = buildInsightSourceRevision(
    insight,
    dataTables,
    insights,
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runtimeKey is the stable structural dependency.
  const stableRuntime = useMemo(() => runtime, [runtimeKey]);

  useLayoutEffect(() => {
    generation.current += 1;
  }, [
    enabled,
    insight.id,
    insightKey,
    runtimeKey,
    showModelPreview,
    sourceRevision,
    sourcesReady,
  ]);

  useEffect(() => {
    const current = generation.current;
    if (!enabled || !insight.id || !sourcesReady) {
      queueMicrotask(() => {
        if (current !== generation.current) return;
        setDataFrameId(null);
        setTotalCount(0);
        setColumns([]);
        setSchema([]);
        setSampleRows([]);
        setFieldCount(0);
        setError(null);
        setIsReady(false);
        setIsStale(false);
        setFetchedAt(null);
        setStaleReason(null);
      });
      return;
    }
    queueMicrotask(() => {
      if (current !== generation.current) return;
      setDataFrameId(null);
      setTotalCount(0);
      setColumns([]);
      setSchema([]);
      setSampleRows([]);
      setFieldCount(0);
      setIsReady(false);
      setError(null);
      setIsStale(false);
      setFetchedAt(null);
      setStaleReason(null);
    });
    const materialized = showModelPreview
      ? getWyStackClient().mutate(api.fetchData, {
          insight: toFetchDefinition(insight),
        })
      : getWyStackClient().mutate(api.runInsight, {
          insightId: insight.id,
          ...(stableRuntime ? { runtime: stableRuntime } : {}),
        });
    materialized.then(
      async (fetchResult) => {
        if (current !== generation.current) return;
        const retained =
          fetchResult.status === "failed" ? fetchResult.lastSuccessful : null;
        if (fetchResult.status === "failed" && !retained) {
          setDataFrameId(null);
          setTotalCount(0);
          setColumns([]);
          setSchema([]);
          setSampleRows([]);
          setFieldCount(0);
          setError(fetchResult.message);
          setIsReady(false);
          return;
        }
        const resultFrame =
          fetchResult.status === "ready" ? fetchResult : retained!;
        let page;
        try {
          page = await queryDataFrame(resultFrame.dataFrameId, {
            offset: 0,
            limit: SUGGESTION_SAMPLE_SIZE,
          });
        } catch (cause) {
          if (current !== generation.current) return;
          setDataFrameId(null);
          setTotalCount(0);
          setColumns([]);
          setSchema([]);
          setSampleRows([]);
          setFieldCount(0);
          setError(
            cause instanceof Error ? cause.message : "Failed to read Insight",
          );
          setIsReady(false);
          return;
        }
        if (current !== generation.current) return;
        if (page.status === "failed") {
          setDataFrameId(null);
          setTotalCount(0);
          setColumns([]);
          setSchema([]);
          setSampleRows([]);
          setFieldCount(0);
          setError(page.message);
          setIsReady(false);
          return;
        }
        const effectiveCount = stableRuntime?.limit
          ? Math.min(page.totalCount, stableRuntime.limit)
          : page.totalCount;
        const nextColumns: VirtualTableColumn[] = page.schema.map(
          ({ id, type }) => ({ name: id, type: type as ColumnType }),
        );
        setDataFrameId(resultFrame.dataFrameId);
        setTotalCount(effectiveCount);
        setColumns(nextColumns);
        setSchema(page.schema);
        setSampleRows(page.rows);
        setFieldCount(nextColumns.length);
        setError(null);
        setIsReady(true);
        setIsStale(fetchResult.status === "failed");
        setFetchedAt(resultFrame.fetchedAt);
        setStaleReason(
          fetchResult.status === "failed" ? fetchResult.message : null,
        );
      },
      (cause: unknown) => {
        if (current !== generation.current) return;
        setDataFrameId(null);
        setTotalCount(0);
        setColumns([]);
        setSchema([]);
        setSampleRows([]);
        setFieldCount(0);
        setError(
          cause instanceof Error ? cause.message : "Failed to run Insight",
        );
        setIsReady(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- structural keys intentionally gate rematerialization.
  }, [
    enabled,
    insight.id,
    insightKey,
    runtimeKey,
    showModelPreview,
    sourceRevision,
    sourcesReady,
    // stableRuntime is represented by runtimeKey above.
  ]);

  const fetchData = useCallback(
    async (params: FetchDataParams): Promise<FetchDataResult> => {
      if (!dataFrameId) return { rows: [], totalCount: 0 };
      const current = generation.current;
      const requestedDataFrameId = dataFrameId;
      const remaining = stableRuntime?.limit
        ? Math.max(0, stableRuntime.limit - params.offset)
        : params.limit;
      if (remaining === 0) return { rows: [], totalCount };
      let page;
      try {
        page = await queryDataFrame(dataFrameId, {
          offset: params.offset,
          limit: Math.min(params.limit, remaining, MAX_PAGE_SIZE),
          sort:
            params.sortColumn && params.sortDirection
              ? [
                  {
                    fieldId: params.sortColumn as UUID,
                    direction: params.sortDirection,
                  },
                ]
              : undefined,
        });
      } catch {
        return { rows: [], totalCount: 0 };
      }
      if (
        current !== generation.current ||
        activeDataFrameId.current !== requestedDataFrameId
      ) {
        return { rows: [], totalCount: 0 };
      }
      return page.status === "ready"
        ? { rows: page.rows, totalCount }
        : { rows: [], totalCount: 0 };
    },
    [dataFrameId, stableRuntime, totalCount],
  );

  const { fields: resolvedFields, displayNames: columnDisplayNames } = useMemo(
    () => resolveInsightResultFields(schema, insight, dataTables),
    [dataTables, insight, schema],
  );

  return {
    dataFrameId,
    fetchData,
    totalCount,
    columns,
    fieldCount,
    isReady,
    error,
    schema,
    sampleRows,
    isStale,
    fetchedAt,
    staleReason,
    columnDisplayNames,
    columnTypeMap: Object.fromEntries(
      schema.map((column) => [column.id, column.type as ColumnType]),
    ),
    resolvedFields,
  };
}
