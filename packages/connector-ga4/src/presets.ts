import type { Ga4TableDefinition } from "./definition.js";

export interface Ga4Preset {
  id: string;
  name: string;
  description: string;
  definition: Ga4TableDefinition;
}

const daily = (
  dimensions: string[],
  metrics: string[],
  filters?: Ga4TableDefinition["filters"],
): Ga4TableDefinition => ({
  dimensions: ["date", ...dimensions],
  metrics,
  dateRange: { kind: "relative", months: 13 },
  grain: "day",
  ...(filters ? { filters } : {}),
});

export const GA4_PRESETS: readonly Ga4Preset[] = [
  // The quickest health check for traffic, engagement, conversion, and revenue.
  {
    id: "daily-overview",
    name: "Daily overview",
    description: "Track headline audience, engagement, and revenue trends.",
    definition: daily(
      [],
      [
        "sessions",
        "engagedSessions",
        "activeUsers",
        "newUsers",
        "screenPageViews",
        "eventCount",
        "keyEvents",
        "totalRevenue",
      ],
    ),
  },
  // Separates acquisition performance by GA4's stable channel grouping.
  {
    id: "traffic-acquisition",
    name: "Traffic acquisition",
    description: "Compare traffic and outcomes by session channel.",
    definition: daily(
      ["sessionDefaultChannelGroup"],
      [
        "sessions",
        "engagedSessions",
        "activeUsers",
        "newUsers",
        "keyEvents",
        "totalRevenue",
      ],
    ),
  },
  // Keeps campaign, source, and medium together for campaign debugging.
  {
    id: "campaigns",
    name: "Campaigns",
    description: "Evaluate sessions and outcomes by campaign and source.",
    definition: daily(
      ["sessionCampaignName", "sessionSource", "sessionMedium"],
      ["sessions", "engagedSessions", "keyEvents", "totalRevenue"],
    ),
  },
  // Uses landingPage because query strings fragment otherwise identical entries.
  {
    id: "landing-pages",
    name: "Landing pages",
    description: "See which entry pages attract and engage sessions.",
    definition: daily(
      ["landingPage"],
      ["sessions", "engagedSessions", "activeUsers", "keyEvents"],
    ),
  },
  // Provides page-level content demand without mixing in acquisition dimensions.
  {
    id: "pages",
    name: "Pages",
    description: "Track page views and engagement by path.",
    definition: daily(
      ["pagePath"],
      ["screenPageViews", "activeUsers", "eventCount"],
    ),
  },
  // Makes the event taxonomy inspectable before more specialized analysis.
  {
    id: "events",
    name: "Events",
    description: "Inspect event activity by event name.",
    definition: daily(["eventName"], ["eventCount", "activeUsers"]),
  },
  // `keyEvents:<name>` is site-specific; filtering aggregate keyEvents above zero
  // discovers the site's configured names without baking them into the catalogue.
  {
    id: "key-events-by-name",
    name: "Key events by name",
    description: "Track configured key events by their event name.",
    definition: daily(
      ["eventName"],
      ["keyEvents"],
      [
        {
          kind: "metric",
          field: "keyEvents",
          operator: "greaterThan",
          value: 0,
        },
      ],
    ),
  },
  // Click events plus destination fields isolate outbound navigation.
  {
    id: "outbound-clicks",
    name: "Outbound clicks",
    description: "See which external destinations receive clicks.",
    definition: daily(
      ["linkDomain", "linkUrl", "eventName"],
      ["eventCount"],
      [
        {
          kind: "dimension",
          field: "eventName",
          operator: "exact",
          values: ["click"],
        },
      ],
    ),
  },
  // Referral medium filtering avoids mixing referrals with other source traffic.
  {
    id: "referrals",
    name: "Referrals",
    description: "Compare referring sources and their session outcomes.",
    definition: daily(
      ["sessionSource"],
      ["sessions", "engagedSessions", "keyEvents"],
      [
        {
          kind: "dimension",
          field: "sessionMedium",
          operator: "exact",
          values: ["referral"],
        },
      ],
    ),
  },
  // Country and device answer the first audience-segmentation questions together.
  {
    id: "audience",
    name: "Audience",
    description:
      "Understand audience activity by country and device; multi-country days show — for session totals.",
    definition: daily(
      ["country", "deviceCategory"],
      ["activeUsers", "newUsers", "sessions"],
    ),
  },
  // Browser and operating system expose technical compatibility patterns.
  {
    id: "technology",
    name: "Technology",
    description:
      "Compare usage by browser and operating system; days with more than one browser or operating system show — for session totals.",
    definition: daily(
      ["browser", "operatingSystem"],
      ["activeUsers", "sessions", "screenPageViews"],
    ),
  },
  // Item-scoped commerce metrics belong beside an item-scoped dimension.
  {
    id: "items",
    name: "Items",
    description: "Compare product discovery, carting, purchases, and revenue.",
    definition: daily(
      ["itemName"],
      ["itemsViewed", "itemsAddedToCart", "itemsPurchased", "itemRevenue"],
    ),
  },
  // Purchase totals by channel support revenue-focused acquisition analysis.
  {
    id: "purchases",
    name: "Purchases",
    description: "Track purchases and revenue by acquisition channel.",
    definition: daily(
      ["sessionDefaultChannelGroup"],
      ["transactions", "purchaseRevenue"],
    ),
  },
] as const;
