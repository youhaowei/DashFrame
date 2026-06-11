import { tableFromIPC } from "apache-arrow";
import { describe, expect, it } from "vitest";

import {
  duckdbColumnsToArrowIpc,
  duckdbTypeIdToColumnType,
} from "./arrow-encode";

// DuckDBTypeId numeric values (stable, from @duckdb/node-api).
const BOOLEAN = 1;
const INTEGER = 4;
const BIGINT = 5;
const DOUBLE = 11;
const TIMESTAMP = 12;
const DATE = 13;
const VARCHAR = 17;
const DECIMAL = 19;

describe("duckdbTypeIdToColumnType", () => {
  it("maps integer/float/decimal families to number", () => {
    for (const id of [INTEGER, BIGINT, DOUBLE, DECIMAL]) {
      expect(duckdbTypeIdToColumnType(id)).toBe("number");
    }
  });
  it("maps boolean", () => {
    expect(duckdbTypeIdToColumnType(BOOLEAN)).toBe("boolean");
  });
  it("maps date/timestamp families to date", () => {
    for (const id of [DATE, TIMESTAMP]) {
      expect(duckdbTypeIdToColumnType(id)).toBe("date");
    }
  });
  it("maps varchar to string", () => {
    expect(duckdbTypeIdToColumnType(VARCHAR)).toBe("string");
  });
  it("maps unknown ids to unknown", () => {
    expect(duckdbTypeIdToColumnType(9999)).toBe("unknown");
    expect(duckdbTypeIdToColumnType(undefined)).toBe("unknown");
  });
});

describe("duckdbColumnsToArrowIpc roundtrip", () => {
  it("encodes typed columns to Arrow IPC and back", () => {
    const ipc = duckdbColumnsToArrowIpc([
      { name: "n", typeId: INTEGER, values: [1, 2, 3] },
      { name: "flag", typeId: BOOLEAN, values: [true, false, null] },
      { name: "name", typeId: VARCHAR, values: ["x", "y", "z"] },
    ]);

    const table = tableFromIPC(ipc);
    expect(table.numRows).toBe(3);
    expect(table.getChild("n")?.toArray()).toEqual(new Float64Array([1, 2, 3]));
    expect([...(table.getChild("flag")?.toArray() ?? [])]).toEqual([
      true,
      false,
      null,
    ]);
    expect(table.getChild("name")?.toArray()).toEqual(["x", "y", "z"]);
  });

  it("coerces JSON-normalized bigint strings to numeric Arrow values", () => {
    // getColumnsObjectJson emits BIGINT as a string; the encoder coerces it.
    const ipc = duckdbColumnsToArrowIpc([
      { name: "big", typeId: BIGINT, values: ["10", "20"] },
    ]);
    const table = tableFromIPC(ipc);
    expect(table.getChild("big")?.toArray()).toEqual(
      new Float64Array([10, 20]),
    );
  });

  it("rejects duplicate column names instead of silently overwriting (no corrupt results)", () => {
    // `SELECT 1 AS v, 2 AS v` is legal SQL; a name-keyed Record would keep
    // only the second column. Fail closed instead.
    expect(() =>
      duckdbColumnsToArrowIpc([
        { name: "v", typeId: INTEGER, values: [1] },
        { name: "v", typeId: INTEGER, values: [2] },
      ]),
    ).toThrow(/duplicate column name 'v'/);
  });

  it("rejects integer strings beyond Float64's exact range instead of rounding silently", () => {
    // 2^53 + 1 — Number() would round this to 2^53 with no error.
    const unsafe = "9007199254740993";
    expect(() =>
      duckdbColumnsToArrowIpc([
        { name: "id", typeId: BIGINT, values: [unsafe] },
      ]),
    ).toThrow(/exceeds Float64's exact range/);
  });

  it("passes integer strings at the edge of the safe range through exactly", () => {
    const maxSafe = String(Number.MAX_SAFE_INTEGER); // 2^53 - 1
    const ipc = duckdbColumnsToArrowIpc([
      { name: "id", typeId: BIGINT, values: [maxSafe, "-42", null] },
    ]);
    const id = tableFromIPC(ipc).getChild("id");
    // get() respects the validity bitmap (toArray() reads nulls as 0).
    expect(id?.get(0)).toBe(Number.MAX_SAFE_INTEGER);
    expect(id?.get(1)).toBe(-42);
    expect(id?.get(2)).toBeNull();
  });
});
