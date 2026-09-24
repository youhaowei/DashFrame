import { describe, expect, it } from "vite-plus/test";

import { sourceFreshness } from "./source-freshness";

describe("sourceFreshness", () => {
  const times = [3_000, 1_000, 2_000];

  it("dates a remote source by its stalest table", () => {
    expect(sourceFreshness(times, "remote-api")).toEqual({
      verb: "refreshed",
      at: 1_000,
    });
  });

  it("dates a file source by its latest import", () => {
    expect(sourceFreshness(times, "file")).toEqual({
      verb: "imported",
      at: 3_000,
    });
  });

  it("drops the verb while the connector kind is unknown", () => {
    expect(sourceFreshness(times, undefined)).toEqual({ at: 1_000 });
  });

  it("has no time before any table is fetched", () => {
    expect(sourceFreshness([], "remote-api")).toBeUndefined();
  });
});
