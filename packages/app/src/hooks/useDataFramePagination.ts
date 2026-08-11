import { queryDataFrame } from "@/lib/data-access/data-frames";
import type { UUID } from "@dashframe/types";
import type { FetchDataParams, FetchDataResult } from "@dashframe/ui";
import { useCallback, useEffect, useRef, useState } from "react";

const MAX_PAGE_SIZE = 500;

/** Paginate a server-owned DataFrame without loading it into browser DuckDB. */
export function useDataFramePagination(dataFrameId: UUID | undefined) {
  const [totalCount, setTotalCount] = useState(0);
  const [columns, setColumns] = useState<{ name: string; type?: string }[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    if (!dataFrameId) {
      queueMicrotask(() => {
        if (current !== generation.current) return;
        setTotalCount(0);
        setColumns([]);
        setError(null);
        setIsReady(false);
      });
      return;
    }
    queueMicrotask(() => {
      if (current !== generation.current) return;
      setIsReady(false);
      setError(null);
    });
    queryDataFrame(dataFrameId, { offset: 0, limit: 1 }).then(
      (result) => {
        if (current !== generation.current) return;
        if (result.status === "failed") {
          setTotalCount(0);
          setColumns([]);
          setError(result.message);
          setIsReady(false);
          return;
        }
        setTotalCount(result.totalCount);
        setColumns(result.schema.map(({ name, type }) => ({ name, type })));
        setIsReady(true);
      },
      (cause: unknown) => {
        if (current !== generation.current) return;
        setTotalCount(0);
        setColumns([]);
        setError(
          cause instanceof Error ? cause.message : "Failed to initialize",
        );
        setIsReady(false);
      },
    );
  }, [dataFrameId]);

  const fetchData = useCallback(
    async (params: FetchDataParams): Promise<FetchDataResult> => {
      if (!dataFrameId) return { rows: [], totalCount: 0 };
      const result = await queryDataFrame(dataFrameId, {
        offset: params.offset,
        limit: Math.min(params.limit, MAX_PAGE_SIZE),
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
      return result.status === "ready"
        ? { rows: result.rows, totalCount: result.totalCount }
        : { rows: [], totalCount: 0 };
    },
    [dataFrameId],
  );

  return { fetchData, totalCount, columns, isReady, error };
}
