import { describe, expect, it } from "vite-plus/test";

import { resolveDateRange, validateDefinition } from "./definition";
import { GA4_PRESETS } from "./presets";

describe("GA4 table definitions", () => {
  it("ships only valid daily presets with date as their first dimension", () => {
    for (const preset of GA4_PRESETS) {
      expect(validateDefinition(preset.definition)).toEqual({
        valid: true,
        errors: [],
      });
      expect(preset.definition.dimensions[0]).toBe("date");
      expect(preset.definition.dimensions.length - 1).toBeLessThanOrEqual(3);
    }
  });

  it("rejects provider limits, grain mismatches, duplicates, and invalid ranges", () => {
    expect(
      validateDefinition({
        dimensions: [
          "yearMonth",
          ...Array.from({ length: 9 }, (_, i) => `d${i}`),
        ],
        metrics: [...Array.from({ length: 10 }, (_, i) => `m${i}`), "m0"],
        grain: "week",
        dateRange: { kind: "absolute", start: "2026-02-30", end: "2026-01-01" },
      }).errors,
    ).toEqual(
      expect.arrayContaining([
        "GA4 allows at most 9 dimensions",
        "GA4 allows at most 10 metrics",
        "The first dimension for week grain must be isoYearIsoWeek",
        "Duplicate fields: m0",
        "Absolute start must be an ISO date",
      ]),
    );
  });

  it("resolves relative month starts in the site's reporting time zone", () => {
    const now = Date.parse("2026-03-01T00:30:00Z");
    expect(
      resolveDateRange({ kind: "relative", months: 1 }, now, "Asia/Tokyo"),
    ).toEqual({ startDate: "2026-02-01", endDate: "yesterday" });
    expect(
      resolveDateRange(
        { kind: "relative", months: 1 },
        now,
        "America/Los_Angeles",
      ),
    ).toEqual({ startDate: "2026-01-01", endDate: "yesterday" });
    expect(
      resolveDateRange({ kind: "relative", months: 13 }, now, "Asia/Tokyo"),
    ).toEqual({ startDate: "2025-02-01", endDate: "yesterday" });
  });

  it("rejects operators that contradict selected field kinds", () => {
    const definition = {
      dimensions: ["date", "eventName"],
      metrics: ["eventCount"],
      grain: "day" as const,
      dateRange: { kind: "relative" as const, months: 13 },
    };
    expect(
      validateDefinition({
        ...definition,
        filters: [
          {
            kind: "metric",
            field: "eventName",
            operator: "greaterThan",
            value: 0,
          },
          {
            kind: "dimension",
            field: "eventCount",
            operator: "exact",
            values: ["1"],
          },
        ],
      }).errors,
    ).toEqual([
      "Dimension eventName cannot use a metric filter",
      "Metric eventCount cannot use a dimension filter",
    ]);
    expect(
      validateDefinition({
        ...definition,
        filters: [
          {
            kind: "metric",
            field: "eventCount",
            operator: "greaterThan",
            value: Infinity,
          },
        ],
      }).errors,
    ).toEqual(["greaterThan filter eventCount must have a finite value"]);
  });

  it("validates filter-only fields from their explicit kinds", () => {
    expect(
      validateDefinition({
        dimensions: ["date", "sessionSource"],
        metrics: ["sessions"],
        grain: "day",
        dateRange: { kind: "relative", months: 13 },
        filters: [
          {
            kind: "dimension",
            field: "sessionMedium",
            operator: "exact",
            values: ["referral"],
          },
          {
            kind: "metric",
            field: "keyEvents",
            operator: "greaterThan",
            value: 0,
          },
        ],
      }),
    ).toEqual({ valid: true, errors: [] });
  });

  it("returns validation errors for malformed arrays and filter values", () => {
    expect(
      validateDefinition({
        metrics: ["sessions"],
        grain: "day",
        dateRange: { kind: "relative", months: 1 },
      } as never).errors,
    ).toContain("Dimensions must be an array");
    expect(
      validateDefinition({
        dimensions: ["date"],
        metrics: ["sessions"],
        grain: "day",
        dateRange: { kind: "relative", months: 1 },
        filters: [{ kind: "dimension", field: "eventName", operator: "exact" }],
      } as never).errors,
    ).toContain("exact filter eventName has invalid values");
  });

  it("requires ratio dependencies and blocks event revenue by item", () => {
    expect(
      validateDefinition({
        dimensions: ["date"],
        metrics: ["engagementRate"],
        grain: "day",
        dateRange: { kind: "relative", months: 1 },
      }).errors,
    ).toEqual([
      "Ratio metric engagementRate requires metrics: engagedSessions, sessions",
    ]);
    expect(
      validateDefinition({
        dimensions: ["date", "itemBrand"],
        metrics: ["totalRevenue"],
        grain: "day",
        dateRange: { kind: "relative", months: 1 },
      }).errors,
    ).toEqual([
      "Event-level revenue metrics totalRevenue cannot be combined with item-scoped dimensions itemBrand",
    ]);
  });

  it("admits legacy yearWeek only through the structured option", () => {
    const legacy = {
      dimensions: ["yearWeek"],
      metrics: ["sessions"],
      grain: "week" as const,
      dateRange: {
        kind: "absolute" as const,
        start: "2026-01-01",
        end: "2026-01-31",
      },
    };
    expect(validateDefinition(legacy).valid).toBe(false);
    expect(validateDefinition(legacy, { allowLegacyYearWeek: true })).toEqual({
      valid: true,
      errors: [],
    });
  });
});
