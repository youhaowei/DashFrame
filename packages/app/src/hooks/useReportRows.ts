import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { FetchDataParams, FetchDataResult } from "@dashframe/ui";

type FetchRows = (params: FetchDataParams) => Promise<FetchDataResult>;
type Rows = Record<string, unknown>[];
interface Entry {
  snapshot: { rows?: Rows; error?: string };
  listeners: Set<() => void>;
  promise?: Promise<Rows>;
}
const pending = new WeakMap<FetchRows, Map<number, Entry>>();
const empty: Entry = { snapshot: {}, listeners: new Set() };
function entryFor(fetch: FetchRows, count: number): Entry {
  let counts = pending.get(fetch);
  if (!counts) {
    counts = new Map();
    pending.set(fetch, counts);
  }
  let entry = counts.get(count);
  if (!entry) {
    entry = { snapshot: {}, listeners: new Set() };
    counts.set(count, entry);
  }
  return entry;
}
function publish(entry: Entry, snapshot: Entry["snapshot"]) {
  entry.snapshot = snapshot;
  for (const listener of entry.listeners) listener();
}
async function readAll(
  fetchData: FetchRows,
  totalCount: number,
): Promise<Rows> {
  if (totalCount > 250000)
    throw new Error(
      "Set a report limit before opening this pivot; it exceeds 250,000 result rows.",
    );
  const rows: Rows = [];
  while (rows.length < totalCount) {
    const page = await fetchData({
      offset: rows.length,
      limit: Math.min(500, totalCount - rows.length),
    });
    if (page.totalCount !== totalCount || page.rows.length === 0)
      throw new Error(
        "The report changed or could not be fully loaded. Try again.",
      );
    rows.push(...page.rows);
  }
  return rows;
}
/** Share complete canonical rows and retry state between the table and its sort menu. */
export function loadReportRows(
  fetchData: FetchRows,
  totalCount: number,
): Promise<Rows> {
  const entry = entryFor(fetchData, totalCount);
  if (entry.promise) return entry.promise;
  publish(entry, {});
  const request = readAll(fetchData, totalCount);
  entry.promise = request;
  request.then(
    (rows) => publish(entry, { rows }),
    (cause: unknown) => {
      entry.promise = undefined;
      publish(entry, {
        error:
          cause instanceof Error ? cause.message : "Could not load the report.",
      });
    },
  );
  return request;
}
export function useReportRows(
  fetchData: FetchRows | undefined,
  totalCount: number,
) {
  const entry = fetchData ? entryFor(fetchData, totalCount) : empty;
  const subscribe = useCallback(
    (listener: () => void) => {
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
      };
    },
    [entry],
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    () => entry.snapshot,
    () => entry.snapshot,
  );
  const retry = useCallback(() => {
    if (fetchData) loadReportRows(fetchData, totalCount).catch(() => {});
  }, [fetchData, totalCount]);
  useEffect(() => {
    retry();
  }, [retry]);
  return fetchData
    ? { ...snapshot, fetch: fetchData, count: totalCount, retry }
    : undefined;
}
