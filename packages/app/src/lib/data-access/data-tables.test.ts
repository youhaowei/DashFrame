import type { UUID } from "@dashframe/types";
import { describe, expect, it } from "vite-plus/test";

import { makeDefaultCountMetric } from "./data-tables";

describe("makeDefaultCountMetric", () => {
  it("builds the explicit row-count metric used by every new table flow", () => {
    const tableId = "10000000-0000-4000-8000-000000000001" as UUID;

    expect(makeDefaultCountMetric(tableId)).toMatchObject({
      name: "Count",
      tableId,
      columnName: undefined,
      aggregation: "count",
    });
  });
});
