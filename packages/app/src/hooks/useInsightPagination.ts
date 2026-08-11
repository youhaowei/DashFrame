import { queryDataFrame } from "@/lib/data-access/data-frames";
import { api } from "@/wystack/api";
import { getWyStackClient } from "@/wystack/client";
import {
  extractColumnAliasComponents,
  type EffectiveParams,
} from "@dashframe/engine";
import type {
  ColumnType,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const MAX_PAGE_SIZE = 500;
const SUGGESTION_SAMPLE_SIZE = 100;

export interface UseInsightPaginationOptions {
  insight: Insight;
  /** Unsaved previews are materialized ephemerally; saved insights use runInsight. */
  showModelPreview?: boolean;
  enabled?: boolean;
  runtime?: InsightRuntimeInput;
  /** Retained until dashboard callers are moved to explicit runtime controls. */
  effectiveParams?: EffectiveParams;
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
 * Materialize an Insight on the server, then page its immutable DataFrame handle.
 * Browser DuckDB is deliberately not part of this path.
 */
export function useInsightPagination({
  insight,
  showModelPreview = false,
  enabled = true,
  runtime,
}: UseInsightPaginationOptions) {
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
  const generation = useRef(0);

  const runtimeKey = JSON.stringify(runtime ?? null);
  const insightKey = JSON.stringify(toFetchDefinition(insight));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runtimeKey is the stable structural dependency.
  const stableRuntime = useMemo(() => runtime, [runtimeKey]);

  useEffect(() => {
    const current = ++generation.current;
    if (!enabled || !insight.id) {
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
        if (fetchResult.status === "failed") {
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
        const page = await queryDataFrame(fetchResult.dataFrameId, {
          offset: 0,
          limit: SUGGESTION_SAMPLE_SIZE,
        });
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
        setDataFrameId(fetchResult.dataFrameId);
        setTotalCount(effectiveCount);
        setColumns(nextColumns);
        setSchema(page.schema);
        setSampleRows(page.rows);
        setFieldCount(nextColumns.length);
        setError(null);
        setIsReady(true);
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
    // stableRuntime is represented by runtimeKey above.
  ]);

  const fetchData = useCallback(
    async (params: FetchDataParams): Promise<FetchDataResult> => {
      if (!dataFrameId) return { rows: [], totalCount: 0 };
      const remaining = stableRuntime?.limit
        ? Math.max(0, stableRuntime.limit - params.offset)
        : params.limit;
      if (remaining === 0) return { rows: [], totalCount };
      const page = await queryDataFrame(dataFrameId, {
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
      return page.status === "ready"
        ? { rows: page.rows, totalCount }
        : { rows: [], totalCount: 0 };
    },
    [dataFrameId, stableRuntime, totalCount],
  );

  const columnDisplayNames = useMemo(
    () => Object.fromEntries(schema.map((column) => [column.id, column.name])),
    [schema],
  );
  const resolvedFields = useMemo(
    () =>
      schema.flatMap((column): Field[] => {
        if (!column.id.startsWith("field_")) return [];
        const parsed = extractColumnAliasComponents(column.id);
        if (!parsed) return [];
        const id = `${parsed.uuid}${
          parsed.instanceIndex > 0 ? `_j${parsed.instanceIndex}` : ""
        }` as UUID;
        return [
          {
            id,
            tableId: insight.baseTableId,
            name: column.name,
            columnName: column.id,
            type: column.type as ColumnType,
          },
        ];
      }),
    [insight.baseTableId, schema],
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
    columnDisplayNames,
    columnTypeMap: Object.fromEntries(
      schema.map((column) => [column.id, column.type as ColumnType]),
    ),
    resolvedFields,
  };
}
