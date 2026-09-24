import type { UUID } from "./uuid";
import type { InsightFilter } from "./insights";

/**
 * Supported aggregation functions.
 */
export type AggregationType =
  | "sum"
  | "avg"
  | "count"
  | "min"
  | "max"
  | "count_distinct";

export const GRAIN_SCOPES = [
  "time",
  "user",
  "session",
  "event",
  "item",
] as const;

export type GrainScope = (typeof GRAIN_SCOPES)[number];

export type MeasureContract =
  | { kind: "additive"; additiveOver?: GrainScope[] }
  | { kind: "ratio" }
  | { kind: "non-additive" };

/**
 * Metric - An aggregation definition.
 *
 * Metrics define how to aggregate column values:
 * - SUM of sales
 * - COUNT of rows
 * - AVG of ratings
 */
export type Metric = {
  id: UUID;
  name: string;
  /** Which DataTable owns this metric (lineage) */
  tableId: UUID;
  /** Which TableColumn to aggregate (undefined for count()) */
  columnName?: string;
  aggregation: AggregationType;
  /** Aggregate expression replaces the simple aggregation when present. */
  expression?: MeasureExpression;
  /** Row predicates apply only to this measure, before aggregation. */
  filters?: MeasureFilter[];
  format?: MeasureFormat;
  contract?: MeasureContract;
};

/**
 * InsightMetric - A computed column in an Insight.
 * Similar to Metric but tracks source table explicitly.
 */
export interface InsightMetric {
  id: UUID;
  name: string;
  /** Which table (base or joined) - for v1, always baseTable.tableId */
  sourceTable: UUID;
  /** Which column to aggregate (undefined for count()) */
  columnName?: string;
  aggregation: AggregationType;
  /** Aggregate expression replaces the simple aggregation when present. */
  expression?: MeasureExpression;
  /** Row predicates apply only to this measure, before aggregation. */
  filters?: MeasureFilter[];
  format?: MeasureFormat;
  contract?: MeasureContract;
}

/** Aggregate arithmetic. References resolve within the saved measure collection. */
export type MeasureExpression =
  | { kind: "measure"; measureId: UUID }
  | { kind: "constant"; value: number }
  | {
      kind: "binary";
      operator: "add" | "subtract" | "multiply" | "divide";
      left: MeasureExpression;
      right: MeasureExpression;
    };

export type MeasureFormat = {
  style: "number" | "currency" | "percent";
  decimals?: number;
  currency?: string;
};

/** Bounded validation shared by persistence and execution boundaries. */
export function isMeasureExpression(
  value: unknown,
  depth = 0,
): value is MeasureExpression {
  if (depth > 32 || !value || typeof value !== "object") return false;
  if (!("kind" in value)) return false;
  switch (value.kind) {
    case "constant":
      return (
        "value" in value &&
        typeof value.value === "number" &&
        Number.isFinite(value.value)
      );
    case "measure":
      return (
        "measureId" in value &&
        typeof value.measureId === "string" &&
        value.measureId.length > 0
      );
    case "binary":
      return (
        "operator" in value &&
        ["add", "subtract", "multiply", "divide"].includes(
          String(value.operator),
        ) &&
        "left" in value &&
        "right" in value &&
        isMeasureExpression(value.left, depth + 1) &&
        isMeasureExpression(value.right, depth + 1)
      );
    default:
      return false;
  }
}

/** Persistable measure-local predicates, distinct from untyped input drafts. */
export type MeasureFilter = {
  field: string;
  operator: InsightFilter["operator"];
  value:
    | string
    | number
    | boolean
    | null
    | Array<string | number | boolean | null>
    | { low: string | number; high: string | number };
};
