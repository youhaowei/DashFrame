import { tableFromIPC } from "apache-arrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createDataFrame } = vi.hoisted(() => ({
  createDataFrame: vi.fn(),
}));

vi.mock("@dashframe/engine-browser", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@dashframe/engine-browser")>();
  return {
    ...actual,
    DataFrame: { create: createDataFrame },
  };
});

import { csvToDataFrame } from "./index";

const originalTimeZone = process.env.TZ;

async function withTimeZone<T>(
  timeZone: string,
  fn: () => Promise<T>,
): Promise<T> {
  process.env.TZ = timeZone;
  try {
    return await fn();
  } finally {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  }
}

describe("csvToDataFrame date-time import", () => {
  beforeEach(() => {
    createDataFrame.mockReset();
    createDataFrame.mockResolvedValue({ id: "data-frame-id" });
  });

  afterEach(() => {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  });

  it("keeps zoneless calendar timestamps stable in a negative-offset browser time zone", async () => {
    const result = await withTimeZone("America/New_York", () =>
      csvToDataFrame(
        [
          [
            "zoneless_t",
            "day_only",
            "space_datetime",
            "utc_timestamp",
            "offset_timestamp",
          ],
          [
            "2024-07-18T23:45:00",
            "2024-07-18",
            "2024-07-18 23:45:00",
            "2024-07-18T23:45:00Z",
            "2024-07-18T23:45:00-07:00",
          ],
        ],
        "table-id",
      ),
    );

    expect(result.fields.map((field) => field.type)).toEqual([
      "date",
      "date",
      "date",
      "date",
      "date",
    ]);

    expect(createDataFrame).toHaveBeenCalledOnce();
    const [arrowBuffer] = createDataFrame.mock.calls[0] as [Uint8Array];
    const table = tableFromIPC(arrowBuffer);

    expect(table.getChild("zoneless_t")?.get(0)).toBe(
      Date.UTC(2024, 6, 18, 23, 45),
    );
    expect(table.getChild("day_only")?.get(0)).toBe(Date.UTC(2024, 6, 18));
    expect(table.getChild("space_datetime")?.get(0)).toBe(
      Date.UTC(2024, 6, 18, 23, 45),
    );
    expect(table.getChild("utc_timestamp")?.get(0)).toBe(
      Date.parse("2024-07-18T23:45:00Z"),
    );
    expect(table.getChild("offset_timestamp")?.get(0)).toBe(
      Date.parse("2024-07-18T23:45:00-07:00"),
    );
  });

  it("does not depend on a positive-offset browser time zone", async () => {
    const importedEpoch = await withTimeZone("Pacific/Auckland", async () => {
      await csvToDataFrame(
        [["zoneless_t"], ["2024-07-18T23:45:00"]],
        "table-id",
      );
      expect(createDataFrame).toHaveBeenCalledOnce();
      const [arrowBuffer] = createDataFrame.mock.calls[0] as [Uint8Array];
      return tableFromIPC(arrowBuffer).getChild("zoneless_t")?.get(0);
    });

    expect(importedEpoch).toBe(Date.UTC(2024, 6, 18, 23, 45));
  });
});
