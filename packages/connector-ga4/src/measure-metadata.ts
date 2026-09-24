import type {
  AggregationType,
  GrainScope,
  MeasureContract,
} from "@dashframe/types";

/** Connector-owned semantic scopes persisted on GA4 dimensions. */
export const GA4_FIELD_SCOPES = {
  date: "time",
  yearWeek: "time",
  sessionDefaultChannelGroup: "session",
} as const satisfies Readonly<Record<string, GrainScope>>;

const GA4_SUM_CONTRACTS = {
  activeUsers: { kind: "non-additive" },
  newUsers: { kind: "additive", additiveOver: ["time", "session"] },
  sessions: { kind: "additive", additiveOver: ["time", "session"] },
  engagedSessions: {
    kind: "additive",
    additiveOver: ["time", "session"],
  },
  keyEvents: { kind: "additive", additiveOver: ["time", "session"] },
  totalRevenue: { kind: "additive", additiveOver: ["time", "session"] },
} as const satisfies Readonly<Record<string, MeasureContract>>;

/** Default contract for a plain aggregation over a connector-owned GA4 column. */
export function ga4MeasureContract(
  columnName: string,
  aggregation: AggregationType,
): MeasureContract | undefined {
  if (aggregation !== "sum") return undefined;
  return GA4_SUM_CONTRACTS[columnName as keyof typeof GA4_SUM_CONTRACTS];
}
