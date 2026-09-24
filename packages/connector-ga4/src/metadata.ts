import type {
  ConnectorFieldMetadata,
  RatioExpression,
} from "@dashframe/engine";
import type { GrainScope, MeasureContract } from "@dashframe/types";

export interface Ga4ApiClient {
  request(
    url: string,
    init?: RequestInit,
    maxResponseBytes?: number,
  ): Promise<unknown>;
  requestMeasured?(
    url: string,
    init: RequestInit | undefined,
    maxResponseBytes: number,
  ): Promise<{ body: unknown; byteLength: number }>;
}

export const DIMENSION_SCOPES: Readonly<Record<string, GrainScope>> = {
  date: "time",
  dateHour: "time",
  dateHourMinute: "time",
  year: "time",
  month: "time",
  week: "time",
  day: "time",
  dayOfWeek: "time",
  yearWeek: "time",
  isoYearIsoWeek: "time",
  yearMonth: "time",
  hour: "time",
  minute: "time",
  nthDay: "time",
  nthWeek: "time",
  nthMonth: "time",
  sessionDefaultChannelGroup: "session",
  sessionSource: "session",
  sessionMedium: "session",
  sessionCampaignName: "session",
  landingPage: "session",
  landingPagePlusQueryString: "session",
  pagePath: "event",
  eventName: "event",
  linkDomain: "event",
  linkUrl: "event",
  country: "user",
  city: "user",
  deviceCategory: "user",
  browser: "user",
  operatingSystem: "user",
  newVsReturning: "user",
  itemName: "item",
  itemId: "item",
  itemCategory: "item",
};

export const METRIC_SCOPES: Readonly<Record<string, GrainScope>> = {
  activeUsers: "user",
  newUsers: "user",
  totalUsers: "user",
  sessions: "session",
  engagedSessions: "session",
  engagementRate: "session",
  bounceRate: "session",
  averageSessionDuration: "session",
  eventsPerSession: "session",
  sessionsPerUser: "session",
  eventCount: "event",
  keyEvents: "event",
  screenPageViews: "event",
  conversions: "event",
  totalRevenue: "event",
  purchaseRevenue: "event",
  transactions: "event",
  itemsViewed: "item",
  itemsAddedToCart: "item",
  itemsPurchased: "item",
  itemRevenue: "item",
};

export function scopeFor(apiName: string): GrainScope {
  if (apiName.startsWith("customEvent:")) return "event";
  if (apiName.startsWith("customUser:")) return "user";
  if (apiName.startsWith("customItem:")) return "item";
  if (apiName.startsWith("landingPage")) return "session";
  if (apiName.startsWith("item")) return "item";
  // Fail closed: user is the one scope no additiveOver list contains.
  return DIMENSION_SCOPES[apiName] ?? "user";
}

export function scopeForMetric(apiName: string): GrainScope {
  if (apiName.startsWith("keyEvents:")) return "event";
  return METRIC_SCOPES[apiName] ?? "event";
}

const additive = (additiveOver: GrainScope[]): MeasureContract => ({
  kind: "additive",
  additiveOver,
});

export const METRIC_CONTRACTS: Readonly<Record<string, MeasureContract>> = {
  // https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema#user
  activeUsers: { kind: "non-additive" },
  newUsers: additive(["time", "session"]),
  totalUsers: { kind: "non-additive" },

  // https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema#session
  sessions: additive(["time", "session"]),
  engagedSessions: additive(["time", "session"]),

  // https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema#event
  eventCount: additive(["time", "session", "event"]),
  keyEvents: additive(["time", "session", "event"]),
  screenPageViews: additive(["time", "session", "event"]),
  conversions: additive(["time", "session", "event"]),

  // GA4 schema: `totalRevenue`, `purchaseRevenue`, and `transactions` are
  // transaction/event totals, not per-item values. Do not add them over item.
  // https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema#metrics
  totalRevenue: additive(["time", "session", "event"]),
  purchaseRevenue: additive(["time", "session", "event"]),
  transactions: additive(["time", "session", "event"]),
  // GA4 schema: these fields explicitly count units "for a single item" or
  // revenue "from items only", so item is a valid additive dimension.
  // https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema#metrics
  itemsPurchased: additive(["time", "session", "event", "item"]),
  itemsViewed: additive(["time", "session", "event", "item"]),
  itemsAddedToCart: additive(["time", "session", "event", "item"]),
  itemRevenue: additive(["time", "session", "event", "item"]),

  // https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema#session
  engagementRate: { kind: "ratio" },
  bounceRate: { kind: "ratio" },
  averageSessionDuration: { kind: "ratio" },
  eventsPerSession: { kind: "ratio" },
  sessionsPerUser: { kind: "non-additive" },
};

/** Aggregate recipes stay separate because persisted MeasureContract is discriminant-only. */
export const METRIC_RATIO_EXPRESSIONS: Readonly<
  Record<string, RatioExpression>
> = {
  engagementRate: { numerator: "engagedSessions", denominator: "sessions" },
  bounceRate: {
    numerator: { op: "sub", left: "sessions", right: "engagedSessions" },
    denominator: "sessions",
  },
  // Multiply each row's average by its sessions before summing the numerator.
  averageSessionDuration: {
    numerator: {
      op: "mul",
      left: "averageSessionDuration",
      right: "sessions",
    },
    denominator: "sessions",
    rowwise: true,
  },
  eventsPerSession: { numerator: "eventCount", denominator: "sessions" },
};

/** Unknown provider metrics are unsafe to sum until they receive a reviewed contract. */
export function contractFor(metricApiName: string): MeasureContract {
  if (metricApiName.startsWith("keyEvents:")) {
    return METRIC_CONTRACTS.keyEvents!;
  }
  return METRIC_CONTRACTS[metricApiName] ?? { kind: "non-additive" };
}

export function ratioExpressionFor(
  metricApiName: string,
): RatioExpression | undefined {
  return METRIC_RATIO_EXPRESSIONS[metricApiName];
}

interface MetadataResponse {
  dimensions?: unknown;
  metrics?: unknown;
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === "object",
      )
    : [];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function parseMetadata(
  body: MetadataResponse,
): ConnectorFieldMetadata[] {
  const dimensions = records(body.dimensions).flatMap((field) => {
    const apiName = text(field.apiName);
    if (!apiName) return [];
    return [
      {
        category: text(field.category),
        apiName,
        uiName: text(field.uiName, apiName),
        description: text(field.description),
        type: text(field.type, "DIMENSION"),
        scope: scopeFor(apiName),
      },
    ];
  });
  const metrics = records(body.metrics).flatMap((field) => {
    const apiName = text(field.apiName);
    if (!apiName) return [];
    const ratioExpression = ratioExpressionFor(apiName);
    return [
      {
        category: text(field.category),
        apiName,
        uiName: text(field.uiName, apiName),
        description: text(field.description),
        type: text(field.type, "METRIC"),
        scope: scopeForMetric(apiName),
        contract: contractFor(apiName),
        ...(ratioExpression ? { ratioExpression } : {}),
      },
    ];
  });
  return [...dimensions, ...metrics];
}

function propertyResource(site: string): string {
  const value = site.startsWith("properties/") ? site : `properties/${site}`;
  if (!/^properties\/\d+$/u.test(value))
    throw new Error("[GA4Connector] Invalid GA4 site id");
  return value;
}

export async function getMetadata(
  site: string,
  client: Ga4ApiClient,
): Promise<ConnectorFieldMetadata[]> {
  const property = propertyResource(site);
  const body = (await client.request(
    `https://analyticsdata.googleapis.com/v1beta/${property}/metadata`,
  )) as MetadataResponse;
  return parseMetadata(body);
}

export { propertyResource };
