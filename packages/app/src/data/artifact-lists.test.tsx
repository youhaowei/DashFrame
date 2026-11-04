import { renderHook } from "@testing-library/react";
import { api } from "@dashframe/convex-backend/api";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

type Row = { id: string };
type Page = {
  page: Row[];
  isDone: boolean;
  continueCursor: string;
  pageStatus?: "SplitRecommended" | "SplitRequired";
  splitCursor?: string;
};
type PageOpts = { cursor: string | null; endCursor?: string; numItems: number };
type Request = Record<string, { args: { paginationOpts: PageOpts } }>;

const rangeOf = (opts: PageOpts) =>
  `${opts.cursor ?? ""}>${opts.endCursor ?? ""}`;
/**
 * Pages by the range they are read from: `subscribed` answers the page
 * queries the hook asks for, `cached` stands for pages another reader holds
 * in the client. Like the real client, the fake hands back the same results
 * object until something changes, which `setPage` marks by bumping `version`.
 */
const fake = vi.hoisted(() => ({
  subscribed: new Map<string, Page | Error | undefined>(),
  cached: new Map<string, Page | Error>(),
  requests: [] as Request[],
  version: 0,
  cache: new WeakMap<Request, { version: number; results: object }>(),
}));

const client = vi.hoisted(() => ({
  watchQuery: (_query: unknown, args: { paginationOpts: PageOpts }) => ({
    localQueryResult: () => {
      const result = fake.cached.get(rangeOf(args.paginationOpts));
      if (result instanceof Error) throw result;
      return result;
    },
  }),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useConvex: () => client,
  useQueries: (requests: Request) => {
    fake.requests.push(requests);
    const hit = fake.cache.get(requests);
    if (hit?.version === fake.version) return hit.results;
    const results = Object.fromEntries(
      Object.entries(requests).map(([name, { args }]) => [
        name,
        fake.subscribed.get(rangeOf(args.paginationOpts)),
      ]),
    );
    fake.cache.set(requests, { version: fake.version, results });
    return results;
  },
}));

import {
  ARTIFACT_PAGE_SIZE,
  listAllArtifacts,
  useArtifactList,
} from "./artifact-lists";

const page = (rows: Row[], continueCursor = ""): Page => ({
  page: rows,
  isDone: continueCursor === "",
  continueCursor,
});
const at = (cursor: string | null, endCursor?: string) =>
  rangeOf({ cursor, endCursor, numItems: ARTIFACT_PAGE_SIZE });
const setPage = (range: string, result: Page | Error | undefined) => {
  fake.subscribed.set(range, result);
  fake.version++;
};
const rangesRequested = (request: Request) =>
  Object.values(request).map(({ args }) => rangeOf(args.paginationOpts));

describe("useArtifactList", () => {
  beforeEach(() => {
    fake.subscribed = new Map();
    fake.cached = new Map();
    fake.requests = [];
    fake.version++;
  });

  it("follows the cursor through every page and stays pending until the last is in", () => {
    setPage(at(null), page([{ id: "a" }], "c1"));
    const { result, rerender } = renderHook(() =>
      useArtifactList({ query: api.app.listDataSources, args: {} }),
    );
    // The first page named a second one, which is now being read.
    expect(result.current).toEqual({ status: "pending" });
    expect(rangesRequested(fake.requests.at(-1)!)).toEqual([
      at(null),
      at("c1"),
    ]);
    expect(fake.requests[0]![at(null)]!.args.paginationOpts.numItems).toBe(
      ARTIFACT_PAGE_SIZE,
    );

    setPage(at("c1"), page([{ id: "b" }], "c2"));
    rerender();
    expect(result.current).toEqual({ status: "pending" });
    expect(rangesRequested(fake.requests.at(-1)!)).toEqual([
      at(null),
      at("c1"),
      at("c2"),
    ]);

    setPage(at("c2"), page([{ id: "c" }]));
    rerender();
    expect(result.current).toEqual({
      status: "success",
      data: [{ id: "a" }, { id: "b" }, { id: "c" }],
    });
  });

  it("finds a chain another reader already holds in one render", () => {
    const rows: Row[] = [];
    for (let index = 0; index < 40; index++) {
      const row = { id: `row-${index}` };
      rows.push(row);
      const cursor = index === 0 ? null : `c${index}`;
      const next = index === 39 ? "" : `c${index + 1}`;
      fake.cached.set(at(cursor), page([row], next));
      setPage(at(cursor), page([row], next));
    }
    const { result } = renderHook(() =>
      useArtifactList({ query: api.app.listDataFrames, args: {} }),
    );
    expect(result.current).toEqual({ status: "success", data: rows });
    // One request for the whole chain, not one render per page.
    expect(fake.requests.length).toBeLessThan(6);
    expect(rangesRequested(fake.requests.at(-1)!)).toHaveLength(40);
  });

  it("bounds a page the server could not read whole and reads the rest on", () => {
    setPage(at(null), {
      page: [{ id: "a" }, { id: "b" }],
      isDone: false,
      continueCursor: "c1",
      pageStatus: "SplitRequired",
      splitCursor: "s",
    });
    const { result, rerender } = renderHook(() =>
      useArtifactList({ query: api.app.listInsights, args: {} }),
    );
    expect(result.current).toEqual({ status: "pending" });
    expect(rangesRequested(fake.requests.at(-1)!)).toEqual([
      at(null, "s"),
      at("s", "c1"),
    ]);

    setPage(at(null, "s"), page([{ id: "a" }], "s"));
    setPage(at("s", "c1"), page([{ id: "b" }], "c1"));
    setPage(at("c1"), page([{ id: "c" }]));
    rerender();
    expect(result.current).toEqual({
      status: "success",
      data: [{ id: "a" }, { id: "b" }, { id: "c" }],
    });
    // Both halves are bounded, so the page after the split is read once.
    expect(rangesRequested(fake.requests.at(-1)!)).toEqual([
      at(null, "s"),
      at("s", "c1"),
      at("c1"),
    ]);
  });

  it("keeps the rows in hand while the pages after a moved page end reload", () => {
    setPage(at(null), page([{ id: "a" }], "c1"));
    setPage(at("c1"), page([{ id: "b" }]));
    const { result, rerender } = renderHook(() =>
      useArtifactList({ query: api.app.listDataSources, args: {} }),
    );
    const before = [{ id: "a" }, { id: "b" }];
    expect(result.current).toEqual({ status: "success", data: before });

    // The first page now ends elsewhere; the list reads from the new cursor
    // while keeping what it has, and holds the old page in case it is reused.
    setPage(at(null), page([{ id: "a" }, { id: "a2" }], "c1b"));
    rerender();
    expect(result.current).toEqual({ status: "success", data: before });
    expect(rangesRequested(fake.requests.at(-1)!)).toEqual([
      at(null),
      at("c1b"),
      at("c1"),
    ]);
    // Every render while the page is still missing keeps the rows in hand.
    rerender();
    rerender();
    expect(result.current).toEqual({ status: "success", data: before });

    setPage(at("c1b"), page([{ id: "b" }]));
    rerender();
    expect(result.current).toEqual({
      status: "success",
      data: [{ id: "a" }, { id: "a2" }, { id: "b" }],
    });
  });

  it("remembers the rows it last saw complete, not the first ones", () => {
    setPage(at(null), page([{ id: "a" }, { id: "b" }], "c1"));
    setPage(at("c1"), page([{ id: "c" }]));
    const { result, rerender } = renderHook(() =>
      useArtifactList({ query: api.app.listDataSources, args: {} }),
    );
    expect(result.current.status).toBe("success");
    // A row is deleted while the list stays complete.
    setPage(at(null), page([{ id: "b" }], "c1"));
    rerender();
    expect(result.current).toEqual({
      status: "success",
      data: [{ id: "b" }, { id: "c" }],
    });
    // Now the first page ends elsewhere: the rows shown are the latest ones.
    setPage(at(null), page([{ id: "b" }], "c1b"));
    rerender();
    expect(result.current).toEqual({
      status: "success",
      data: [{ id: "b" }, { id: "c" }],
    });
  });

  it("keeps an empty list complete while it is read again", () => {
    setPage(at(null), page([]));
    const { result, rerender } = renderHook(() =>
      useArtifactList({ query: api.app.listDataSources, args: {} }),
    );
    expect(result.current).toEqual({ status: "success", data: [] });
    setPage(at(null), undefined);
    rerender();
    expect(result.current).toEqual({ status: "success", data: [] });
  });

  it("reuses the pages after a reloaded one when it ends where it did before", () => {
    setPage(at(null), page([{ id: "a" }], "c1"));
    setPage(at("c1"), page([{ id: "b" }], "c2"));
    setPage(at("c2"), page([{ id: "c" }]));
    const { result, rerender } = renderHook(() =>
      useArtifactList({ query: api.app.listDataSources, args: {} }),
    );
    expect(result.current.status).toBe("success");

    setPage(at(null), page([{ id: "a" }, { id: "a2" }], "c1b"));
    rerender();
    // The pages already held stay subscribed while the new second page loads.
    expect(rangesRequested(fake.requests.at(-1)!)).toEqual([
      at(null),
      at("c1b"),
      at("c1"),
      at("c2"),
    ]);
    setPage(at("c1b"), page([{ id: "b" }], "c2"));
    rerender();
    expect(result.current).toEqual({
      status: "success",
      data: [{ id: "a" }, { id: "a2" }, { id: "b" }, { id: "c" }],
    });
    expect(rangesRequested(fake.requests.at(-1)!)).toEqual([
      at(null),
      at("c1b"),
      at("c2"),
    ]);
  });

  it("keeps the same success state across renders that change nothing", () => {
    setPage(at(null), page([{ id: "a" }]));
    const { result, rerender } = renderHook(() =>
      useArtifactList({ query: api.app.listDataSources, args: {} }),
    );
    const before = result.current;
    rerender();
    expect(result.current).toBe(before);
    // The one request shape is handed to Convex once per subscription change.
    expect(new Set(fake.requests).size).toBe(1);
  });

  it("builds the same page queries for every reader of a list", () => {
    setPage(at(null), page([{ id: "a" }], "c1"));
    setPage(at("c1"), page([{ id: "b" }]));
    renderHook(() =>
      useArtifactList({ query: api.app.listDataTables, args: {} }),
    );
    const first = fake.requests.at(-1)!;
    renderHook(() =>
      useArtifactList({ query: api.app.listDataTables, args: {} }),
    );
    expect(fake.requests.at(-1)).toEqual(first);
    renderHook(() =>
      useArtifactList({
        query: api.app.listDataTables,
        args: { dataSourceId: "source" },
      }),
    );
    expect(fake.requests.at(-1)).not.toEqual(first);
  });

  it("starts from the first page again when a reader mounts afresh", () => {
    setPage(at(null), page([{ id: "a" }]));
    const first = renderHook(() =>
      useArtifactList({ query: api.app.listDataTables, args: {} }),
    );
    expect(first.result.current.status).toBe("success");
    first.unmount();
    setPage(at(null), undefined);
    const second = renderHook(() =>
      useArtifactList({ query: api.app.listDataTables, args: {} }),
    );
    expect(second.result.current).toEqual({ status: "pending" });
  });

  it("reports a failed page as an error state", () => {
    const error = new Error("Couldn't check access");
    setPage(at(null), page([{ id: "a" }], "c1"));
    setPage(at("c1"), error);
    const { result } = renderHook(() =>
      useArtifactList({ query: api.app.listDataSources, args: {} }),
    );
    expect(result.current).toEqual({ status: "error", error });
  });

  it("refuses a page that does not advance instead of looping", () => {
    setPage(at(null), page([{ id: "a" }], "c1"));
    setPage(at("c1"), page([{ id: "b" }], "c1"));
    const { result } = renderHook(() =>
      useArtifactList({ query: api.app.listDataSources, args: {} }),
    );
    expect(result.current.status).toBe("error");
  });

  it("refuses a page that leads back to an earlier page instead of looping", () => {
    setPage(at(null), page([{ id: "a" }], "c1"));
    setPage(at("c1"), page([{ id: "b" }], "c2"));
    setPage(at("c2"), page([{ id: "c" }], "c1"));
    const { result } = renderHook(() =>
      useArtifactList({ query: api.app.listDataSources, args: {} }),
    );
    expect(result.current.status).toBe("error");
  });

  it("uses a page the server only recommends splitting as it is", () => {
    setPage(at(null), {
      page: [{ id: "a" }, { id: "b" }],
      isDone: true,
      continueCursor: "",
      pageStatus: "SplitRecommended",
      splitCursor: "s",
    });
    const { result } = renderHook(() =>
      useArtifactList({ query: api.app.listInsights, args: {} }),
    );
    expect(result.current).toEqual({
      status: "success",
      data: [{ id: "a" }, { id: "b" }],
    });
  });

  it("passes a skipped list through as pending", () => {
    setPage(at(null), page([{ id: "a" }]));
    const { result } = renderHook(() =>
      useArtifactList({ query: api.app.listDataTables, args: "skip" }),
    );
    expect(result.current).toEqual({ status: "pending" });
    expect(fake.requests.at(-1)).toEqual({});
  });
});

describe("listAllArtifacts", () => {
  it("follows the cursor to the end and concatenates the pages", async () => {
    const pages: Record<string, { page: Row[]; isDone: boolean }> = {
      start: { page: [{ id: "a" }, { id: "b" }], isDone: false },
      second: { page: [{ id: "c" }], isDone: false },
      third: { page: [], isDone: true },
    };
    const next: Record<string, string> = { start: "second", second: "third" };
    const query = vi.fn(
      async (
        _ref: unknown,
        args: { draftId?: string; paginationOpts: { cursor: string | null } },
      ) => {
        const key = args.paginationOpts.cursor ?? "start";
        return { ...pages[key]!, continueCursor: next[key] ?? "" };
      },
    );
    const client = { query } as unknown as Parameters<
      typeof listAllArtifacts
    >[0];

    const rows = await listAllArtifacts(client, api.app.listInsights, {
      draftId: "draft-1",
    });

    expect(rows).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(query.mock.calls.map(([, args]) => args)).toEqual([
      {
        draftId: "draft-1",
        paginationOpts: { cursor: null, numItems: ARTIFACT_PAGE_SIZE },
      },
      {
        draftId: "draft-1",
        paginationOpts: { cursor: "second", numItems: ARTIFACT_PAGE_SIZE },
      },
      {
        draftId: "draft-1",
        paginationOpts: { cursor: "third", numItems: ARTIFACT_PAGE_SIZE },
      },
    ]);
  });
});
