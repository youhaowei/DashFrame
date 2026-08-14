import {
  MAX_LOCAL_ARROW_BYTES,
  MAX_LOCAL_SOURCE_BYTES,
  type UUID,
} from "@dashframe/engine";
import { tableFromIPC } from "apache-arrow";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { csvToDataFrame } from "./index";

const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Pacific/Auckland";
});
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

const DATA_TABLE_ID = "10000000-0000-4000-8000-000000000001" as UUID;

describe("CSV date ingestion", () => {
  it("preserves zoneless date-times as UTC calendar values", async () => {
    const result = await csvToDataFrame(
      [
        ["zoneless_t", "zoneless_space", "explicit_offset"],
        [
          "2024-07-18T00:30:00",
          "2024-07-18 00:30:00",
          "2024-07-18T00:30:00+12:00",
        ],
      ],
      DATA_TABLE_ID,
    );
    const row = tableFromIPC(result.arrowBuffer).get(0)?.toJSON();

    expect(row).toEqual({
      zoneless_t: Date.UTC(2024, 6, 18, 0, 30),
      zoneless_space: Date.UTC(2024, 6, 18, 0, 30),
      explicit_offset: Date.UTC(2024, 6, 17, 12, 30),
    });
  });

  it("preserves non-ISO date-like values as text", async () => {
    const raw = "2024/07/18 00:30:00";
    const result = await csvToDataFrame(
      [["legacy_date"], [raw]],
      DATA_TABLE_ID,
    );
    const row = tableFromIPC(result.arrowBuffer).get(0)?.toJSON();

    expect(result.fields[0]?.type).toBe("string");
    expect(row).toEqual({ legacy_date: raw });
  });
});

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

    const result = await csvToDataFrame(data, DATA_TABLE_ID);

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
