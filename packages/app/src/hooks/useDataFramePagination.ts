import { queryDataFrame } from "@/lib/data-access/data-frames";
import type { UUID } from "@dashframe/types";
import type { FetchDataParams, FetchDataResult } from "@dashframe/ui";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const MAX_PAGE_SIZE = 500;

/** Paginate a server-owned DataFrame without loading it into browser DuckDB. */
export function useDataFramePagination(dataFrameId: UUID | undefined) {
  const [totalCount, setTotalCount] = useState(0);
  const [columns, setColumns] = useState<{ name: string; type?: string }[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldIdsByName = useRef(new Map<string, UUID>());
  const generation = useRef(0);
  const activeDataFrameId = useRef<UUID | undefined>(dataFrameId);

  useLayoutEffect(() => {
    activeDataFrameId.current = dataFrameId;
    generation.current += 1;
  }, [dataFrameId]);

  useEffect(() => {
    const current = generation.current;
    if (!dataFrameId) {
      queueMicrotask(() => {
        if (current !== generation.current) return;
        setTotalCount(0);
        setColumns([]);
        fieldIdsByName.current = new Map();
        setError(null);
        setIsReady(false);
      });
      return;
    }
    queueMicrotask(() => {
      if (current !== generation.current) return;
      fieldIdsByName.current = new Map();
      setIsReady(false);
      setError(null);
    });
    queryDataFrame(dataFrameId, { offset: 0, limit: 1 }).then(
      (result) => {
        if (current !== generation.current) return;
        if (result.status === "failed") {
          setTotalCount(0);
          setColumns([]);
          fieldIdsByName.current = new Map();
          setError(result.message);
          setIsReady(false);
          return;
        }
        setTotalCount(result.totalCount);
        fieldIdsByName.current = new Map(
          result.schema.map(({ id, name }) => [name, id]),
        );
        setColumns(result.schema.map(({ name, type }) => ({ name, type })));
        setIsReady(true);
      },
      (cause: unknown) => {
        if (current !== generation.current) return;
        setTotalCount(0);
        setColumns([]);
        fieldIdsByName.current = new Map();
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
      const current = generation.current;
      const requestedDataFrameId = dataFrameId;
      const result = await queryDataFrame(dataFrameId, {
        offset: params.offset,
        limit: Math.min(params.limit, MAX_PAGE_SIZE),
        sort:
          params.sortColumn &&
          params.sortDirection &&
          fieldIdsByName.current.has(params.sortColumn)
            ? [
                {
                  fieldId: fieldIdsByName.current.get(params.sortColumn)!,
                  direction: params.sortDirection,
                },
              ]
            : undefined,
      });
      if (
        current !== generation.current ||
        activeDataFrameId.current !== requestedDataFrameId
      )
        return { rows: [], totalCount: 0 };
      return result.status === "ready"
        ? { rows: result.rows, totalCount: result.totalCount }
        : { rows: [], totalCount: 0 };
    },
    [dataFrameId],
  );

  return { fetchData, totalCount, columns, isReady, error };
}
