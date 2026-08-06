import { tableFromIPC } from "apache-arrow";
import { describe, expect, it } from "vitest";

import { createArrowIPCBufferFromRows } from "../arrow";

describe("createArrowIPCBufferFromRows", () => {
  it("maps every ColumnType through the shared exhaustive adapter contract", () => {
    const ipc = createArrowIPCBufferFromRows(
      [
        {
          number: 42,
          boolean: true,
          date: Date.UTC(2026, 7, 5),
          string: "value",
          unknown: "fallback",
        },
      ],
      [
        { name: "number", type: "number" },
        { name: "boolean", type: "boolean" },
        { name: "date", type: "date" },
        { name: "string", type: "string" },
        { name: "unknown", type: "unknown" },
      ],
    );

    const table = tableFromIPC(ipc);
    expect(table.schema.fields.map((field) => field.type.toString())).toEqual([
      "Float64",
      "Bool",
      "Timestamp<MILLISECOND>",
      "Utf8",
      "Utf8",
    ]);
  });
});
