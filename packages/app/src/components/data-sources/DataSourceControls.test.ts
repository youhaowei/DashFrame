import { describe, expect, it } from "vitest";

import { selectDatabaseCache } from "./DataSourceControls";

describe("selectDatabaseCache", () => {
  it("ignores a late response owned by the previously selected source", () => {
    const sourceBCache = { databases: [{ id: "b", title: "B" }], timestamp: 2 };
    const lateSourceA = {
      dataSourceId: "source-a",
      cache: { databases: [{ id: "a", title: "A" }], timestamp: 3 },
    };

    expect(selectDatabaseCache("source-b", lateSourceA, sourceBCache)).toBe(
      sourceBCache,
    );
  });
});
