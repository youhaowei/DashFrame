import {
  MAX_LOCAL_ARROW_BYTES,
  MAX_LOCAL_SOURCE_BYTES,
  type UUID,
} from "@dashframe/engine";
import { describe, expect, it } from "vitest";
import { csvToDataFrame } from "./index";

describe("CSV Arrow ingestion budget", () => {
  it("keeps expansion-heavy source uploads below a conservative encoded budget", async () => {
    const columnCount = 50;
    const rows = Array.from({ length: 2_000 }, () => [
      "x",
      ...Array.from({ length: columnCount - 1 }, () => ""),
    ]);
    const data = [
      Array.from({ length: columnCount }, (_, index) => `c${index}`),
      ...rows,
    ];
    const sourceBytes = new TextEncoder().encode(
      data.map((row) => row.join(",")).join("\n"),
    ).byteLength;

    const result = await csvToDataFrame(
      data,
      "10000000-0000-4000-8000-000000000001" as UUID,
    );

    // Empty strings are cheap in CSV but Arrow still stores a four-byte
    // offset for each cell. This is the concrete expansion the former equal
    // 100MB source/Arrow caps failed to account for.
    const measuredExpansion = result.arrowBuffer.byteLength / sourceBytes;
    expect(measuredExpansion).toBeGreaterThan(3);
    expect(
      Math.ceil(MAX_LOCAL_SOURCE_BYTES * measuredExpansion),
    ).toBeLessThanOrEqual(MAX_LOCAL_ARROW_BYTES);
  });
});
