import { useQuery_experimental as useQuery } from "convex/react";
import { queryStatus } from "@/data/query-status";
import {
  queryDataFrame,
  type DataFrameEntry,
} from "@/lib/data-access/data-frames";
import { api } from "@dashframe/convex-backend/api";
import type { DataFrameColumn, DataFrameData, UUID } from "@dashframe/types";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface UseDataFrameDataResult {
  data: DataFrameData | null;
  isLoading: boolean;
  error: string | null;
  entry: DataFrameEntry | undefined;
  reload: () => void;
}

function columnsFromSchema(
  schema: readonly { name: string; type: string }[],
): DataFrameColumn[] {
  return schema.map(({ name, type }) => ({
    name,
    type: type as DataFrameColumn["type"],
  }));
}

/** Load a bounded page directly from the server-owned DataFrame handle. */
export function useDataFrameData(
  dataFrameId: UUID | undefined,
  options?: { limit?: number; skip?: boolean },
): UseDataFrameDataResult {
  const { data: allDataFrames } = queryStatus(
    useQuery({ query: api.app.listDataFrames, args: {} }),
  );
  const entry = useMemo(
    () => allDataFrames?.find((frame) => frame.id === dataFrameId),
    [allDataFrames, dataFrameId],
  );
  const limit = Math.min(options?.limit ?? 100, 500);
  const skip = options?.skip ?? false;
  const [data, setData] = useState<DataFrameData | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(dataFrameId) && !skip);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const current = ++generation.current;
    if (!dataFrameId || skip) {
      queueMicrotask(() => {
        if (current !== generation.current) return;
        setData(null);
        setError(null);
        setIsLoading(false);
      });
      return;
    }
    queueMicrotask(() => {
      if (current !== generation.current) return;
      setIsLoading(true);
      setError(null);
      setData(null);
    });
    queryDataFrame(dataFrameId, { offset: 0, limit }).then(
      (result) => {
        if (current !== generation.current) return;
        if (result.status === "failed") {
          setError(result.message);
          setData(null);
        } else {
          setData({
            rows: result.rows,
            columns: columnsFromSchema(result.schema),
          });
        }
        setIsLoading(false);
      },
      (cause: unknown) => {
        if (current !== generation.current) return;
        setError(
          cause instanceof Error ? cause.message : "Failed to load DataFrame",
        );
        setData(null);
        setIsLoading(false);
      },
    );
  }, [dataFrameId, limit, reloadKey, skip]);

  return {
    data,
    isLoading,
    error,
    entry,
    reload: useCallback(() => setReloadKey((key) => key + 1), []),
  };
}

export function useDataFrameDataByInsight(
  insightId: UUID | undefined,
  options?: { limit?: number; skip?: boolean },
): UseDataFrameDataResult {
  const { data: allDataFrames } = queryStatus(
    useQuery({ query: api.app.listDataFrames, args: {} }),
  );
  const entry = useMemo(
    () =>
      allDataFrames?.find(
        (frame) =>
          frame.insightId === insightId && frame.currentInsightResult === true,
      ) ??
      allDataFrames
        ?.filter((frame) => frame.insightId === insightId)
        .sort(
          (left, right) =>
            (right.lastRefreshedAt ?? right.createdAt) -
            (left.lastRefreshedAt ?? left.createdAt),
        )[0],
    [allDataFrames, insightId],
  );
  return useDataFrameData(entry?.id, options);
}
