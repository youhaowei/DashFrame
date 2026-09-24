import { describe, expect, it } from "vite-plus/test";

import { checkCompatibility, parseCompatibility } from "./compatibility";

describe("GA4 compatibility", () => {
  it("maps a compatible response", () => {
    expect(
      parseCompatibility({
        dimensionCompatibilities: [{ compatibility: "COMPATIBLE" }],
        metricCompatibilities: [{ compatibility: "COMPATIBLE" }],
      }),
    ).toEqual({ ok: true });
  });

  it("maps one incompatible dimension", () => {
    expect(
      parseCompatibility({
        dimensionCompatibilities: [
          {
            compatibility: "INCOMPATIBLE",
            dimensionMetadata: { apiName: "browser" },
            reason: "Not available with the selected metrics",
          },
        ],
      }),
    ).toEqual({
      ok: false,
      incompatible: [
        { field: "browser", reason: "Not available with the selected metrics" },
      ],
    });
  });

  it("maps one incompatible metric", () => {
    expect(
      parseCompatibility({
        metricCompatibilities: [
          {
            compatibility: "INCOMPATIBLE",
            metricMetadata: { apiName: "itemRevenue" },
          },
        ],
      }),
    ).toEqual({
      ok: false,
      incompatible: [
        {
          field: "itemRevenue",
          reason: "GA4 reports this field as incompatible with the definition",
        },
      ],
    });
  });

  it("ignores incompatibilities for catalogue fields outside the definition", () => {
    expect(
      parseCompatibility(
        {
          dimensionCompatibilities: [
            {
              compatibility: "INCOMPATIBLE",
              dimensionMetadata: { apiName: "itemName" },
            },
          ],
        },
        new Set(["date", "sessions"]),
      ),
    ).toEqual({ ok: true });
  });

  it("checks the same dimension and metric filters used by runReport", async () => {
    let request: RequestInit | undefined;
    await checkCompatibility(
      "123",
      {
        dimensions: ["date", "sessionSource"],
        metrics: ["sessions", "keyEvents"],
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
      },
      {
        request: async (_url, init) => {
          request = init;
          return {};
        },
      },
    );
    expect(JSON.parse(String(request?.body))).toMatchObject({
      dimensionFilter: {
        filter: {
          fieldName: "sessionMedium",
          stringFilter: { value: "referral" },
        },
      },
      metricFilter: {
        filter: {
          fieldName: "keyEvents",
          numericFilter: { operation: "GREATER_THAN" },
        },
      },
    });
  });

  it("reports an incompatible field used only by a filter", async () => {
    expect(
      await checkCompatibility(
        "123",
        {
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
          ],
        },
        {
          request: async () => ({
            dimensionCompatibilities: [
              {
                compatibility: "INCOMPATIBLE",
                dimensionMetadata: { apiName: "sessionMedium" },
                reason: "Not available with the selected metrics",
              },
            ],
          }),
        },
      ),
    ).toEqual({
      ok: false,
      incompatible: [
        {
          field: "sessionMedium",
          reason: "Not available with the selected metrics",
        },
      ],
    });
  });
});
