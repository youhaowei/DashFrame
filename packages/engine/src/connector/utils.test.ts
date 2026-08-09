import { describe, expect, it } from "bun:test";

import {
  inferStringColumnType,
  parsePrimitiveValueByType,
  parseStringValueByType,
} from "./utils";

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

describe("parseStringValueByType", () => {
  it("keeps JavaScript local-time semantics for shared zoneless date parsing", () => {
    const originalTimeZone = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const zonelessT = parseStringValueByType("2024-07-18T23:45:00", "date");
      const spaceSeparated = parseStringValueByType(
        "2024-07-18 23:45:00",
        "date",
      );

      const expectedLocalTime = new Date(2024, 6, 18, 23, 45);
      expect(zonelessT).toEqual(expectedLocalTime);
      expect(spaceSeparated).toEqual(expectedLocalTime);
      expect(zonelessT).not.toEqual(new Date(Date.UTC(2024, 6, 18, 23, 45)));
    } finally {
      if (originalTimeZone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimeZone;
    }
  });

  it("keeps date-only and explicitly zoned values on their existing paths", () => {
    const dateOnly = parseStringValueByType("2024-07-18", "date");
    const utc = parseStringValueByType("2024-07-18T23:45:00Z", "date");
    const offset = parseStringValueByType("2024-07-18T23:45:00-07:00", "date");

    expect(dateOnly).toEqual(new Date(Date.UTC(2024, 6, 18)));
    expect(utc).toEqual(new Date("2024-07-18T23:45:00Z"));
    expect(offset).toEqual(new Date("2024-07-18T23:45:00-07:00"));
  });

  it("continues to identify the supported calendar forms as dates", () => {
    expect(inferStringColumnType("2024-07-18")).toBe("date");
    expect(inferStringColumnType("2024-07-18T23:45:00")).toBe("date");
    expect(inferStringColumnType("2024-07-18 23:45:00")).toBe("date");
    expect(inferStringColumnType("2024-07-18T23:45:00Z")).toBe("date");
    expect(inferStringColumnType("2024-07-18T23:45:00-07:00")).toBe("date");
  });
});
