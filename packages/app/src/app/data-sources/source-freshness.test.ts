import { describe, expect, it } from "vite-plus/test";

import { sourceFreshness } from "./source-freshness";

describe("sourceFreshness", () => {
  const times = [3_000, 1_000, 2_000];

  it("dates a remote source by its stalest table", () => {
    expect(sourceFreshness(times, "remote-api")).toEqual({
      kind: "fetched",
      verb: "refreshed",
      at: 1_000,
    });
  });

  it("dates a file source by its latest import", () => {
    expect(sourceFreshness(times, "file")).toEqual({
      kind: "fetched",
      verb: "imported",
      at: 3_000,
    });
  });

  it("drops the verb while the connector kind is unknown", () => {
    expect(sourceFreshness(times, undefined)).toEqual({
      kind: "fetched",
      at: 1_000,
    });
  });

  it("claims no time when some tables were never fetched", () => {
    expect(sourceFreshness([2_000, undefined], "remote-api")).toEqual({
      kind: "partial",
      fetched: 1,
      total: 2,
    });
  });

  it("has nothing to say before any table is fetched", () => {
    expect(sourceFreshness([undefined], "remote-api")).toBeUndefined();
    expect(sourceFreshness([], "remote-api")).toBeUndefined();
  });
});
