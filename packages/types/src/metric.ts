import type { UUID } from "./uuid";
import type { InsightFilter } from "./insights";

/**
 * Supported aggregation functions.
 */
export const AGGREGATIONS = [
  "sum",
  "avg",
  "count",
  "min",
  "max",
  "count_distinct",
] as const;

export type AggregationType = (typeof AGGREGATIONS)[number];

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
 * Whether a measure's contract lets rows, or partial aggregates, be combined
 * into one value when the given dimensions are dropped from the grouping.
 *
 * `droppedScopes` holds the grain scope of each dropped dimension, with
 * `undefined` for a dimension that declares no scope. The answer is static:
 * - No contract: yes. A measure without a contract keeps its plain aggregate.
 * - `additive` without `additiveOver`: yes, over any dimension.
 * - `additive` with `additiveOver`: only when every dropped dimension has a
 *   scope listed there. An unscoped dimension fails closed, because nothing
 *   says the measure may be summed across it.
 * - `ratio`: no. A ratio is recomputed from its component measures, never
 *   combined; a caller that can recompute asks about the components instead.
 * - `non-additive`: no, even when nothing is dropped, because two rows that
 *   share every dimension still cannot be combined.
 *
 * `false` still allows the value at exact grain. A caller that has the source
 * rows may report it where each group holds one row (or one value of each
 * blocking dimension); a caller without the source rows must refuse.
 *
 * Callers decide which columns are dropped dimensions. A field list can mix
 * dimensions with value columns, and value columns carry no scope, so a caller
 * that cannot tell an unscoped dimension from a value column passes only the
 * scoped fields.
 */
export function measureCombinesOver(
  contract: MeasureContract | undefined,
  droppedScopes: readonly (GrainScope | undefined)[],
): boolean {
  if (!contract) return true;
  switch (contract.kind) {
    case "ratio":
    case "non-additive":
      return false;
    case "additive": {
      const allowed = contract.additiveOver;
      return (
        allowed === undefined ||
        droppedScopes.every(
          (scope) => scope !== undefined && allowed.includes(scope),
        )
      );
    }
  }
}

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

/** Strict structural validation shared by stored state and command inputs. */
export function isMeasureContract(value: unknown): value is MeasureContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!("kind" in value)) return false;
  const keys = Object.keys(value);
  if (value.kind === "additive") {
    if (keys.some((key) => key !== "kind" && key !== "additiveOver"))
      return false;
    if (!("additiveOver" in value) || value.additiveOver === undefined)
      return true;
    return (
      Array.isArray(value.additiveOver) &&
      value.additiveOver.every(
        (scope) =>
          typeof scope === "string" &&
          GRAIN_SCOPES.includes(scope as GrainScope),
      )
    );
  }
  return (
    (value.kind === "ratio" || value.kind === "non-additive") &&
    keys.every((key) => key === "kind")
  );
}

export function measureContractProblem(metric: {
  contract?: unknown;
  expression?: unknown;
}): string | null {
  return metric.contract !== null &&
    typeof metric.contract === "object" &&
    "kind" in metric.contract &&
    metric.contract.kind === "ratio" &&
    !metric.expression
    ? "Ratio measures require an expression"
    : null;
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
