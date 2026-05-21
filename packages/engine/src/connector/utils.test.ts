import { describe, expect, it } from "bun:test";

import { parsePrimitiveValueByType } from "./utils";

describe("parsePrimitiveValueByType", () => {
  it("parses numeric date values as Unix timestamps", () => {
    expect(parsePrimitiveValueByType(1_700_000_000, "date")).toEqual(
      new Date(1_700_000_000_000),
    );
    expect(parsePrimitiveValueByType(1_700_000_000_000, "date")).toEqual(
      new Date(1_700_000_000_000),
    );
  });

  it("returns null for invalid date strings", () => {
    expect(parsePrimitiveValueByType("not-a-date", "date")).toBeNull();
  });
});
