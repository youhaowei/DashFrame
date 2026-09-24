import { describe, expect, it } from "vite-plus/test";

import { replacesEntry } from "./command-palette";

describe("replacesEntry", () => {
  it("replaces inside the artifact already open, and pushes otherwise", () => {
    const chart = { kind: "chart", reportId: "r1", chartId: "c1" } as const;
    expect(replacesEntry(chart, "/dashboards/r1")).toBe(true);
    expect(replacesEntry(chart, "/dashboards/r2")).toBe(false);
    expect(replacesEntry(chart, "/dashboards")).toBe(false);

    const table = {
      kind: "data-source",
      sourceId: "s1",
      tableId: "t1",
    } as const;
    expect(replacesEntry(table, "/data-sources/s1")).toBe(true);
    expect(replacesEntry(table, "/data-sources/s2")).toBe(false);
    expect(replacesEntry(table, "/data-sources")).toBe(false);

    const draft = { kind: "draft", draftId: "d2" } as const;
    expect(replacesEntry(draft, "/drafts/d1")).toBe(true);
    expect(replacesEntry(draft, "/drafts")).toBe(true);
    expect(replacesEntry(draft, "/dashboards/r1")).toBe(false);

    expect(
      replacesEntry({ kind: "action", action: "go-reports" }, "/dashboards"),
    ).toBe(false);
  });
});
