/** Exercise the same native metadata endpoint used by the renderer. */
export async function nativeCall<T>(
  kind: "query" | "mutation",
  path: string,
  args: unknown,
  token?: string,
): Promise<T> {
  const url = process.env.E2E_DASHFRAME_URL;
  if (!url) throw new Error("E2E_DASHFRAME_URL was not configured");
  const issued = await fetch(`${url}/api/convex-token`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!issued.ok)
    throw new Error(`Native identity issuance failed: ${issued.status}`);
  const identity = (await issued.json()) as { token: string };
  const response = await fetch(`${url}/api/convex/api/${kind}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${identity.token}`,
    },
    body: JSON.stringify({
      path: `app:${path}`,
      format: "convex_encoded_json",
      args: [args],
    }),
  });
  const result = (await response.json()) as {
    status: string;
    value?: T;
    errorMessage?: string;
  };
  if (!response.ok || result.status !== "success")
    throw new Error(
      result.errorMessage ?? `${path} failed: ${response.status}`,
    );
  return result.value as T;
}

export const query = <T>(path: string, args: unknown, token?: string) =>
  nativeCall<T>("query", path, args, token);
export const mutate = <T>(path: string, args: unknown, token?: string) =>
  nativeCall<T>("mutation", path, args, token);

/**
 * Every row of a paginated list query, following its cursor to the end the
 * way the app's readers do (`followPages` in `@dashframe/convex-backend`).
 */
interface ListPage<T> {
  page: T[];
  isDone: boolean;
  continueCursor: string;
  pageStatus?: "SplitRecommended" | "SplitRequired" | null;
  splitCursor?: string | null;
}

export async function queryAll<T>(
  path: string,
  args: Record<string, unknown>,
  token?: string,
): Promise<T[]> {
  const fetchPage = (paginationOpts: Record<string, unknown>) =>
    query<ListPage<T>>(path, { ...args, paginationOpts }, token);
  // A page the backend could not read whole comes back as `SplitRequired`
  // with a partial `page`; read it again as its two halves, as `followPages`
  // in `@dashframe/convex-backend` does, so assertions never miss rows.
  const wholeRange = async (
    cursor: string | null,
    page: ListPage<T>,
  ): Promise<T[]> => {
    const split = page.splitCursor;
    if (page.pageStatus !== "SplitRequired" || typeof split !== "string")
      return page.page;
    if (split === cursor) throw new Error("A list page could not be split");
    const halves: T[] = [];
    for (const [from, to] of [
      [cursor, split],
      [split, page.continueCursor],
    ] as const) {
      const half = await fetchPage({
        cursor: from,
        numItems: 500,
        endCursor: to,
      });
      halves.push(...(await wholeRange(from, half)));
    }
    return halves;
  };
  const rows: T[] = [];
  const seen = new Set<string | null>();
  let cursor: string | null = null;
  for (;;) {
    seen.add(cursor);
    const page = await fetchPage({ cursor, numItems: 500 });
    rows.push(...(await wholeRange(cursor, page)));
    if (page.isDone) return rows;
    if (seen.has(page.continueCursor))
      throw new Error("A list page led back to an earlier page");
    cursor = page.continueCursor;
  }
}
