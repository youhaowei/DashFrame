import { expect, it } from "vitest";
import type { PaginationResult } from "convex/server";
import { followPages, type PageRequest } from "../convex/pages";

type Row = { id: string };
const page = (
  rows: Row[],
  continueCursor: string,
  extra: Partial<PaginationResult<Row>> = {},
): PaginationResult<Row> => ({
  page: rows,
  isDone: continueCursor === "",
  continueCursor,
  ...extra,
});
const rangeOf = (opts: PageRequest) =>
  `${opts.cursor ?? ""}>${opts.endCursor ?? ""}`;
const reader = (pages: Record<string, PaginationResult<Row>>) => {
  const asked: string[] = [];
  const fetchPage = async (opts: PageRequest) => {
    asked.push(rangeOf(opts));
    const found = pages[rangeOf(opts)];
    if (!found) throw new Error(`No page at ${rangeOf(opts)}`);
    return found;
  };
  return { asked, fetchPage };
};

it("follows the cursor to the end and concatenates the pages", async () => {
  const { asked, fetchPage } = reader({
    ">": page([{ id: "a" }], "c1"),
    "c1>": page([{ id: "b" }], "c2"),
    "c2>": page([], ""),
  });
  expect(await followPages(fetchPage, 7)).toEqual([{ id: "a" }, { id: "b" }]);
  expect(asked).toEqual([">", "c1>", "c2>"]);
});

it("reads a page the backend could not read whole as its two halves", async () => {
  const { asked, fetchPage } = reader({
    ">": page([{ id: "a" }], "c1", {
      pageStatus: "SplitRequired",
      splitCursor: "s",
    }),
    ">s": page([{ id: "a" }], "s"),
    "s>c1": page([{ id: "b" }], "c1"),
    "c1>": page([{ id: "c" }], ""),
  });
  expect(await followPages(fetchPage)).toEqual([
    { id: "a" },
    { id: "b" },
    { id: "c" },
  ]);
  expect(asked).toEqual([">", ">s", "s>c1", "c1>"]);
});

it("refuses a page that leads back to an earlier page", async () => {
  const { fetchPage } = reader({
    ">": page([{ id: "a" }], "c1"),
    "c1>": page([{ id: "b" }], "c1"),
  });
  await expect(followPages(fetchPage)).rejects.toThrow("led back");
});
