/** Closed server-side contract for materialized live Insight fetches. */
import { fieldIdToColumnAlias, metricIdToColumnAlias } from "@dashframe/engine";
import { schema } from "@dashframe/server-core";
import type {
  Insight,
  InsightFetchDefinition,
  InsightFetchResult,
  InsightRuntimeInput,
  UUID,
} from "@dashframe/types";
import { eq, jsonb, uuid } from "@wystack/db";
import { createHash } from "node:crypto";
import { z } from "zod";

import type { DashframeFunctionContext } from "../app-context";
import { permissions } from "../permissions";
import { wy } from "../wystack";
import type { MaterializationTarget } from "./data-fetch/materializer";
import { trustedPublishedSourceGenerations } from "./data-fetch/published-source-error";
import { staleFrameMetadata } from "./data-fetch/publisher";
import { decodeInsight, type InsightRow, type InsightSource } from "./insights";

export type EffectiveInsightDefinition = InsightFetchDefinition & {
  limit?: number;
  /** Persisted composition wiring. Never accepted from fetchData callers. */
  source?: InsightSource;
};

/** Exact effective invocation identity used by publication and stale fallback. */
export function fingerprintEffectiveInsight(
  insight: EffectiveInsightDefinition,
): string {
  return createHash("sha256").update(JSON.stringify(insight)).digest("hex");
}

export function compatibleInsightFingerprints(
  insight: EffectiveInsightDefinition,
): string[] {
  const current = fingerprintEffectiveInsight(insight);
  if (insight.source?.sourceType !== "dataTable") return [current];
  const { source: _source, ...legacy } = insight;
  return [current, fingerprintEffectiveInsight(legacy)];
}

const RUNTIME_FAILURE_CODES = new Set([
  "RUNTIME_FILTER_NOT_DECLARED",
  "RUNTIME_FILTER_KEY_DUPLICATE",
  "RUNTIME_FILTER_DECLARATION_INVALID",
  "RUNTIME_FILTER_REQUIRED",
  "RUNTIME_FILTER_CLEAR_NOT_ALLOWED",
  "RUNTIME_FILTER_VALUE_INVALID",
  "RUNTIME_SORT_NOT_DECLARED",
  "RUNTIME_SORT_MAX_KEYS",
  "RUNTIME_SORT_FIELD_NOT_ALLOWED",
  "RUNTIME_LIMIT_OUT_OF_RANGE",
]);

const filterSchema = z.object({
  id: z.string().optional(),
  field: z.string().min(1),
  operator: z.enum([
    "eq",
    "ne",
    "gt",
    "gte",
    "lt",
    "lte",
    "contains",
    "in",
    "between",
  ]),
  value: z.unknown(),
});
const definitionSchema = z
  .object({
    baseTableId: z.string().min(1),
    selectedFields: z.array(z.string().min(1)),
    metrics: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        sourceTable: z.string(),
        columnName: z.string().optional(),
        aggregation: z.enum([
          "sum",
          "avg",
          "count",
          "min",
          "max",
          "count_distinct",
        ]),
      }),
    ),
    filters: z.array(filterSchema).optional(),
    sorts: z
      .array(
        z.object({ field: z.string(), direction: z.enum(["asc", "desc"]) }),
      )
      .optional(),
    joins: z
      .array(
        z.object({
          type: z.enum(["inner", "left", "right", "full"]),
          rightTableId: z.string(),
          leftKey: z.string(),
          rightKey: z.string(),
        }),
      )
      .optional(),
  })
  .strict();
const runtimeSchema = z
  .object({
    filters: z.record(z.string(), z.unknown()).optional(),
    sort: z
      .array(
        z.object({ fieldId: z.string(), direction: z.enum(["asc", "desc"]) }),
      )
      .max(1)
      .optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();

/** Implementations must atomically persist a new immutable DataFrame before ready. */
export type LiveFetchExecutor = (args: {
  context: DashframeFunctionContext;
  insight: EffectiveInsightDefinition;
  target: MaterializationTarget;
}) => Promise<InsightFetchResult>;

type RuntimeFilterControl = NonNullable<
  NonNullable<Insight["runtimeControls"]>["filters"]
>[number];

function declaredRuntimeFilters(
  saved: Insight,
): Map<string, RuntimeFilterControl> {
  const controls = new Map<string, RuntimeFilterControl>();
  const targetFilterIds = new Set<string>();
  const savedFilterIds = new Map<string, number>();
  for (const filter of saved.filters ?? []) {
    if (filter.id) {
      savedFilterIds.set(filter.id, (savedFilterIds.get(filter.id) ?? 0) + 1);
    }
  }
  for (const control of saved.runtimeControls?.filters ?? []) {
    if (control.required && control.allowClear) {
      throw new Error("RUNTIME_FILTER_DECLARATION_INVALID");
    }
    if (controls.has(control.key))
      throw new Error("RUNTIME_FILTER_KEY_DUPLICATE");
    if (
      targetFilterIds.has(control.filterId) ||
      savedFilterIds.get(control.filterId) !== 1
    ) {
      throw new Error("RUNTIME_FILTER_DECLARATION_INVALID");
    }
    controls.set(control.key, control);
    targetFilterIds.add(control.filterId);
  }
  return controls;
}

function applyRuntimeFilters(
  definition: EffectiveInsightDefinition,
  saved: Insight,
  runtime: InsightRuntimeInput | undefined,
): void {
  const values = runtime?.filters ?? {};
  const controls = declaredRuntimeFilters(saved);
  for (const key of Object.keys(values)) {
    if (!controls.has(key)) throw new Error("RUNTIME_FILTER_NOT_DECLARED");
  }
  for (const control of controls.values()) {
    applyRuntimeFilter(definition, saved, control, values);
  }
}

function applyRuntimeFilter(
  definition: EffectiveInsightDefinition,
  saved: Insight,
  control: RuntimeFilterControl,
  values: Record<string, unknown>,
): void {
  const hasValue = Object.hasOwn(values, control.key);
  const value = values[control.key];
  if (control.required && (!hasValue || value === null)) {
    throw new Error("RUNTIME_FILTER_REQUIRED");
  }
  if (!hasValue) return;
  if (value === null) {
    if (!control.allowClear)
      throw new Error("RUNTIME_FILTER_CLEAR_NOT_ALLOWED");
    definition.filters = definition.filters?.filter(
      (candidate) => candidate.id !== control.filterId,
    );
    return;
  }
  const savedFilter = saved.filters?.find(
    (candidate) => candidate.id === control.filterId,
  );
  if (!savedFilter || !runtimeFilterValueIsValid(savedFilter, value)) {
    throw new Error("RUNTIME_FILTER_VALUE_INVALID");
  }
  definition.filters = definition.filters?.map((candidate) =>
    candidate.id === control.filterId ? { ...candidate, value } : candidate,
  );
}

type JsonScalar = string | number | boolean;

function runtimeFilterValueIsValid(
  filter: NonNullable<Insight["filters"]>[number],
  runtimeValue: unknown,
): boolean {
  const savedValue = literalOperand(filter.value);
  if (filter.operator === "in") {
    if (!Array.isArray(savedValue) || !Array.isArray(runtimeValue))
      return false;
    if (!savedValue.every(isJsonScalar) || !runtimeValue.every(isJsonScalar))
      return false;
    const savedKinds = new Set(savedValue.map(scalarKind));
    return (
      savedKinds.size > 0 &&
      runtimeValue.every((value) => savedKinds.has(scalarKind(value)))
    );
  }
  if (filter.operator === "between") {
    if (!isExactRange(savedValue) || !isExactRange(runtimeValue)) return false;
    return (
      sameScalarType(savedValue.low, runtimeValue.low) &&
      sameScalarType(savedValue.high, runtimeValue.high)
    );
  }
  if (!isJsonScalar(savedValue) || !isJsonScalar(runtimeValue)) return false;
  if (filter.operator === "contains" && typeof savedValue !== "string")
    return false;
  return sameScalarType(savedValue, runtimeValue);
}

function literalOperand(value: unknown): unknown {
  if (isRecord(value) && value.kind === "value" && Object.hasOwn(value, "v")) {
    return value.v;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExactRange(value: unknown): value is {
  low: JsonScalar;
  high: JsonScalar;
} {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    keys.includes("low") &&
    keys.includes("high") &&
    isJsonScalar(value.low) &&
    isJsonScalar(value.high)
  );
}

function isJsonScalar(value: unknown): value is JsonScalar {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function scalarKind(value: JsonScalar): string {
  return typeof value;
}

function sameScalarType(saved: JsonScalar, runtime: JsonScalar): boolean {
  return scalarKind(saved) === scalarKind(runtime);
}

function applyRuntimeSort(
  definition: EffectiveInsightDefinition,
  saved: Insight,
  runtime: InsightRuntimeInput | undefined,
): void {
  if (!runtime?.sort) return;
  const control = saved.runtimeControls?.sort;
  if (!control) throw new Error("RUNTIME_SORT_NOT_DECLARED");
  if (control.maxKeys !== 1 || runtime.sort.length > control.maxKeys) {
    throw new Error("RUNTIME_SORT_MAX_KEYS");
  }
  if (
    runtime.sort.some((sort) => !control.allowedFieldIds.includes(sort.fieldId))
  ) {
    throw new Error("RUNTIME_SORT_FIELD_NOT_ALLOWED");
  }
  definition.sorts = runtime.sort.map((sort) => ({
    field: saved.metrics.some((metric) => metric.id === sort.fieldId)
      ? metricIdToColumnAlias(sort.fieldId)
      : fieldIdToColumnAlias(sort.fieldId),
    direction: sort.direction,
  }));
}

function applyRuntimeLimit(
  definition: EffectiveInsightDefinition,
  saved: Insight,
  runtime: InsightRuntimeInput | undefined,
): void {
  if (runtime?.limit === undefined) return;
  const control = saved.runtimeControls?.limit;
  if (!control || runtime.limit < control.min || runtime.limit > control.max) {
    throw new Error("RUNTIME_LIMIT_OUT_OF_RANGE");
  }
  definition.limit = runtime.limit;
}

export function applyInsightRuntime(
  saved: Insight,
  runtime: InsightRuntimeInput | undefined,
): EffectiveInsightDefinition {
  const definition: EffectiveInsightDefinition = {
    baseTableId: saved.source.sourceId,
    selectedFields: saved.selectedFields,
    metrics: saved.metrics,
    filters: saved.filters,
    sorts: saved.sorts,
    joins: saved.joins,
    source: saved.source,
  };
  applyRuntimeFilters(definition, saved, runtime);
  applyRuntimeSort(definition, saved, runtime);
  applyRuntimeLimit(definition, saved, runtime);
  return definition;
}

function failed(
  code: string,
  message: string,
  retryable = false,
): InsightFetchResult {
  return {
    status: "failed",
    code,
    message,
    retryable,
    diagnosticId: crypto.randomUUID(),
  };
}

export function toFetchFailure(
  error: unknown,
  fallback: string,
): InsightFetchResult {
  const sourceCode = error instanceof Error ? error.message : "";
  const code =
    RUNTIME_FAILURE_CODES.has(sourceCode) ||
    sourceCode === "SOURCE_SCHEMA_CHANGED" ||
    sourceCode === "TARGET_NOT_READY"
      ? sourceCode
      : fallback;
  let result: InsightFetchResult;
  if (code === "SOURCE_SCHEMA_CHANGED")
    result = failed(
      code,
      "The source schema changed and the Insight needs review.",
    );
  else if (code === "TARGET_NOT_READY")
    result = failed(code, "The requested data target is not ready yet.", true);
  else
    result = failed(
      code,
      code.startsWith("RUNTIME_")
        ? "The requested Insight runtime controls are invalid."
        : "Live data could not be fetched.",
      fallback === "FETCH_EXECUTION_FAILED",
    );
  const sourceGenerations = trustedPublishedSourceGenerations(error);
  if (result.status === "failed" && sourceGenerations)
    result.sourceGenerations = sourceGenerations;
  return result;
}

/**
 * Host-only factory, deliberately not registered until a real executor exists.
 * Both routes are closed: validation, saved-definition, binding, compilation,
 * and connector errors all return a safe failed result rather than an RPC error.
 */
export function createDataFetchFunctions(execute: LiveFetchExecutor) {
  const materialize = async (
    ctx: DashframeFunctionContext,
    insight: EffectiveInsightDefinition,
    target: MaterializationTarget,
  ): Promise<InsightFetchResult> => {
    try {
      return await execute({ context: ctx, insight, target });
    } catch (error) {
      return toFetchFailure(error, "FETCH_EXECUTION_FAILED");
    }
  };
  /**
   * Materializes an unsaved preview. Its returned frame handle is leased for
   * this server session; startup retires prior-session preview rows/files.
   * Saved runInsight generations remain durable and are not session-leased.
   */
  const fetchData = wy.procedure
    .input({ insight: jsonb })
    .authorize(permissions.data.fetchData)
    .mutation(async (ctx, { insight }) => {
      const parsed = definitionSchema.safeParse(insight);
      if (!parsed.success)
        return failed(
          "FETCH_INVALID_DEFINITION",
          "The Insight definition is invalid.",
        );
      try {
        const source = await resolveEphemeralSource(
          ctx,
          parsed.data.baseTableId as UUID,
        );
        return materialize(
          ctx,
          { ...parsed.data, source },
          { kind: "ephemeral" },
        );
      } catch (error) {
        return toFetchFailure(error, "FETCH_SOURCE_FAILED");
      }
    });
  const runInsight = wy.procedure
    .input({ insightId: uuid, runtime: jsonb.optional() })
    .authorize(permissions.insights.runInsight)
    .mutation(async (ctx, { insightId, runtime }) => {
      const parsedRuntime = runtimeSchema.optional().safeParse(runtime);
      if (!parsedRuntime.success)
        return failed(
          "FETCH_INVALID_REQUEST",
          "The requested Insight runtime controls are invalid.",
        );
      try {
        const saved = await getInsightForFetch(ctx, insightId as UUID);
        const effective = applyInsightRuntime(saved, parsedRuntime.data);
        const invocationFingerprints = compatibleInsightFingerprints(effective);
        const result = await materialize(ctx, effective, {
          kind: "saved",
          insightId: insightId as UUID,
        });
        if (result.status !== "failed") return result;
        const prior = await lastSuccessfulForInsight(
          ctx,
          insightId as UUID,
          invocationFingerprints,
        );
        return prior ? { ...result, lastSuccessful: prior } : result;
      } catch (error) {
        // Definition/runtime validation did not produce a valid effective
        // invocation, so no prior frame can be proven equivalent.
        return toFetchFailure(error, "FETCH_SOURCE_FAILED");
      }
    });
  return { fetchData, runInsight };
}

/** Resolve caller-supplied base identity against persisted server topology. */
async function resolveEphemeralSource(
  ctx: DashframeFunctionContext,
  sourceId: UUID,
): Promise<InsightSource> {
  const [table, insight] = await Promise.all([
    ctx.db.from(schema.dataTables).where(eq("id", sourceId)).first(),
    ctx.db.from(schema.insights).where(eq("id", sourceId)).first(),
  ]);
  // UUID collisions across namespaces are ambiguous and must not let the
  // caller select which persisted topology wins.
  if (Boolean(table) === Boolean(insight)) throw new Error("TARGET_NOT_READY");
  return table
    ? { sourceType: "dataTable", sourceId }
    : { sourceType: "insight", sourceId };
}

async function getInsightForFetch(
  ctx: DashframeFunctionContext,
  insightId: UUID,
): Promise<Insight> {
  const row = (await ctx.db
    .from(schema.insights)
    .where(eq("id", insightId))
    .first()) as InsightRow | undefined;
  if (!row) throw new Error("INSIGHT_NOT_FOUND");
  return decodeInsight(row);
}

async function lastSuccessfulForInsight(
  ctx: DashframeFunctionContext,
  insightId: UUID,
  invocationFingerprints: readonly string[],
) {
  const rows = (await ctx.db
    .from(schema.dataFrames)
    .where(eq("insightId", insightId))
    .all()) as Array<{
    id: UUID;
    fieldIds: unknown;
    rowCount: number | null;
    analysis: unknown;
    lastRefreshedAt: Date | null;
  }>;
  const row =
    rows.find(
      (candidate) =>
        (candidate.analysis as { currentInsightResult?: unknown } | null)
          ?.currentInsightResult === true,
    ) ??
    rows.reduce<(typeof rows)[number] | undefined>(
      (latest, candidate) =>
        !latest ||
        (candidate.lastRefreshedAt?.getTime() ?? 0) >
          (latest.lastRefreshedAt?.getTime() ?? 0)
          ? candidate
          : latest,
      undefined,
    );
  const stale = row ? staleFrameMetadata(row) : undefined;
  return stale?.definitionFingerprint &&
    invocationFingerprints.includes(stale.definitionFingerprint)
    ? stale
    : undefined;
}
