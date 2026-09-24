import { describe, expect, it } from "vite-plus/test";

import {
  METRIC_CONTRACTS,
  contractFor,
  parseMetadata,
  ratioExpressionFor,
  scopeFor,
  scopeForMetric,
} from "./metadata";
import { GA4_PRESETS } from "./presets";

describe("GA4 metadata", () => {
  it("assigns curated, custom, prefix, and fail-closed dimension scopes", () => {
    expect([
      scopeFor("date"),
      scopeFor("sessionSource"),
      scopeFor("pagePath"),
      scopeFor("country"),
      scopeFor("itemName"),
      scopeFor("customEvent:plan"),
      scopeFor("customUser:tier"),
      scopeFor("customItem:color"),
      scopeFor("itemBrand"),
      scopeFor("dateHourMinute"),
      scopeFor("futureDimension"),
    ]).toEqual([
      "time",
      "session",
      "event",
      "user",
      "item",
      "event",
      "user",
      "item",
      "item",
      "time",
      "user",
    ]);
    expect(
      [
        "dateHour",
        "dateHourMinute",
        "year",
        "month",
        "week",
        "day",
        "dayOfWeek",
        "hour",
        "minute",
        "nthDay",
        "nthWeek",
        "nthMonth",
      ].map(scopeFor),
    ).toEqual(Array.from({ length: 12 }, () => "time"));
    expect(
      [
        "itemBrand",
        "itemVariant",
        "itemCategory2",
        "itemCategory5",
        "itemListName",
      ].map(scopeFor),
    ).toEqual(Array.from({ length: 5 }, () => "item"));
  });

  it("assigns metric scopes independently from dimension fallbacks", () => {
    expect([
      scopeForMetric("activeUsers"),
      scopeForMetric("sessions"),
      scopeForMetric("eventCount"),
      scopeForMetric("itemsPurchased"),
      scopeForMetric("keyEvents:signup"),
      scopeForMetric("futureMetric"),
    ]).toEqual(["user", "session", "event", "item", "event", "event"]);
  });

  it("parses provider metadata including site-specific key-event metrics", () => {
    expect(
      parseMetadata({
        dimensions: [
          {
            category: "Custom",
            apiName: "customUser:tier",
            uiName: "Tier",
            description: "Customer tier",
          },
        ],
        metrics: [
          {
            category: "Key events",
            apiName: "keyEvents:signup",
            uiName: "Signups",
            description: "Signup key events",
            type: "TYPE_FLOAT",
          },
          {
            category: "Session",
            apiName: "engagementRate",
            uiName: "Engagement rate",
            description: "Engaged sessions divided by sessions",
            type: "TYPE_FLOAT",
          },
        ],
      }),
    ).toEqual([
      {
        category: "Custom",
        apiName: "customUser:tier",
        uiName: "Tier",
        description: "Customer tier",
        type: "DIMENSION",
        scope: "user",
      },
      {
        category: "Key events",
        apiName: "keyEvents:signup",
        uiName: "Signups",
        description: "Signup key events",
        type: "TYPE_FLOAT",
        scope: "event",
        contract: {
          kind: "additive",
          additiveOver: ["time", "session", "event"],
        },
      },
      {
        category: "Session",
        apiName: "engagementRate",
        uiName: "Engagement rate",
        description: "Engaged sessions divided by sessions",
        type: "TYPE_FLOAT",
        scope: "session",
        contract: { kind: "ratio" },
        ratioExpression: {
          numerator: "engagedSessions",
          denominator: "sessions",
        },
      },
    ]);
  });

  it("has an explicit safe contract for every shipped preset metric", () => {
    const metrics = new Set(
      GA4_PRESETS.flatMap((preset) => preset.definition.metrics),
    );
    for (const metric of metrics) {
      expect(Object.hasOwn(METRIC_CONTRACTS, metric)).toBe(true);
    }
    expect(contractFor("newUsers")).toEqual({
      kind: "additive",
      additiveOver: ["time", "session"],
    });
    expect(contractFor("engagementRate")).toEqual({
      kind: "ratio",
    });
    expect(ratioExpressionFor("engagementRate")).toEqual({
      numerator: "engagedSessions",
      denominator: "sessions",
    });
    expect(ratioExpressionFor("averageSessionDuration")).toEqual({
      numerator: {
        op: "mul",
        left: "averageSessionDuration",
        right: "sessions",
      },
      denominator: "sessions",
      rowwise: true,
    });
    expect(ratioExpressionFor("bounceRate")).toEqual({
      numerator: { op: "sub", left: "sessions", right: "engagedSessions" },
      denominator: "sessions",
    });
    expect(contractFor("sessionsPerUser")).toEqual({ kind: "non-additive" });
    expect(contractFor("futureMetric")).toEqual({ kind: "non-additive" });
    for (const metric of [
      "itemRevenue",
      "itemsPurchased",
      "itemsViewed",
      "itemsAddedToCart",
    ]) {
      expect(contractFor(metric)).toEqual({
        kind: "additive",
        additiveOver: ["time", "session", "event", "item"],
      });
    }
    for (const metric of ["transactions", "purchaseRevenue", "totalRevenue"]) {
      expect(contractFor(metric)).toEqual({
        kind: "additive",
        additiveOver: ["time", "session", "event"],
      });
    }
  });
});
