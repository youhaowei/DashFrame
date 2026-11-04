import type { PaginationOptions, PaginationResult } from "convex/server";

/**
 * The contract the list queries in `app.ts` share with every reader that
 * wants a whole list: the app, the host's assistant adapter, the browser
 * end-to-end helper, and the backend tests. One page per call, `PAGE_LIMIT`
 * rows at most, and the cursor followed until the backend reports the end.
 */

/**
 * The most rows one page returns; a larger request is clamped, not refused.
 * A draft's view of a list is served whole as its one page and is bounded by
 * the graph's own limit instead.
 */
export const PAGE_LIMIT = 500;

/** The pagination options a reader sends for one page. */
export type PageRequest = Pick<
  PaginationOptions,
  "cursor" | "numItems" | "endCursor"
>;

/**
 * Every row of a paginated list, following `continueCursor` to the end. A
 * page the backend could not read whole (`SplitRequired`) is read again as
 * the two halves it names, so no rows are skipped.
 */
export async function followPages<T>(
  fetchPage: (paginationOpts: PageRequest) => Promise<PaginationResult<T>>,
  numItems = PAGE_LIMIT,
): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string | null>();
  let cursor: string | null = null;
  for (;;) {
    seen.add(cursor);
    const page: PaginationResult<T> = await fetchPage({ cursor, numItems });
    rows.push(...(await wholeRange(fetchPage, numItems, cursor, page)));
    if (page.isDone) return rows;
    if (seen.has(page.continueCursor))
      throw new Error("A list page led back to an earlier page");
    cursor = page.continueCursor;
  }
}

/** The rows of one page, read as two halves when the backend asks. */
async function wholeRange<T>(
  fetchPage: (paginationOpts: PageRequest) => Promise<PaginationResult<T>>,
  numItems: number,
  cursor: string | null,
  page: PaginationResult<T>,
): Promise<T[]> {
  const split = page.splitCursor;
  if (page.pageStatus !== "SplitRequired" || typeof split !== "string")
    return page.page;
  if (split === cursor) throw new Error("A list page could not be split");
  const halves: T[] = [];
  for (const [from, to] of [
    [cursor, split],
    [split, page.continueCursor],
  ] as const) {
    const half = await fetchPage({ cursor: from, numItems, endCursor: to });
    halves.push(...(await wholeRange(fetchPage, numItems, from, half)));
  }
  return halves;
}
