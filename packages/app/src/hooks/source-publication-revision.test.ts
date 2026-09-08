import type { UUID } from "@dashframe/types";
import { describe, expect, it } from "vite-plus/test";
import {
  isAutomaticSourcePublication,
  isSelfPublishedSourceRevision,
} from "./source-publication-revision";
const revision = (frame: string, fetchedAt: number, refresh = "initial") =>
  `table:table-1:${frame}:${fetchedAt}:${refresh}`;
const generation = (frame: string, lastFetchedAt: number) => ({
  tableId: "table-1" as UUID,
  dataFrameId: frame as UUID,
  lastFetchedAt,
});
describe("durable source publication revisions", () => {
  it("recognizes intermediate and concurrent publications without a renderer-local ledger", () => {
    expect(
      isAutomaticSourcePublication(revision("a", 1), revision("b", 2)),
    ).toBe(true);
    expect(
      isAutomaticSourcePublication(revision("b", 2), revision("c", 3)),
    ).toBe(true);
    expect(
      isAutomaticSourcePublication(revision("a", 1), revision("c", 3)),
    ).toBe(true);
  });
  it.each(["a", "b", "c"])(
    "preserves manual refresh to retained %s even with the same timestamp",
    (frame) => {
      expect(
        isAutomaticSourcePublication(
          revision("c", 3),
          revision(frame, 3, "manual"),
        ),
      ).toBe(false);
      expect(
        isAutomaticSourcePublication(
          revision("c", 3),
          revision("next-auto", 4, "manual"),
        ),
      ).toBe(false);
    },
  );
  it("does not suppress missing sources, changed definitions, or revisions without provenance", () => {
    for (const after of [
      "missing-table:table-1",
      revision("a", 1),
      "table:table-1:b:2",
      `${revision("b", 2)}|insight:changed`,
    ])
      expect(isAutomaticSourcePublication(revision("a", 1), after)).toBe(false);
  });
  it("requires exact own publication proof and keeps each generation of a repeated table", () => {
    const generations = [generation("b", 2), generation("c", 3)];
    for (const [frame, timestamp] of [
      ["b", 2],
      ["c", 3],
    ] as const)
      expect(
        isSelfPublishedSourceRevision(
          revision("a", 1),
          revision(frame, timestamp),
          generations,
        ),
      ).toBe(true);
    expect(
      isSelfPublishedSourceRevision(
        revision("a", 1),
        revision("b", 4),
        generations,
      ),
    ).toBe(false);
    expect(
      isSelfPublishedSourceRevision(
        revision("a", 1),
        revision("b", 2, "manual"),
        generations,
      ),
    ).toBe(false);
  });
});
