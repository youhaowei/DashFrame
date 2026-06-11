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
});
