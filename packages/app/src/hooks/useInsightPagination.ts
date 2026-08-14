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

export interface UseInsightPaginationOptions {
  insight: Insight | null | undefined;
  /** Unsaved previews are materialized ephemerally; saved insights use runInsight. */
  showModelPreview?: boolean;
  enabled?: boolean;
  runtime?: InsightRuntimeInput;
}

function toFetchDefinition(insight: Insight): InsightFetchDefinition {
  return {
    baseTableId: insight.source.sourceId,
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
  insight: Insight | null | undefined,
  dataTables: readonly DataTable[],
  insights: readonly Insight[] = EMPTY_INSIGHTS,
): string {
  if (!insight) return "missing-insight";
  const tableById = new Map(dataTables.map((table) => [table.id, table]));
  const insightById = new Map(
    insights
      .filter(
        (candidate) =>
          Array.isArray(candidate.selectedFields) &&
          Array.isArray(candidate.metrics),
      )
      .map((candidate) => [candidate.id, candidate]),
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
  const visitInsight = (candidate: Insight, ancestry: readonly UUID[]) => {
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
    if (source.sourceType === "insight") {
      const upstream = insightById.get(source.sourceId);
      if (upstream) visitInsight(upstream, [...ancestry, candidate.id]);
      else parts.push(`missing-insight:${source.sourceId}`);
    } else visitTable(source.sourceId);
    for (const join of candidate.joins ?? []) visitTable(join.rightTableId);
  };

  const root = insight;
  if (root.source.sourceType === "insight") {
    const upstream = insightById.get(root.source.sourceId);
    if (upstream) visitInsight(upstream, [root.id]);
    else parts.push(`missing-insight:${root.source.sourceId}`);
  } else visitTable(root.source.sourceId);
  for (const join of root.joins ?? []) visitTable(join.rightTableId);
  return parts.join("|");
}

/** Resolve a composed Insight to the DataTable at the root of its source chain. */
export function resolveInsightSourceDataTable(
  insight: Insight | null | undefined,
  dataTables: readonly DataTable[],
  insights: readonly Insight[] = EMPTY_INSIGHTS,
): DataTable | undefined {
  if (!insight) return undefined;
  const tableById = new Map(dataTables.map((table) => [table.id, table]));
  const insightById = new Map(
    insights.map((candidate) => [candidate.id, candidate]),
  );
  const seen = new Set<UUID>();
  let current: Insight | undefined = insight;

  while (
    current &&
    !seen.has(current.id) &&
    seen.size < MAX_COMPOSITION_DEPTH
  ) {
    seen.add(current.id);
    if (current.source.sourceType === "dataTable") {
      return tableById.get(current.source.sourceId);
    }
    current = insightById.get(current.source.sourceId);
  }
  return undefined;
}

export function isSelfPublishedSourceRevision(
  before: string,
  after: string,
  sourceGenerations: readonly { tableId: UUID; dataFrameId: UUID }[],
): boolean {
  if (before === after) return false;
  const prior = before.split("|");
  const next = after.split("|");
  if (prior.length !== next.length) return false;
  let changed = false;
  const published = new Map(
    sourceGenerations.map(({ tableId, dataFrameId }) => [tableId, dataFrameId]),
  );
  for (let index = 0; index < prior.length; index += 1) {
    if (prior[index] === next[index]) continue;
    const priorTable = prior[index]?.split(":");
    const nextTable = next[index]?.split(":");
    if (
      priorTable?.[0] !== "table" ||
      nextTable?.[0] !== "table" ||
      priorTable[1] !== nextTable[1] ||
      published.get(nextTable[1] as UUID) !== nextTable[2]
    )
      return false;
    changed = true;
  }
  return changed;
}

type ResultSchemaColumn = Readonly<{
  id: UUID;
  name: string;
  type: string;
}>;

/** Reconnect server result aliases to model fields and repeat-join labels. */
export function resolveInsightResultFields(
  schema: readonly ResultSchemaColumn[],
  insight: Insight | null | undefined,
  dataTables: readonly DataTable[],
  insights: readonly Insight[] = EMPTY_INSIGHTS,
): { fields: Field[]; displayNames: Record<string, string> } {
  if (!insight) {
    return {
      fields: [],
      displayNames: Object.fromEntries(
        schema.map((column) => [column.id, column.name]),
      ),
    };
  }
  const baseTable = resolveInsightSourceDataTable(
    insight,
    dataTables,
    insights,
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
        tableId: baseTable?.id ?? insight.source.sourceId,
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
  const activeMaterialization = useRef<{
    requestIdentity: string;
    sourceRevision: string;
  } | null>(null);
  const pendingMaterialization = useRef<{
    requestIdentity: string;
    sourceRevision: string;
  } | null>(null);
  const completedPublication = useRef<{
    sourceRevision: string;
    sourceGenerations: readonly { tableId: UUID; dataFrameId: UUID }[];
  } | null>(null);
  const [sourceRetry, setSourceRetry] = useState(0);
  const activeDataFrameId = useRef<UUID | null>(dataFrameId);
  useLayoutEffect(() => {
    activeDataFrameId.current = dataFrameId;
  }, [dataFrameId]);

  const runtimeKey = JSON.stringify(runtime ?? null);
  const insightKey = JSON.stringify(
    insight ? toFetchDefinition(insight) : null,
  );
  const sourceRevision = buildInsightSourceRevision(
    insight,
    dataTables,
    insights,
  );
  const requestIdentity = JSON.stringify([
    enabled,
    insight?.id ?? null,
    insightKey,
    runtimeKey,
    showModelPreview,
    sourcesReady,
  ]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runtimeKey is the stable structural dependency.
  const stableRuntime = useMemo(() => runtime, [runtimeKey]);

  useLayoutEffect(() => {
    generation.current += 1;
  }, [
    enabled,
    insight?.id,
    insightKey,
    runtimeKey,
    showModelPreview,
    sourceRetry,
    sourcesReady,
  ]);

  useEffect(() => {
    if (activeMaterialization.current?.requestIdentity === requestIdentity) {
      pendingMaterialization.current = { requestIdentity, sourceRevision };
      return;
    }
    const completed = completedPublication.current;
    completedPublication.current = null;
    if (
      completed &&
      isSelfPublishedSourceRevision(
        completed.sourceRevision,
        sourceRevision,
        completed.sourceGenerations,
      )
    )
      return;
    const current = generation.current;
    const activeInsight = insight;
    if (!enabled || !activeInsight?.id || !sourcesReady) {
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
    const activeRequest = { requestIdentity, sourceRevision };
    activeMaterialization.current = activeRequest;
    pendingMaterialization.current = null;
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
          insight: toFetchDefinition(activeInsight),
        })
      : getWyStackClient().mutate(api.runInsight, {
          insightId: activeInsight.id,
          ...(stableRuntime ? { runtime: stableRuntime } : {}),
        });
    let completedSourceGenerations:
      | readonly { tableId: UUID; dataFrameId: UUID }[]
      | undefined;
    materialized
      .then(
        async (fetchResult) => {
          if (current !== generation.current) return;
          completedSourceGenerations = fetchResult.sourceGenerations;
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
      )
      .finally(() => {
        if (activeMaterialization.current !== activeRequest) return;
        const started = activeRequest;
        const pending = pendingMaterialization.current;
        if (completedSourceGenerations?.length)
          completedPublication.current = {
            sourceRevision: started.sourceRevision,
            sourceGenerations: completedSourceGenerations,
          };
        activeMaterialization.current = null;
        pendingMaterialization.current = null;
        if (
          started &&
          pending &&
          (pending.requestIdentity !== started.requestIdentity ||
            (pending.sourceRevision !== started.sourceRevision &&
              (!completedSourceGenerations?.length ||
                !isSelfPublishedSourceRevision(
                  started.sourceRevision,
                  pending.sourceRevision,
                  completedSourceGenerations,
                ))))
        )
          setSourceRetry((value) => value + 1);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- structural keys intentionally gate rematerialization.
  }, [
    enabled,
    insight?.id,
    insightKey,
    runtimeKey,
    requestIdentity,
    showModelPreview,
    sourceRevision,
    sourceRetry,
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
    () => resolveInsightResultFields(schema, insight, dataTables, insights),
    [dataTables, insight, insights, schema],
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
