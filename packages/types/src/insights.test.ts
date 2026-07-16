import { describe, expect, it } from "vitest";

import { isUnmodifiedDraft } from "./insights";

describe("isUnmodifiedDraft", () => {
  it("treats a metric-only insight as configured", () => {
    expect(
      isUnmodifiedDraft({
        selectedFields: [],
        metrics: [
          {
            id: "metric",
            name: "Revenue",
            sourceTable: "table",
            columnName: "revenue",
            aggregation: "sum",
          },
        ],
      }),
    ).toBe(false);
  });

  it("keeps a truly empty insight eligible for draft cleanup", () => {
    expect(isUnmodifiedDraft({ selectedFields: [], metrics: [] })).toBe(true);
  });
});
