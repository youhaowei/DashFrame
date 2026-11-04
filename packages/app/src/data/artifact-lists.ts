import {
  useConvex,
  useQueries,
  type ConvexReactClient,
  type PaginatedQueryArgs,
  type PaginatedQueryItem,
  type PaginatedQueryReference,
  type RequestForQueries,
} from "convex/react";
import {
  getFunctionName,
  type FunctionReference,
  type OptionalRestArgs,
  type PaginationResult,
} from "convex/server";
import { convexToJson, type Value } from "convex/values";
import { followPages, PAGE_LIMIT } from "@dashframe/convex-backend/pages";
import { useEffect, useId, useMemo, useState } from "react";

/**
 * Whole-list reads over the paginated artifact lists.
 *
 * `api.app.listDataSources` and the other list queries return one page per
 * call so a workspace of any size can be read. Every reader in the app wants
 * the whole list: pickers, the command palette, join configuration, and the
 * lookups that resolve an artifact by id. These helpers follow the cursor to
 * the end and present the result as a single native query state, the shape
 * `queryStatus` already understands.
 *
 * The hook subscribes to each page as a plain query rather than through
 * Convex's paginated hooks: the stable one throws a failed page at an error
 * boundary instead of reporting it, and the experimental client swallows a
 * failed page's transition and re-reads from the start when it splits a
 * later page. Plain page queries report errors as values and are shared by
 * every reader that builds the same arguments.
 */

/** Rows asked for per page: the most the backend serves in one. */
export const ARTIFACT_PAGE_SIZE = PAGE_LIMIT;

export type ArtifactListState<Item> =
  | { status: "pending" }
  | { status: "success"; data: Item[] }
  | { status: "error"; error: Error };

type PageResult<Item> = PaginationResult<Item> | Error | undefined;
type PageQuery = FunctionReference<
  "query",
  "public",
  Record<string, Value>,
  unknown
>;
/** One page's range: from `cursor`, bounded by `endCursor` once split. */
type PageSpec = { cursor: string | null; endCursor?: string };
type Chain = { key: string | null; pages: readonly PageSpec[] };
type ListRequest = {
  signature: string;
  query: PaginatedQueryReference;
  args: Record<string, Value>;
  queries: RequestForQueries;
};
type Walk<Item> = {
  wanted: PageSpec[];
  rows: Item[];
  error?: Error;
  loading: boolean;
  done: boolean;
};

/**
 * The rows each reader last saw complete, by reader. Written after each
 * complete render and read back while a page is read again, so a complete
 * list never goes back to pending; a reader that mounts afresh starts from
 * nothing.
 */
const snapshots = new Map<string, { key: string; rows: unknown[] }>();
const FIRST_PAGE: PageSpec = { cursor: null };
const START: readonly PageSpec[] = [FIRST_PAGE];
const IDLE: Walk<never> = { wanted: [], rows: [], loading: false, done: false };

function listKey(query: PaginatedQueryReference, args: unknown): string {
  return `${getFunctionName(query)}|${JSON.stringify(convexToJson(args as Value))}`;
}
/**
 * The name of a page's query in the request, by its range rather than its
 * place in the chain, so a page inserted before it leaves its subscription,
 * and the journal pinning its range, untouched.
 */
function pageName(spec: PageSpec): string {
  return `${spec.cursor ?? ""}>${spec.endCursor ?? ""}`;
}
function pageArgs(
  args: Record<string, Value>,
  spec: PageSpec,
): Record<string, Value> {
  return {
    ...args,
    paginationOpts: {
      cursor: spec.cursor,
      numItems: ARTIFACT_PAGE_SIZE,
      ...(spec.endCursor === undefined ? {} : { endCursor: spec.endCursor }),
    },
  };
}
function sameSpec(a: PageSpec, b: PageSpec): boolean {
  return a.cursor === b.cursor && a.endCursor === b.endCursor;
}
function signatureOf(key: string | null, pages: readonly PageSpec[]): string {
  return key === null ? "" : [key, ...pages.map(pageName)].join("\n");
} /**
 * The page queries of a list, one per page in the chain. Every reader of a
 * list builds the same queries, so Convex serves them all from one
 * subscription per page.
 */
function listRequest(
  query: PaginatedQueryReference,
  args: unknown,
  pages: readonly PageSpec[],
  signature: string,
): ListRequest {
  const base = args as Record<string, Value>;
  const queries: RequestForQueries = {};
  if (signature !== "")
    for (const spec of pages)
      queries[pageName(spec)] = { query, args: pageArgs(base, spec) };
  return { signature, query, args: base, queries };
}
/**
 * A page the server could not read whole is split at the point it names; a
 * page it merely recommends splitting is complete and used as it is.
 */
function needsSplit<Item>(result: PaginationResult<Item>, spec: PageSpec) {
  return (
    result.pageStatus === "SplitRequired" &&
    typeof result.splitCursor === "string" &&
    result.splitCursor !== spec.cursor &&
    result.splitCursor !== spec.endCursor
  );
}

/**
 * Walk the pages of a list in order, from the first, each later page starting
 * where the loaded page before it ends; a page the chain already holds for
 * that cursor is kept, bounds included. A page the server asks to split is
 * bounded at the split point and the rest read on as the next page, so no
 * page grows without limit. Rows are collected up to the first page that is
 * still loading, failed, or last.
 */
function walkPages<Item>(
  pages: readonly PageSpec[],
  read: (spec: PageSpec) => PageResult<Item>,
): Walk<Item> {
  const wanted: PageSpec[] = [];
  const rows: Item[] = [];
  const seen = new Set<string>();
  let spec: PageSpec = pages[0]?.cursor === null ? pages[0] : FIRST_PAGE;
  for (;;) {
    if (seen.has(pageName(spec)))
      return {
        wanted,
        rows,
        error: new Error("A list page led back to an earlier page"),
        loading: false,
        done: false,
      };
    seen.add(pageName(spec));
    const result = read(spec);
    if (result === undefined) {
      wanted.push(spec);
      return { wanted, rows, loading: true, done: false };
    }
    if (result instanceof Error) {
      wanted.push(spec);
      return { wanted, rows, error: result, loading: false, done: false };
    }
    if (needsSplit(result, spec)) {
      // Both halves are bounded and enter the chain together, so the page
      // after the split is kept as it is and the halves load next.
      wanted.push(
        { cursor: spec.cursor, endCursor: result.splitCursor! },
        { cursor: result.splitCursor!, endCursor: result.continueCursor },
      );
      return { wanted, rows, loading: true, done: false };
    }
    wanted.push(spec);
    rows.push(...result.page);
    if (result.isDone) return { wanted, rows, loading: false, done: true };
    const next = result.continueCursor;
    spec = pages.find((page) => page.cursor === next) ?? { cursor: next };
  }
}
/**
 * The chain to hold after a walk: the pages the walk wants, plus, while a
 * page is still loading, the other pages the chain already holds. Those stay
 * subscribed, so when the loading page ends where a held page starts, that
 * page is reused as it is instead of read again.
 */
function nextChain(
  pages: readonly PageSpec[],
  wanted: readonly PageSpec[],
  done: boolean,
): readonly PageSpec[] {
  if (done) return wanted;
  // A page that starts where a wanted page starts is the one it replaces.
  const held = pages.filter(
    (page) => !wanted.some((spec) => spec.cursor === page.cursor),
  );
  return [...wanted, ...held];
}
function sameChain(a: readonly PageSpec[], b: readonly PageSpec[]): boolean {
  return (
    a.length === b.length && a.every((spec, index) => sameSpec(spec, b[index]!))
  );
}

/**
 * Subscribe to every row of a paginated artifact list. The state stays
 * pending until the last page is in, because callers resolve artifacts by id
 * from the list and a partial list would read as a missing artifact; once a
 * reader has seen the list complete, the rows it last saw stay in hand while
 * a page is read again.
 * The pages stay subscribed, so later changes arrive reactively as they do
 * from one query: Convex keeps each page's range pinned and the final page
 * open-ended, so rows added past the end join it. Should a page's end move,
 * the pages after it are read again from the cursor it now reports.
 */
export function useArtifactList<
  Query extends PaginatedQueryReference,
>(options: {
  query: Query;
  args: PaginatedQueryArgs<Query> | "skip";
}): ArtifactListState<PaginatedQueryItem<Query>> {
  type Item = PaginatedQueryItem<Query>;
  const { query, args } = options;
  const convex = useConvex();
  const key = args === "skip" ? null : listKey(query, args);
  // The chain of pages, each after the first starting where the page before
  // it reported its end; back to the first page alone whenever the list changes.
  const [chain, setChain] = useState<Chain>({ key, pages: START });
  const pages = useMemo(
    () => (chain.key === key ? chain.pages : START),
    [chain, key],
  );
  const signature = signatureOf(key, pages);
  // Rebuilt only when the list or its chain changes, so an args literal
  // written inline does not resubscribe on every render.
  const [current, setCurrent] = useState(() =>
    listRequest(query, args, pages, signature),
  );
  let active = current;
  if (active.signature !== signature) {
    active = listRequest(query, args, pages, signature);
    setCurrent(active);
  }
  const settled = active === current;
  const results = useQueries(active.queries) as Record<
    string,
    PageResult<Item>
  >;

  const walk = useMemo<Walk<Item>>(() => {
    if (key === null) return IDLE;
    const read = (spec: PageSpec): PageResult<Item> => {
      if (pages.some((page) => sameSpec(page, spec)))
        return results[pageName(spec)];
      // A page not asked for yet may already sit in the client's cache, held
      // by another reader of the list; reading it here lets a mounting
      // reader find the whole chain in one render instead of one page each.
      if (!settled || typeof convex?.watchQuery !== "function")
        return undefined;
      try {
        return convex
          .watchQuery(
            current.query as unknown as PageQuery,
            pageArgs(current.args, spec),
          )
          .localQueryResult() as PaginationResult<Item> | undefined;
      } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
      }
    };
    return walkPages(pages, read);
  }, [key, pages, results, settled, convex, current]);
  const { wanted, rows, error, loading, done } = walk;
  if (key !== null) {
    const next = nextChain(pages, wanted, done);
    if (!sameChain(pages, next)) setChain({ key, pages: next });
  }
  const complete = key !== null && done && !loading && error === undefined;

  const reader = useId();
  useEffect(() => {
    if (complete) snapshots.set(reader, { key, rows });
  }, [reader, complete, key, rows]);
  // Only unmounting forgets the snapshot; a list going incomplete keeps it.
  useEffect(
    () => () => {
      snapshots.delete(reader);
    },
    [reader],
  );
  const snapshot = complete ? undefined : snapshots.get(reader);
  const remembered =
    snapshot !== undefined && snapshot.key === key
      ? (snapshot.rows as Item[])
      : undefined;

  return useMemo<ArtifactListState<Item>>(() => {
    if (error) return { status: "error", error };
    if (complete) return { status: "success", data: rows };
    if (remembered !== undefined)
      return { status: "success", data: remembered };
    return { status: "pending" };
  }, [error, complete, rows, remembered]);
}

/** Read every row of a list once, outside React, following the cursor to the end. */
export function listAllArtifacts<Query extends PaginatedQueryReference>(
  client: Pick<ConvexReactClient, "query">,
  query: Query,
  args: PaginatedQueryArgs<Query>,
): Promise<PaginatedQueryItem<Query>[]> {
  return followPages<PaginatedQueryItem<Query>>((paginationOpts) =>
    client.query(
      query,
      ...([{ ...args, paginationOpts }] as unknown as OptionalRestArgs<Query>),
    ),
  );
}
